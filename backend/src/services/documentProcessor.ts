/**
 * Document Processing Pipeline Service (Phase 5)
 *
 * Orchestrates the full processing workflow for uploaded PDFs:
 * 1. Mark document as `processing`
 * 2. Extract text page by page using pdfExtractor
 * 3. Chunk extracted text using textChunker
 * 4. Persist chunk records in MongoDB (DocumentChunkModel)
 * 5. Mark document `ready` on success, `failed` on error
 *
 * - Prevents concurrent duplicate processing via an in-memory lock set.
 * - On server restart, documents stuck in `processing` are reset to `failed`
 *   (call resetStuckDocuments() on server startup).
 * - Chunk cleanup is performed automatically on reprocessing or document deletion.
 * - Preserves the original PDF file unless the user explicitly deletes the document.
 * - User-safe error messages are stored on the Document record; full stack traces only
 *   appear in backend logs.
 */
import { Types } from 'mongoose';
import { DocumentModel } from '../modules/documents/document.model';
import { DocumentChunkModel } from '../modules/documents/documentChunk.model';
import { extractPdfText } from './pdfExtractor';
import { chunkPages } from './textChunker';
import { indexDocumentChunks } from './vectorStore';
import { logger } from '../utils/logger';

/** In-memory set of document IDs currently being processed (prevents duplicates) */
const processingLock = new Set<string>();

/**
 * Reset documents stuck in `processing` status.
 * Call on server startup to handle crash/restart scenarios.
 */
export async function resetStuckDocuments(): Promise<void> {
  try {
    const result = await DocumentModel.updateMany(
      { status: 'processing' },
      {
        $set: {
          status: 'failed',
          processingError: 'Processing was interrupted by a server restart.',
        },
      }
    );
    if (result.modifiedCount > 0) {
      logger.warn(
        `Reset ${result.modifiedCount} document(s) stuck in 'processing' status after server restart.`
      );
    }
  } catch (err) {
    logger.error(`Failed to reset stuck documents: ${err instanceof Error ? err.message : err}`);
  }
}

/**
 * Process an uploaded PDF document:
 * - Extract text, chunk it, persist chunks to MongoDB.
 * - Updates document status accordingly.
 *
 * @param documentId - MongoDB ObjectId (string) of the Document record
 * @returns void (runs in the background; updates the Document record directly)
 */
export async function processDocument(documentId: string): Promise<void> {
  const docIdStr = documentId.toString();

  // Prevent concurrent duplicate processing
  if (processingLock.has(docIdStr)) {
    logger.warn(`Document ${docIdStr} is already being processed. Skipping duplicate request.`);
    return;
  }
  processingLock.add(docIdStr);

  try {
    // Load document record
    const doc = await DocumentModel.findById(docIdStr);
    if (!doc) {
      logger.error(`processDocument: Document ${docIdStr} not found in database.`);
      return;
    }

    // Mark as processing
    doc.status = 'processing';
    // Clear any previous error
    doc.set('processingError', undefined);
    await doc.save();

    logger.info(`Processing started for document: "${doc.originalName}" (${docIdStr})`);

    // === Step 1: PDF Text Extraction ===
    const extractionResult = await extractPdfText(doc.filePath);

    if (!extractionResult.hasText) {
      await markFailed(
        docIdStr,
        'This PDF contains no extractable text layer. Scanned PDFs without OCR cannot be processed.'
      );
      return;
    }

    // === Step 2: Text Chunking ===
    const chunks = chunkPages(extractionResult.pages);
    if (chunks.length === 0) {
      await markFailed(
        docIdStr,
        'No text chunks could be generated from this PDF. The document may contain only whitespace.'
      );
      return;
    }

    // === Step 3: Persist Chunks in MongoDB ===
    // Remove any existing chunks (supports safe reprocessing without duplicates)
    await DocumentChunkModel.deleteMany({ documentId: new Types.ObjectId(docIdStr) });

    const chunkDocs = chunks.map((chunk) => ({
      documentId: new Types.ObjectId(docIdStr),
      userId: doc.userId,
      pageNumber: chunk.pageNumber,
      chunkIndex: chunk.chunkIndex,
      text: chunk.text,
      charCount: chunk.charCount,
    }));

    await DocumentChunkModel.insertMany(chunkDocs, { ordered: false });

    // === Step 4: Mark document as ready ===
    const finalDoc = await DocumentModel.findById(docIdStr);
    if (finalDoc) {
      finalDoc.status = 'ready';
      finalDoc.set('totalPages', extractionResult.totalPages);
      finalDoc.set('totalChunks', chunks.length);
      finalDoc.set('processingError', undefined);
      finalDoc.indexingStatus = 'pending';
      await finalDoc.save();
    }

    logger.info(
      `Document processing complete: "${doc.originalName}" → ` +
        `${extractionResult.totalPages} page(s), ${chunks.length} chunks stored.`
    );

    // === Step 5: Trigger Qdrant Vector Indexing ===
    // Document status remains 'ready'; vector indexing lifecycle runs in background
    setImmediate(() => {
      indexDocumentChunks(docIdStr).catch((err: unknown) => {
        logger.error(
          `Background vector indexing error for doc ${docIdStr}: ${
            err instanceof Error ? err.message : err
          }`
        );
      });
    });
  } catch (err: unknown) {
    const techMsg = err instanceof Error ? err.message : String(err);
    logger.error(`processDocument error for ${docIdStr}: ${techMsg}`);

    // Map technical errors to user-safe messages
    let userMessage: string;
    if (techMsg.includes('password-protected')) {
      userMessage = 'This PDF is password-protected and cannot be processed.';
    } else if (techMsg.includes('malformed') || techMsg.includes('corrupt')) {
      userMessage = 'The PDF appears to be malformed or corrupted.';
    } else if (techMsg.includes('not found')) {
      userMessage = 'The PDF file could not be located on the server.';
    } else {
      userMessage = 'An unexpected error occurred while processing this document.';
    }

    await markFailed(docIdStr, userMessage);
  } finally {
    processingLock.delete(docIdStr);
  }
}

/**
 * Delete all DocumentChunk records belonging to a specific document.
 * Called when a document is deleted to avoid orphaned chunk records.
 */
export async function deleteDocumentChunks(documentId: string): Promise<void> {
  try {
    const result = await DocumentChunkModel.deleteMany({
      documentId: new Types.ObjectId(documentId),
    });
    if (result.deletedCount > 0) {
      logger.info(`Deleted ${result.deletedCount} chunk(s) for document ${documentId}`);
    }
  } catch (err) {
    logger.error(
      `Failed to delete chunks for document ${documentId}: ${
        err instanceof Error ? err.message : err
      }`
    );
  }
}

/** Internal helper: mark document as failed with a user-readable error message. */
async function markFailed(documentId: string, userMessage: string): Promise<void> {
  try {
    await DocumentModel.findByIdAndUpdate(documentId, {
      $set: { status: 'failed', processingError: userMessage },
    });
    logger.warn(`Document ${documentId} marked as failed: ${userMessage}`);
  } catch (err) {
    logger.error(
      `Could not mark document ${documentId} as failed: ${
        err instanceof Error ? err.message : err
      }`
    );
  }
}
