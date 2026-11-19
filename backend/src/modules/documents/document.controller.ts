import { Request, Response } from 'express';
import { Types } from 'mongoose';
import { DocumentModel } from './document.model';
import { validatePdfMagicBytes, removePhysicalFile } from './document.upload';
import { sendSuccess, sendError } from '../../utils/response';
import { logger } from '../../utils/logger';
import { processDocument, deleteDocumentChunks } from '../../services/documentProcessor';
import {
  indexDocumentChunks,
  deletePointsByDocumentId,
  searchSimilarChunks,
} from '../../services/vectorStore';
import { clearConversationMemory } from '../../services/chatMemory.service';
import {
  encodeCursor,
  decodeCursor,
  buildDescendingCursorFilter,
} from '../../utils/cursor';

/**
 * Handle multipart PDF upload, file signature validation, and metadata persistence.
 * POST /api/documents/upload
 */
export const uploadDocument = async (req: Request, res: Response): Promise<void> => {
  if (!req.user) {
    sendError(res, 'Authentication required.', 401);
    return;
  }

  const file = req.file;
  if (!file) {
    sendError(res, 'Please attach a valid PDF document to upload.', 400);
    return;
  }

  try {
    // 1. Verify actual PDF magic bytes on disk
    const isValidSignature = await validatePdfMagicBytes(file.path);
    if (!isValidSignature) {
      await removePhysicalFile(file.path);
      sendError(res, 'Corrupt or invalid PDF file signature. The file is not a valid PDF.', 400);
      return;
    }

    // 2. Persist document metadata in MongoDB
    const doc = new DocumentModel({
      userId: new Types.ObjectId(req.user.id),
      originalName: file.originalname,
      fileName: file.filename,
      filePath: file.path,
      fileSize: file.size,
      mimeType: file.mimetype,
      status: 'uploaded',
    });

    await doc.save();

    logger.info(`Document uploaded successfully: "${doc.originalName}" (${doc.fileName}) by user ${req.user.id}`);

    // Kick off background processing (non-blocking)
    // We intentionally do NOT await this – the HTTP response returns immediately
    // and the document status transitions to 'processing' → 'ready' | 'failed' asynchronously.
    setImmediate(() => {
      processDocument(doc._id.toString()).catch((err: unknown) => {
        logger.error(
          `Background processing error for doc ${doc._id}: ${
            err instanceof Error ? err.message : err
          }`
        );
      });
    });

    sendSuccess(
      res,
      'Document uploaded successfully. Processing has started in the background.',
      { document: doc },
      201
    );
  } catch (error) {
    // Clean up physical file on failure
    if (file?.path) {
      await removePhysicalFile(file.path);
    }
    const msg = error instanceof Error ? error.message : 'Upload failed';
    logger.error(`Document upload error: ${msg}`);
    sendError(res, 'Internal server error while saving document.', 500);
  }
};

/**
 * List all documents belonging to the authenticated user with cursor-based pagination.
 * GET /api/documents?cursor=...&limit=...
 *
 * Query parameters:
 * - cursor: Base64URL composite cursor (createdAt, _id)
 * - limit: Number of documents to fetch (default: 10, max: 50)
 * - page: Optional legacy page offset (supported for backward-compatibility)
 */
