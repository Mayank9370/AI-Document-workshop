/**
 * Redis Conversation Memory Service (Phase 8)
 *
 * Provides:
 * 1. Redis-based conversation memory storing the latest 6 messages per user/document
 * 2. 1-hour (3600s) TTL refreshed on every successful conversation turn
 * 3. Authoritative fallback to MongoDB on cache miss, expiration, or Redis outage
 * 4. Resilient handling of malformed Redis cache data
 * 5. Isolation between users and documents (keys: chat:memory:{userId}:{documentId})
 */

import { Types } from 'mongoose';
import { getRedisClient, isRedisConnected } from '../config/redis';
import { ChatMessage, IChatMessage } from '../modules/chat/chat.model';
import { logger } from '../utils/logger';

export interface ConversationMessage {
  role: 'user' | 'assistant';
  content: string;
}

/** 1 hour in seconds */
export const CONVERSATION_MEMORY_TTL_SECONDS = 3600;

/** Maximum number of messages preserved in conversational context */
export const MAX_MEMORY_MESSAGES = 6;

/**
 * Deterministic, privacy-safe Redis key format scoped to user and document.
 */
export function getChatMemoryKey(userId: string | Types.ObjectId, documentId: string | Types.ObjectId): string {
  return `chat:memory:${userId.toString()}:${documentId.toString()}`;
}

/**
 * Validate that an unknown value parsed from Redis is an array of ConversationMessage objects.
 */
function isValidMemoryArray(data: unknown): data is ConversationMessage[] {
  if (!Array.isArray(data)) return false;
  return data.every(
    (item) =>
      typeof item === 'object' &&
      item !== null &&
      (item.role === 'user' || item.role === 'assistant') &&
      typeof item.content === 'string'
  );
}

/**
 * Retrieve previous conversation context for a user and document.
 * 1. Tries Redis first.
 * 2. If missing, expired, or malformed, falls back to MongoDB.
 * 3. Repopulates Redis if loaded from MongoDB.
 *
 * @param userId Authenticated user ID
 * @param documentId Document ID
 * @param excludeMessageId Optional message ID to exclude (e.g. current pending user message)
 */
export async function getConversationContext(
  userId: string | Types.ObjectId,
  documentId: string | Types.ObjectId,
  excludeMessageId?: string | Types.ObjectId
): Promise<ConversationMessage[]> {
  const uId = userId.toString();
  const dId = documentId.toString();
  const key = getChatMemoryKey(uId, dId);

  // 1. Try reading from Redis if connected
  let redisAvailable = false;
  try {
    redisAvailable = await isRedisConnected();
    if (redisAvailable) {
      const client = getRedisClient();
      const raw = await client.get(key);
      if (raw) {
        try {
          const parsed = JSON.parse(raw);
          if (isValidMemoryArray(parsed)) {
            // Redis hit: return up to the latest MAX_MEMORY_MESSAGES
            return parsed.slice(-MAX_MEMORY_MESSAGES);
          } else {
            logger.warn(`Malformed Redis chat memory payload at ${key}. Falling back to MongoDB.`);
          }
        } catch {
          logger.warn(`Corrupted JSON in Redis chat memory at ${key}. Falling back to MongoDB.`);
        }
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error(`Redis error reading chat memory for ${key}: ${msg}. Falling back to MongoDB.`);
  }

  // 2. Cache miss or Redis error -> Authoritative fallback to MongoDB
  try {
    const filter: Record<string, unknown> = {
      userId: new Types.ObjectId(uId),
      documentId: new Types.ObjectId(dId),
    };

    if (excludeMessageId) {
      filter._id = { $ne: new Types.ObjectId(excludeMessageId.toString()) };
    }

    const messagesFromDb: IChatMessage[] = await ChatMessage.find(filter)
      .sort({ createdAt: -1, _id: -1 })
      .limit(MAX_MEMORY_MESSAGES);

    // MongoDB returns newest first, so reverse to chronological order
    const chronological: ConversationMessage[] = messagesFromDb.reverse().map((m) => ({
      role: m.role,
      content: m.content,
    }));

    // Repopulate Redis cache if Redis is available
    if (redisAvailable && chronological.length > 0) {
      try {
        const client = getRedisClient();
        await client.setEx(key, CONVERSATION_MEMORY_TTL_SECONDS, JSON.stringify(chronological));
      } catch (cacheErr) {
        logger.warn(`Failed to repopulate Redis memory cache for ${key}: ${cacheErr}`);
      }
    }

    return chronological;
  } catch (dbErr) {
    const msg = dbErr instanceof Error ? dbErr.message : String(dbErr);
    logger.error(`Failed to load fallback chat memory from MongoDB for ${uId}:${dId}: ${msg}`);
    return [];
  }
}

/**
 * Update Redis conversation memory after both user and assistant messages
 * have been successfully persisted in MongoDB.
 * Keeps strictly the latest 6 messages and resets the 1-hour TTL.
 */
export async function updateConversationMemory(
  userId: string | Types.ObjectId,
  documentId: string | Types.ObjectId,
  userMessage: ConversationMessage,
  assistantMessage: ConversationMessage
): Promise<void> {
  const uId = userId.toString();
  const dId = documentId.toString();
  const key = getChatMemoryKey(uId, dId);

  try {
    if (!(await isRedisConnected())) {
      logger.warn(`Redis disconnected. Skipping cache update for ${key}. MongoDB holds truth.`);
      return;
    }

    const client = getRedisClient();
    const existingRaw = await client.get(key);
    let currentHistory: ConversationMessage[] = [];

    if (existingRaw) {
      try {
        const parsed = JSON.parse(existingRaw);
        if (isValidMemoryArray(parsed)) {
          currentHistory = parsed;
        }
      } catch {
        // Fall back to empty array
      }
    }

    // Append new user and assistant message
    const updatedHistory = [...currentHistory, userMessage, assistantMessage].slice(
      -MAX_MEMORY_MESSAGES
    );

    // Store with 1-hour TTL
    await client.setEx(key, CONVERSATION_MEMORY_TTL_SECONDS, JSON.stringify(updatedHistory));
    logger.info(`Updated Redis conversation memory for ${key} (${updatedHistory.length} messages, 1h TTL).`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error(`Failed to update Redis conversation memory for ${key}: ${msg}`);
  }
}

/**
 * Clear Redis conversation memory for a user and document (useful on document deletion or testing).
 */
export async function clearConversationMemory(
  userId: string | Types.ObjectId,
  documentId: string | Types.ObjectId
): Promise<void> {
  const key = getChatMemoryKey(userId, documentId);
  try {
    if (await isRedisConnected()) {
      const client = getRedisClient();
      await client.del(key);
    }
  } catch (err) {
    logger.warn(`Error deleting Redis memory key ${key}: ${err}`);
  }
}
