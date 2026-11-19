import { Request, Response } from 'express';
import { Types } from 'mongoose';
import { DocumentModel } from '../documents/document.model';
import { ChatMessage, IChatMessage } from './chat.model';
import { streamChatResponse } from './chat.service';
import {
  getConversationContext,
  updateConversationMemory,
} from '../../services/chatMemory.service';
import {
  encodeCursor,
  decodeCursor,
  buildDescendingCursorFilter,
} from '../../utils/cursor';
import { sendError, sendSuccess } from '../../utils/response';
import { logger } from '../../utils/logger';

/**
 * Handle SSE streaming chat message generation.
 * POST /api/chat/:documentId/messages
 */
export async function sendMessageStream(req: Request, res: Response): Promise<void> {
  const userId = req.user?.id;
  const rawDocId = req.params.documentId;
  const documentId = Array.isArray(rawDocId) ? rawDocId[0] : rawDocId;
  const { message } = req.body;

  // 1. Validate user and params
  if (!userId || !Types.ObjectId.isValid(userId)) {
    sendError(res, 'Authentication required.', 401);
    return;
  }

  if (!documentId || !Types.ObjectId.isValid(documentId)) {
    sendError(res, 'Invalid document ID format.', 400);
    return;
  }

  if (!message || typeof message !== 'string' || !message.trim()) {
    sendError(res, 'Message text cannot be empty.', 400);
    return;
  }

  const trimmedMessage = message.trim();
  if (trimmedMessage.length > 4000) {
    sendError(res, 'Message exceeds maximum allowed length of 4000 characters.', 400);
    return;
  }

  // 2. Verify document existence and ownership
  let doc;
  try {
    doc = await DocumentModel.findOne({
      _id: new Types.ObjectId(documentId),
      userId: new Types.ObjectId(userId),
    });
  } catch (err) {
    logger.error(`Error querying document ${documentId}: ${err}`);
    sendError(res, 'Failed to verify document.', 500);
    return;
  }

  if (!doc) {
    sendError(res, 'Document not found or access denied.', 404);
    return;
  }

  // 3. Verify document readiness and vector indexing status
  if (doc.status !== 'ready') {
    sendError(
      res,
      `Document is currently "${doc.status}". Please wait until processing completes before chatting.`,
      400
    );
    return;
  }

  if (doc.indexingStatus !== 'indexed') {
    sendError(
      res,
      `Document indexing is currently "${doc.indexingStatus}". Please wait until vector indexing completes.`,
      400
    );
    return;
  }

  // 4. Save User Message immediately
  let userMessageDoc: IChatMessage;
  try {
    userMessageDoc = await ChatMessage.create({
      userId: new Types.ObjectId(userId),
      documentId: doc._id,
      role: 'user',
      content: trimmedMessage,
      citations: [],
    });
  } catch (err) {
    logger.error(`Failed to persist user chat message: ${err}`);
    sendError(res, 'Failed to record chat message.', 500);
    return;
  }

  // 5. Fetch bounded recent history using Redis conversation memory (MongoDB fallback)
  let recentHistory: Array<{ role: 'user' | 'assistant'; content: string }> = [];
  try {
    recentHistory = await getConversationContext(
      userId,
      doc._id.toString(),
      userMessageDoc._id.toString()
    );
  } catch (err) {
    logger.warn(`Could not load previous chat memory: ${err}`);
  }

  // 6. Set up SSE Headers
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  });

  if (typeof (res as any).flushHeaders === 'function') {
    (res as any).flushHeaders();
  }

  let isStreamFinished = false;
  const abortController = new AbortController();

  req.on('close', () => {
    if (!isStreamFinished) {
      logger.info(`Client disconnected from SSE stream for doc ${documentId}`);
      abortController.abort();
    }
  });

  const sendEvent = (event: string, data: unknown) => {
    if (res.writableEnded || res.closed) return;
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    if (typeof (res as any).flush === 'function') {
      (res as any).flush();
    }
  };

  // 7. Stream generated answer via LangChain RAG pipeline
  try {
    const result = await streamChatResponse({
      userId,
      documentId,
      documentName: doc.originalName,
      userMessage: trimmedMessage,
      recentHistory,
      callbacks: {
        onStart: () => {
          sendEvent('start', { status: 'started' });
        },
        onToken: (token: string) => {
          sendEvent('token', { token });
        },
        onCitations: (citations) => {
          sendEvent('citations', { citations });
        },
      },
      signal: abortController.signal,
    });

    // 8. Persist completed assistant message with citations
    const assistantMessageDoc = await ChatMessage.create({
      userId: new Types.ObjectId(userId),
      documentId: doc._id,
      role: 'assistant',
      content: result.fullContent,
      citations: result.citations,
    });

    // 9. Update Redis conversation memory with latest turn and refresh 1-hour TTL
    try {
      await updateConversationMemory(
        userId,
        doc._id.toString(),
        { role: 'user', content: trimmedMessage },
        { role: 'assistant', content: result.fullContent }
      );
    } catch (memErr) {
      logger.warn(`Failed to update conversation memory in Redis: ${memErr}`);
    }

    isStreamFinished = true;

    // Send final completion event
    sendEvent('done', {
      messageId: assistantMessageDoc._id.toString(),
      content: assistantMessageDoc.content,
      citations: assistantMessageDoc.citations,
      createdAt: assistantMessageDoc.createdAt,
    });

    res.end();
  } catch (err) {
    isStreamFinished = true;
    if (abortController.signal.aborted) {
      logger.info(`Stream generation aborted cleanly for document ${documentId}`);
      if (!res.writableEnded) res.end();
      return;
    }

    const errorMsg =
      err instanceof Error ? err.message : 'An error occurred during response generation.';
    logger.error(`Error in SSE stream for document ${documentId}: ${errorMsg}`);

    sendEvent('error', {
      error: 'Failed to generate answer from the document. Please try again.',
    });
    res.end();
  }
}