export const listDocuments = async (req: Request, res: Response): Promise<void> => {
  if (!req.user) {
    sendError(res, 'Authentication required.', 401);
    return;
  }

  try {
    const rawCursor = req.query.cursor as string | undefined;
    const rawLimit = parseInt(req.query.limit as string, 10);
    const rawPage = parseInt(req.query.page as string, 10);

    // Limit validation: default 10, clamp between 1 and 50
    const limit = !isNaN(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, 50) : 10;
    const userId = new Types.ObjectId(req.user.id);

    // Build query filter
    const filter: Record<string, unknown> = { userId };

    if (rawCursor) {
      const decoded = decodeCursor(rawCursor);
      if (!decoded) {
        sendError(res, 'Invalid pagination cursor provided.', 400);
        return;
      }
      const cursorFilter = buildDescendingCursorFilter(decoded);
      filter.$or = cursorFilter.$or;
    } else if (!isNaN(rawPage) && rawPage > 1) {
      // Legacy offset pagination support when no cursor is provided
      const skip = (rawPage - 1) * limit;
      const [documents, total] = await Promise.all([
        DocumentModel.find(filter).sort({ createdAt: -1, _id: -1 }).skip(skip).limit(limit),
        DocumentModel.countDocuments({ userId }),
      ]);
      const nextCursor =
        documents.length > 0
          ? encodeCursor(documents[documents.length - 1].createdAt, documents[documents.length - 1]._id)
          : null;
      const hasMore = skip + documents.length < total;

      sendSuccess(res, 'Documents retrieved successfully.', {
        documents,
        pagination: {
          nextCursor: hasMore ? nextCursor : null,
          hasMore,
          limit,
          total,
          page: rawPage,
          totalPages: Math.ceil(total / limit) || 1,
        },
      });
      return;
    }

    // Cursor-based query: fetch limit + 1 items sorted by createdAt DESC, _id DESC
    const [docs, total] = await Promise.all([
      DocumentModel.find(filter)
        .sort({ createdAt: -1, _id: -1 })
        .limit(limit + 1),
      DocumentModel.countDocuments({ userId }),
    ]);

    const hasMore = docs.length > limit;
    const documents = hasMore ? docs.slice(0, limit) : docs;
    const nextCursor =
      hasMore && documents.length > 0
        ? encodeCursor(documents[documents.length - 1].createdAt, documents[documents.length - 1]._id)
        : null;

    sendSuccess(res, 'Documents retrieved successfully.', {
      documents,
      pagination: {
        nextCursor,
        hasMore,
        limit,
        total,
        page: 1,
        totalPages: Math.ceil(total / limit) || 1,
      },
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Error fetching documents';
    logger.error(`List documents error: ${msg}`);
    sendError(res, 'Failed to retrieve documents.', 500);
  }
};

/**
 * Retrieve details for a single document belonging to the authenticated user.
 * GET /api/documents/:id
 */
export const getDocumentById = async (req: Request, res: Response): Promise<void> => {
  if (!req.user) {
    sendError(res, 'Authentication required.', 401);
    return;
  }

  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  if (!id || !Types.ObjectId.isValid(id)) {
    sendError(res, 'Invalid document identifier format.', 400);
    return;
  }

  try {
    const document = await DocumentModel.findById(id);

    // Enforce strict ownership: user can only view their own documents
    if (!document || document.userId.toString() !== req.user.id) {
      sendError(res, 'Document not found or access denied.', 404);
      return;
    }

    sendSuccess(res, 'Document details retrieved successfully.', { document });
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Error retrieving document';
    logger.error(`Get document error: ${msg}`);
    sendError(res, 'Failed to retrieve document details.', 500);
  }
};

/**
 * Delete a document and its corresponding physical file from disk.
 * DELETE /api/documents/:id
 */
export const deleteDocument = async (req: Request, res: Response): Promise<void> => {
  if (!req.user) {
    sendError(res, 'Authentication required.', 401);
    return;
  }

  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  if (!id || !Types.ObjectId.isValid(id)) {
    sendError(res, 'Invalid document identifier format.', 400);
    return;
  }

  try {
    const document = await DocumentModel.findById(id);

    // Enforce strict ownership: user can only delete their own documents
    if (!document || document.userId.toString() !== req.user.id) {
      sendError(res, 'Document not found or access denied.', 404);
      return;
    }

    // 1. Delete associated Qdrant vector points (Phase 6)
    try {
      await deletePointsByDocumentId(document._id.toString());
    } catch (qdrantErr) {
      logger.warn(
        `Non-fatal: Qdrant cleanup issue for document ${document._id}: ${
          qdrantErr instanceof Error ? qdrantErr.message : qdrantErr
        }`
      );
    }

    // 2. Delete physical file (gracefully handles if already deleted or moved)
    await removePhysicalFile(document.filePath);

    // 3. Delete all associated chunk records (Phase 5: cascade chunk cleanup)
    await deleteDocumentChunks(document._id.toString());

    // 4. Clear Redis conversation memory (Phase 8)
    try {
      await clearConversationMemory(req.user.id, document._id.toString());
    } catch (memErr) {
      logger.warn(`Non-fatal: Redis memory cleanup issue for document ${document._id}: ${memErr}`);
    }

    // 5. Delete database record
    await DocumentModel.findByIdAndDelete(document._id);

    logger.info(`Document deleted: "${document.originalName}" (${document._id}) by user ${req.user.id}`);

    sendSuccess(res, 'Document, associated chunks, and vector points deleted successfully.', null, 200);
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Error deleting document';
    logger.error(`Delete document error: ${msg}`);
    sendError(res, 'Failed to delete document.', 500);
  }
};

/**
 * Trigger manual or retry reindexing for an existing document in Qdrant.
 * POST /api/documents/:id/reindex
 */
export const reindexDocument = async (req: Request, res: Response): Promise<void> => {
  if (!req.user) {
    sendError(res, 'Authentication required.', 401);
    return;
  }

  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  if (!id || !Types.ObjectId.isValid(id)) {
    sendError(res, 'Invalid document identifier format.', 400);
    return;
  }

  try {
    const document = await DocumentModel.findById(id);

    // Enforce strict ownership
    if (!document || document.userId.toString() !== req.user.id) {
      sendError(res, 'Document not found or access denied.', 404);
      return;
    }

    if (document.status !== 'ready') {
      sendError(
        res,
        `Cannot index document that has not successfully extracted text. Current status: ${document.status}`,
        400
      );
      return;
    }

    // Dispatch indexing asynchronously in the background
    setImmediate(() => {
      indexDocumentChunks(document._id.toString()).catch((err: unknown) => {
        logger.error(
          `Manual reindexing failed for doc ${document._id}: ${
            err instanceof Error ? err.message : err
          }`
        );
      });
    });

    sendSuccess(
      res,
      'Reindexing initiated. Points are being updated in Qdrant.',
      { documentId: document._id.toString(), indexingStatus: 'indexing' },
      202
    );
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Error triggering reindex';
    logger.error(`Reindex document error: ${msg}`);
    sendError(res, 'Failed to initiate reindexing.', 500);
  }
};

/**
 * Perform semantic similarity search within a document's indexed chunks.
 * POST /api/documents/:id/search
 * Body: { query: string, topK?: number }
 */
export const searchDocument = async (req: Request, res: Response): Promise<void> => {
  if (!req.user) {
    sendError(res, 'Authentication required.', 401);
    return;
  }

  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  if (!id || !Types.ObjectId.isValid(id)) {
    sendError(res, 'Invalid document identifier format.', 400);
    return;
  }

  const { query, topK } = req.body as { query?: string; topK?: number };
  if (!query || typeof query !== 'string' || !query.trim()) {
    sendError(res, 'Search query text is required and cannot be empty.', 400);
    return;
  }

  try {
    const document = await DocumentModel.findById(id);

    // Enforce strict ownership: user can only search their own documents
    if (!document || document.userId.toString() !== req.user.id) {
      sendError(res, 'Document not found or access denied.', 404);
      return;
    }

    const parsedTopK = typeof topK === 'number' && topK > 0 ? Math.min(topK, 50) : 5;

    const results = await searchSimilarChunks({
      userId: req.user.id,
      documentId: document._id.toString(),
      query: query.trim(),
      topK: parsedTopK,
    });

    sendSuccess(res, 'Semantic search completed successfully.', {
      documentId: document._id.toString(),
      query: query.trim(),
      totalMatches: results.length,
      results,
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Search failed';
    logger.error(`Search document error: ${msg}`);
    sendError(res, `Failed to perform semantic search: ${msg}`, 500);
  }
};
