/**
 * Qdrant Vector Store & Semantic Retrieval Service (Phase 6)
 *
 * Provides:
 * 1. Collection initialization with vector verification and payload indexes
 * 2. Deterministic point ID generation (UUID v5 derived from MongoDB chunk ID)
 * 3. Bounded-batch vector indexing with Gemini embeddings (RETRIEVAL_DOCUMENT)
 * 4. Document-level ownership-filtered semantic search (RETRIEVAL_QUERY)
 * 5. Document point deletion and reindexing support
 * 6. Concurrency locks and server restart recovery
 */
import { Types } from 'mongoose';
import { v5 as uuidv5 } from 'uuid';
import { getQdrantClient } from '../config/qdrant';
import { getConfig } from '../config/env';
import { DocumentModel } from '../modules/documents/document.model';
import { DocumentChunkModel } from '../modules/documents/documentChunk.model';
import { embedDocument, embedQuery } from './embeddingService';
import { logger } from '../utils/logger';

export const COLLECTION_NAME = 'document_chunks';
export const VECTOR_SIZE = 768;
export const VECTOR_DISTANCE = 'Cosine' as const;

/** Fixed namespace for deterministic UUID v5 generation from MongoDB chunk IDs */
export const QDRANT_CHUNK_NAMESPACE = '6ba7b810-9dad-11d1-80b4-00c04fd430c8';

/** Batch size for embedding and upserting points to Qdrant */
const INDEXING_BATCH_SIZE = 20;

/** In-memory lock to prevent simultaneous duplicate indexing of the same document */
const indexingLock = new Set<string>();

/**
 * Generate a deterministic UUID v5 point ID from a MongoDB chunk ID.
 * Ensures reindexing overwrites existing points instead of creating duplicates.
 */
export function chunkIdToPointId(chunkId: string | Types.ObjectId): string {
  return uuidv5(chunkId.toString(), QDRANT_CHUNK_NAMESPACE);
}

export interface SearchResultItem {
  chunkId: string;
  documentId: string;
  pageNumber: number;
  chunkIndex: number;
  text: string;
  score: number;
}

/**
 * Initialize the Qdrant collection for document chunks.
 * - Creates collection if missing (768 dimensions, Cosine distance).
 * - Verifies dimensions and distance on existing collections (fails safely on mismatch).
 * - Creates keyword payload indexes on userId, documentId, and chunkId for efficient filtering.
 * - Idempotent and safe to run repeatedly.
 */
export async function initQdrantCollection(): Promise<void> {
  const client = getQdrantClient();

  try {
    const collectionsList = await client.getCollections();
    const exists = collectionsList.collections.some((c) => c.name === COLLECTION_NAME);

    if (exists) {
      // Verify existing collection configuration
      const collectionInfo = await client.getCollection(COLLECTION_NAME);
      const vectorsConfig = collectionInfo.config?.params?.vectors;

      // Handle single-vector or named-vector configuration
      let actualSize: number | undefined;
      let actualDistance: string | undefined;

      if (vectorsConfig && typeof vectorsConfig === 'object') {
        if ('size' in vectorsConfig && 'distance' in vectorsConfig) {
          actualSize = (vectorsConfig as { size: number; distance: string }).size;
          actualDistance = (vectorsConfig as { size: number; distance: string }).distance;
        }
      }

      if (actualSize !== undefined && actualSize !== VECTOR_SIZE) {
        throw new Error(
          `Incompatible Qdrant collection "${COLLECTION_NAME}": vector size is ${actualSize}, expected ${VECTOR_SIZE}.`
        );
      }
      if (actualDistance !== undefined && actualDistance !== VECTOR_DISTANCE) {
        throw new Error(
          `Incompatible Qdrant collection "${COLLECTION_NAME}": distance metric is ${actualDistance}, expected ${VECTOR_DISTANCE}.`
        );
      }

      logger.info(
        `Qdrant collection "${COLLECTION_NAME}" verified: size=${actualSize ?? VECTOR_SIZE}, distance=${actualDistance ?? VECTOR_DISTANCE}`
      );
    } else {
      // Create collection
      logger.info(`Creating Qdrant collection "${COLLECTION_NAME}" (${VECTOR_SIZE} dims, ${VECTOR_DISTANCE})...`);
      await client.createCollection(COLLECTION_NAME, {
        vectors: {
          size: VECTOR_SIZE,
          distance: VECTOR_DISTANCE,
        },
      });
      logger.info(`Qdrant collection "${COLLECTION_NAME}" created successfully.`);
    }

    // Ensure payload indexes exist for filtered search
    await ensurePayloadIndex('userId', 'keyword');
    await ensurePayloadIndex('documentId', 'keyword');
    await ensurePayloadIndex('chunkId', 'keyword');
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.error(`Qdrant collection initialization failed: ${msg}`);
    throw error;
  }
}