/**
 * Retrieve chat history for a document with cursor-based pagination.
 * GET /api/chat/:documentId/messages?cursor=...&limit=...
 *
 * Query parameters:
 * - cursor: Base64URL composite cursor (createdAt, _id)
 * - limit: Number of messages to fetch (default: 20, max: 50)
 */
export async function getChatHistory(req: Request, res: Response): Promise<void> {
  const userId = req.user?.id;
  const rawDocId = req.params.documentId;
  const documentId = Array.isArray(rawDocId) ? rawDocId[0] : rawDocId;

  if (!userId || !Types.ObjectId.isValid(userId)) {
    sendError(res, 'Authentication required.', 401);
    return;
  }

  if (!documentId || !Types.ObjectId.isValid(documentId)) {
    sendError(res, 'Invalid document ID format.', 400);
    return;
  }

  try {
    // 1. Verify ownership of document
    const doc = await DocumentModel.findOne({
      _id: new Types.ObjectId(documentId),
      userId: new Types.ObjectId(userId),
    });

    if (!doc) {
      sendError(res, 'Document not found or access denied.', 404);
      return;
    }

    // 2. Parse cursor and limit
    const rawCursor = req.query.cursor as string | undefined;
    const rawLimit = parseInt(req.query.limit as string, 10);
    const limit = !isNaN(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, 50) : 20;

    const filter: Record<string, unknown> = {
      userId: new Types.ObjectId(userId),
      documentId: doc._id,
    };

    if (rawCursor) {
      const decoded = decodeCursor(rawCursor);
      if (!decoded) {
        sendError(res, 'Invalid pagination cursor provided.', 400);
        return;
      }
      const cursorFilter = buildDescendingCursorFilter(decoded);
      filter.$or = cursorFilter.$or;
    }

    // 3. Query descending: fetch limit + 1 items sorted by createdAt DESC, _id DESC
    const [rawMessages, total] = await Promise.all([
      ChatMessage.find(filter)
        .sort({ createdAt: -1, _id: -1 })
        .limit(limit + 1),
      ChatMessage.countDocuments({
        userId: new Types.ObjectId(userId),
        documentId: doc._id,
      }),
    ]);

    const hasMore = rawMessages.length > limit;
    const pageMessages = hasMore ? rawMessages.slice(0, limit) : rawMessages;

    // The cursor for the next (older) page is derived from the oldest item on this page
    const nextCursor =
      hasMore && pageMessages.length > 0
        ? encodeCursor(pageMessages[pageMessages.length - 1].createdAt, pageMessages[pageMessages.length - 1]._id)
        : null;

    // Reverse to chronological order so client views from oldest to newest within the window
    const chronologicalMessages = [...pageMessages].reverse();

    const formattedMessages = chronologicalMessages.map((m) => ({
      id: m._id.toString(),
      role: m.role,
      content: m.content,
      citations: m.citations,
      createdAt: m.createdAt,
    }));

    sendSuccess(res, 'Chat history retrieved successfully.', {
      documentId: doc._id.toString(),
      documentName: doc.originalName,
      messages: formattedMessages,
      pagination: {
        nextCursor,
        hasMore,
        limit,
        total,
      },
      total: formattedMessages.length,
    });
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    logger.error(`Error fetching chat history for document ${documentId}: ${errorMsg}`);
    sendError(res, 'Failed to retrieve chat history.', 500);
  }
}
