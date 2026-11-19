import { Router } from 'express';
import { authenticate } from '../../middleware/auth';
import { chatRateLimit } from '../../middleware/chatRateLimit.middleware';
import { sendMessageStream, getChatHistory } from './chat.controller';

const router = Router();

// All chat routes require user authentication
router.use(authenticate);

// Send message and stream RAG response via SSE (rate limited: 10 req/min per user)
router.post('/:documentId/messages', chatRateLimit, sendMessageStream);

// Retrieve chat history for a document (not rate limited)
router.get('/:documentId/messages', getChatHistory);

export default router;