/**
 * Create a payload index if not already present.
 */
async function ensurePayloadIndex(fieldName: string, schema: 'keyword' | 'integer'): Promise<void> {
  const client = getQdrantClient();
  try {
    await client.createPayloadIndex(COLLECTION_NAME, {
      field_name: fieldName,
      field_schema: schema,
      wait: true,
    });
    logger.debug(`Qdrant payload index ensured on field "${fieldName}".`);
  } catch (err) {
    // If index already exists or server acknowledges, don't crash
    const msg = err instanceof Error ? err.message : String(err);
    logger.debug(`Payload index note for "${fieldName}": ${msg}`);
  }
}

/**
 * Index a document's chunks into Qdrant.
 * - Reads chunks from MongoDB (DocumentChunkModel).
 * - Embeds each chunk with TaskType.RETRIEVAL_DOCUMENT.
 * - Upserts points into Qdrant with deterministic IDs and payload.
 * - Updates DocumentModel indexingStatus ('indexing' -> 'indexed' | 'failed').
 *
 * @param documentId - MongoDB Document ID
 * @returns Object with indexedCount
 */
export async function indexDocumentChunks(documentId: string | Types.ObjectId): Promise<{ indexedCount: number }> {
  const docIdStr = documentId.toString();

  // Prevent concurrent duplicate indexing
  if (indexingLock.has(docIdStr)) {
    logger.warn(`Document ${docIdStr} is already being indexed. Skipping duplicate request.`);
    return { indexedCount: 0 };
  }
  indexingLock.add(docIdStr);

  try {
    const doc = await DocumentModel.findById(docIdStr);
    if (!doc) {
      throw new Error(`Document ${docIdStr} not found in database.`);
    }

    // Mark as indexing
    doc.indexingStatus = 'indexing';
    doc.set('indexingError', undefined);
    await doc.save();

    logger.info(`Starting Qdrant indexing for document "${doc.originalName}" (${docIdStr})...`);

    // Fetch chunks from MongoDB
    const chunks = await DocumentChunkModel.find({
      documentId: new Types.ObjectId(docIdStr),
    }).sort({ pageNumber: 1, chunkIndex: 1 });

    if (chunks.length === 0) {
      logger.warn(`No chunks found in MongoDB for document ${docIdStr}. Marking as indexed with 0 chunks.`);
      doc.indexingStatus = 'indexed';
      doc.indexedChunkCount = 0;
      doc.indexedAt = new Date();
      await doc.save();
      return { indexedCount: 0 };
    }

    const client = getQdrantClient();
    let totalIndexed = 0;

    // Process in bounded batches
    for (let i = 0; i < chunks.length; i += INDEXING_BATCH_SIZE) {
      const batch = chunks.slice(i, i + INDEXING_BATCH_SIZE);
      const points = [];

      for (const chunk of batch) {
        // Embed chunk using TaskType.RETRIEVAL_DOCUMENT
        const embResult = await embedDocument(chunk.text);

        if (embResult.dimensions !== VECTOR_SIZE) {
          throw new Error(
            `Vector dimension mismatch: got ${embResult.dimensions}, expected ${VECTOR_SIZE} for chunk ${chunk._id}`
          );
        }

        const pointId = chunkIdToPointId(chunk._id);

        points.push({
          id: pointId,
          vector: embResult.embedding,
          payload: {
            chunkId: chunk._id.toString(),
            documentId: doc._id.toString(),
            userId: doc.userId.toString(),
            pageNumber: chunk.pageNumber,
            chunkIndex: chunk.chunkIndex,
            text: chunk.text,
          },
        });
      }

      // Upsert batch to Qdrant
      await client.upsert(COLLECTION_NAME, {
        wait: true,
        points,
      });

      totalIndexed += points.length;
      logger.info(
        `Indexed batch ${Math.floor(i / INDEXING_BATCH_SIZE) + 1}: ${totalIndexed}/${chunks.length} chunks indexed for doc ${docIdStr}.`
      );
    }

    // Mark document as indexed
    doc.indexingStatus = 'indexed';
    doc.indexedChunkCount = totalIndexed;
    doc.indexedAt = new Date();
    doc.set('indexingError', undefined);
    await doc.save();

    logger.info(`Successfully indexed all ${totalIndexed} chunks for document "${doc.originalName}".`);
    return { indexedCount: totalIndexed };
  } catch (err: unknown) {
    const techMsg = err instanceof Error ? err.message : String(err);
    logger.error(`Vector indexing error for document ${docIdStr}: ${techMsg}`);

    // Map to user-safe message
    let userMsg = 'Failed to index document in vector store.';
    if (techMsg.includes('quota') || techMsg.includes('429')) {
      userMsg = 'Vector indexing temporarily paused due to AI provider quota limits.';
    } else if (techMsg.includes('Qdrant') || techMsg.includes('ECONNREFUSED')) {
      userMsg = 'Vector database is temporarily unavailable.';
    }

    await DocumentModel.findByIdAndUpdate(docIdStr, {
      $set: {
        indexingStatus: 'failed',
        indexingError: userMsg,
      },
    });

    throw err;
  } finally {
    indexingLock.delete(docIdStr);
  }
}

