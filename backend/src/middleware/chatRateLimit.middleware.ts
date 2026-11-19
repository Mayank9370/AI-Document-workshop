/**
 * Redis Chat Rate Limiting Middleware (Phase 8)
 *
 * Requirements:
 * - 10 chat requests per minute per authenticated user
 * - Scoped strictly to authenticated req.user.id
 * - Atomic evaluation via Redis Lua script (race-safe under concurrent requests)
 * - Returns HTTP 429 with Retry-After header when exceeded
 * - Returns controlled HTTP 503 if Redis is unavailable (no silent bypass)
 */

import { Request, Response, NextFunction } from 'express';
import { getRedisClient, isRedisConnected } from '../config/redis';
import { logger } from '../utils/logger';

export const CHAT_RATE_LIMIT_MAX_REQUESTS = 10;
export const CHAT_RATE_LIMIT_WINDOW_SECONDS = 60;

/** Lua script for atomic sliding/fixed window counter with expiry */
const RATE_LIMIT_LUA_SCRIPT = `
local current = redis.call('INCR', KEYS[1])
if current == 1 then
  redis.call('EXPIRE', KEYS[1], ARGV[1])
end
local ttl = redis.call('TTL', KEYS[1])
return {current, ttl}
`;

export function getChatRateLimitKey(userId: string): string {
  return `ratelimit:chat:${userId}`;
}

export interface ChatRateLimitConfig {
  maxRequests: number;
  windowSeconds: number;
}

let activeConfig: ChatRateLimitConfig = {
  maxRequests: CHAT_RATE_LIMIT_MAX_REQUESTS,
  windowSeconds: CHAT_RATE_LIMIT_WINDOW_SECONDS,
};

/**
 * Configure rate limit thresholds (useful for unit testing without waiting 60s).
 */
export function setChatRateLimitConfig(config: Partial<ChatRateLimitConfig>): void {
  activeConfig = {
    ...activeConfig,
    ...config,
  };
}

export function resetChatRateLimitConfig(): void {
  activeConfig = {
    maxRequests: CHAT_RATE_LIMIT_MAX_REQUESTS,
    windowSeconds: CHAT_RATE_LIMIT_WINDOW_SECONDS,
  };
}

/**
 * Express middleware for Redis-backed atomic chat rate limiting.
 * Must run AFTER authentication middleware.
 */
export async function chatRateLimit(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const userId = req.user?.id;

  if (!userId) {
    // If not authenticated, let authentication middleware handle it or return 401
    res.status(401).json({
      success: false,
      message: 'Authentication required before rate limiting check.',
      timestamp: new Date().toISOString(),
    });
    return;
  }

  // 1. Check Redis availability - no silent bypass
  try {
    const connected = await isRedisConnected();
    if (!connected) {
      logger.error('Redis unavailable during chat rate limit check. Failing closed with HTTP 503.');
      res.status(503).json({
        success: false,
        message: 'Chat service temporarily unavailable. Please try again later.',
        timestamp: new Date().toISOString(),
      });
      return;
    }

    const client = getRedisClient();
    const rateLimitKey = getChatRateLimitKey(userId);

    // 2. Execute atomic Lua script
    const result = (await client.eval(RATE_LIMIT_LUA_SCRIPT, {
      keys: [rateLimitKey],
      arguments: [activeConfig.windowSeconds.toString()],
    })) as [number, number];

    const currentCount = Number(result[0]);
    const ttlSeconds = Math.max(1, Number(result[1]));

    // 3. Evaluate count against threshold
    if (currentCount > activeConfig.maxRequests) {
      logger.warn(
        `Rate limit exceeded for user ${userId}: ${currentCount}/${activeConfig.maxRequests} requests. Retry after ${ttlSeconds}s.`
      );

      res.setHeader('Retry-After', ttlSeconds.toString());
      res.status(429).json({
        success: false,
        message: 'Chat rate limit exceeded. Please try again later.',
        retryAfter: ttlSeconds,
        timestamp: new Date().toISOString(),
      });
      return;
    }

    // Attach current limit headers if desired
    res.setHeader('X-RateLimit-Limit', activeConfig.maxRequests.toString());
    res.setHeader('X-RateLimit-Remaining', Math.max(0, activeConfig.maxRequests - currentCount).toString());
    res.setHeader('X-RateLimit-Reset', ttlSeconds.toString());

    next();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error(`Redis rate limit error for user ${userId}: ${msg}. Returning HTTP 503.`);
    res.status(503).json({
      success: false,
      message: 'Chat service temporarily unavailable. Please try again later.',
      timestamp: new Date().toISOString(),
    });
  }
}