/**
 * Delete all Qdrant vector points associated with a specific document.
 * Called when a document is deleted.
 */
export async function deletePointsByDocumentId(documentId: string): Promise<void> {
  const client = getQdrantClient();
  const docIdStr = documentId.toString();

  try {
    await client.delete(COLLECTION_NAME, {
      wait: true,
      filter: {
        must: [
          {
            key: 'documentId',
            match: { value: docIdStr },
          },
        ],
      },
    });
    logger.info(`Deleted Qdrant vector points for document ${docIdStr}.`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error(`Failed to delete Qdrant points for document ${docIdStr}: ${msg}`);
    throw new Error(`Failed to remove document vector points from Qdrant: ${msg}`);
  }
}

/**
 * Search for chunks semantically relevant to a query within a specific document.
 * Mandatory filters: userId AND documentId.
 * Uses TaskType.RETRIEVAL_QUERY for embedding.
 */
export async function searchSimilarChunks(params: {
  userId: string;
  documentId: string;
  query: string;
  topK?: number;
}): Promise<SearchResultItem[]> {
  const { userId, documentId, query, topK = 5 } = params;

  if (!userId || !Types.ObjectId.isValid(userId)) {
    throw new Error('Valid user ID is required for search.');
  }
  if (!documentId || !Types.ObjectId.isValid(documentId)) {
    throw new Error('Valid document ID is required for search.');
  }
  if (!query || !query.trim()) {
    throw new Error('Search query text cannot be empty.');
  }

  // 1. Verify ownership: document must exist and belong to the user
  const doc = await DocumentModel.findOne({
    _id: new Types.ObjectId(documentId),
    userId: new Types.ObjectId(userId),
  });
  if (!doc) {
    throw new Error('Document not found or access denied.');
  }

  // 2. Embed the user query using TaskType.RETRIEVAL_QUERY
  const queryEmb = await embedQuery(query.trim());
  if (queryEmb.dimensions !== VECTOR_SIZE) {
    throw new Error(
      `Query embedding dimension mismatch: got ${queryEmb.dimensions}, expected ${VECTOR_SIZE}.`
    );
  }

  // 3. Query Qdrant with strict mandatory ownership filters
  const client = getQdrantClient();
  const queryResult = await client.query(COLLECTION_NAME, {
    query: queryEmb.embedding,
    limit: Math.max(1, Math.min(topK, 50)),
    filter: {
      must: [
        { key: 'userId', match: { value: userId.toString() } },
        { key: 'documentId', match: { value: documentId.toString() } },
      ],
    },
    with_payload: true,
    with_vector: false,
  });

  const points = queryResult.points || [];

  // 4. Format results
  const results: SearchResultItem[] = [];

  for (const point of points) {
    const payload = (point.payload || {}) as Record<string, unknown>;
    let text = typeof payload.text === 'string' ? payload.text : '';

    // Fallback: If Qdrant payload text is missing, fetch from MongoDB with ownership check
    if (!text && payload.chunkId) {
      const chunkDoc = await DocumentChunkModel.findOne({
        _id: new Types.ObjectId(payload.chunkId as string),
        userId: new Types.ObjectId(userId),
        documentId: new Types.ObjectId(documentId),
      });
      if (chunkDoc) {
        text = chunkDoc.text;
      }
    }

    results.push({
      chunkId: (payload.chunkId as string) || String(point.id),
      documentId: (payload.documentId as string) || documentId,
      pageNumber: typeof payload.pageNumber === 'number' ? payload.pageNumber : 1,
      chunkIndex: typeof payload.chunkIndex === 'number' ? payload.chunkIndex : 0,
      text,
      score: point.score ?? 0,
    });
  }

  return results;
}

/**
 * Reset documents stuck in 'indexing' status after a server restart or crash.
 */
export async function resetStuckIndexingDocuments(): Promise<void> {
  try {
    const result = await DocumentModel.updateMany(
      { indexingStatus: 'indexing' },
      {
        $set: {
          indexingStatus: 'pending',
          indexingError: 'Indexing was interrupted by a server restart. Reindexing is queued.',
        },
      }
    );
    if (result.modifiedCount > 0) {
      logger.warn(
        `Reset ${result.modifiedCount} document(s) stuck in 'indexing' status after server restart.`
      );
    }
  } catch (err) {
    logger.error(`Failed to reset stuck indexing documents: ${err instanceof Error ? err.message : err}`);
  }
}
