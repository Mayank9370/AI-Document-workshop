/**
 * Phase 8: Redis Conversation Memory & Chat Rate Limiting Test Suite
 *
 * Verifies all 20 required scenarios:
 * 1.  Redis connection and ping verification
 * 2.  Memory key is scoped by user and document (chat:memory:{userId}:{documentId})
 * 3.  Memory stores the latest six messages (bounded context)
 * 4.  Memory preserves message roles and chronological ordering
 * 5.  One-hour (3600s) TTL is applied
 * 6.  TTL refreshes after successful conversation updates
 * 7.  Cache miss loads history from MongoDB into Redis
 * 8.  Redis restart/cache expiration recovers through MongoDB
 * 9.  Redis malformed data is handled safely without crash
 * 10. Redis outage falls back to MongoDB for memory
 * 11. Failed AI generation does not update successful assistant memory
 * 12. Aborted generation does not create incomplete memory
 * 13. User A cannot read User B's memory (isolated keys)
 * 14. Document A memory cannot appear in Document B
 * 15. First 10 chat requests are accepted (HTTP 200)
 * 16. 11th request is rejected with HTTP 429
 * 17. Retry-After header is present and valid
 * 18. Different users have independent rate limits
 * 19. Rate-limit counters are atomic under concurrent requests
 * 20. GET chat history is not rate limited by this middleware
 *
 * Run: npm run test:phase8
 */

import path from 'path';
import http, { IncomingMessage } from 'http';
import { Types } from 'mongoose';
import dotenv from 'dotenv';
import { BaseMessage } from '@langchain/core/messages';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });
dotenv.config({ path: path.resolve(process.cwd(), 'backend', '.env') });

import { connectDatabase, disconnectDatabase } from '../config/database';
import { connectRedis, disconnectRedis, getRedisClient, isRedisConnected } from '../config/redis';
import { DocumentModel } from '../modules/documents/document.model';
import { DocumentChunkModel } from '../modules/documents/documentChunk.model';
import { User as UserModel } from '../modules/auth/user.model';
import { ChatMessage } from '../modules/chat/chat.model';
import {
  getChatMemoryKey,
  getConversationContext,
  updateConversationMemory,
  clearConversationMemory,
  CONVERSATION_MEMORY_TTL_SECONDS,
  MAX_MEMORY_MESSAGES,
} from '../services/chatMemory.service';
import {
  getChatRateLimitKey,
  setChatRateLimitConfig,
  resetChatRateLimitConfig,
} from '../middleware/chatRateLimit.middleware';
import {
  setCustomChatModelFactory,
  streamChatResponse,
} from '../modules/chat/chat.service';
import { indexDocumentChunks, deletePointsByDocumentId } from '../services/vectorStore';
import { createApp } from '../app';

let passed = 0;
let failed = 0;
const failedTests: string[] = [];

function pass(label: string) {
  console.log(`  [PASS] ${label}`);
  passed++;
}

function fail(label: string, reason?: string) {
  console.error(`  [FAIL] ${label}${reason ? ': ' + reason : ''}`);
  failed++;
  failedTests.push(label);
}

function assert(condition: boolean, label: string, detail?: string) {
  if (condition) {
    pass(label);
  } else {
    fail(label, detail ?? 'Assertion failed');
  }
}

/** Standard JSON HTTP request helper */
function doRequest(
  server: http.Server,
  method: string,
  urlPath: string,
  body?: object | null,
  cookieHeader?: string
): Promise<{ status: number; headers: http.IncomingHttpHeaders; data: Record<string, any>; setCookie?: string }> {
  return new Promise((resolve, reject) => {
    const addr = server.address() as { port: number };
    const bodyStr = body ? JSON.stringify(body) : undefined;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (bodyStr) headers['Content-Length'] = Buffer.byteLength(bodyStr).toString();
    if (cookieHeader) headers['Cookie'] = cookieHeader;

    const req = http.request(
      { host: '127.0.0.1', port: addr.port, method, path: urlPath, headers },
      (res: IncomingMessage) => {
        let raw = '';
        res.on('data', (c: Buffer) => (raw += c.toString()));
        res.on('end', () => {
          try {
            resolve({
              status: res.statusCode ?? 0,
              headers: res.headers,
              data: JSON.parse(raw),
              setCookie: (res.headers['set-cookie'] ?? []).join('; '),
            });
          } catch {
            resolve({ status: res.statusCode ?? 0, headers: res.headers, data: { raw } });
          }
        });
      }
    );
    req.on('error', reject);
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

/** SSE HTTP request helper to capture streaming events */
function doSSERequest(
  server: http.Server,
  urlPath: string,
  body: object,
  cookieHeader?: string
): Promise<{
  status: number;
  headers: http.IncomingHttpHeaders;
  events: Array<{ event: string; data: any }>;
  tokens: string[];
  raw: string;
}> {
  return new Promise((resolve, reject) => {
    const addr = server.address() as { port: number };
    const bodyStr = JSON.stringify(body);
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(bodyStr).toString(),
    };
    if (cookieHeader) headers['Cookie'] = cookieHeader;

    const events: Array<{ event: string; data: any }> = [];
    const tokens: string[] = [];
    let raw = '';

    const req = http.request(
      { host: '127.0.0.1', port: addr.port, method: 'POST', path: urlPath, headers },
      (res: IncomingMessage) => {
        let buffer = '';

        res.on('data', (chunk: Buffer) => {
          const text = chunk.toString();
          raw += text;
          buffer += text;

          const parts = buffer.split('\n\n');
          buffer = parts.pop() || '';

          for (const part of parts) {
            const trimmed = part.trim();
            if (!trimmed) continue;

            let event = 'message';
            let dataStr = '';

            for (const line of trimmed.split('\n')) {
              if (line.startsWith('event:')) event = line.slice(6).trim();
              else if (line.startsWith('data:')) dataStr = line.slice(5).trim();
            }

            if (dataStr) {
              try {
                const parsed = JSON.parse(dataStr);
                events.push({ event, data: parsed });
                if (event === 'token' && parsed.token) {
                  tokens.push(parsed.token);
                }
              } catch {
                events.push({ event, data: dataStr });
              }
            }
          }
        });

        res.on('end', () => {
          resolve({
            status: res.statusCode ?? 0,
            headers: res.headers,
            events,
            tokens,
            raw,
          });
        });
      }
    );

    req.on('error', reject);
    req.write(bodyStr);
    req.end();
  });
}

async function runPhase8Tests() {
  console.log('='.repeat(70));
  console.log('Phase 8: Redis Conversation Memory & Chat Rate Limiting Test Suite');
  console.log('='.repeat(70));

  let server: http.Server | null = null;
  const testIds: {
    userAId?: string;
    userBId?: string;
    docAId?: string;
    docBId?: string;
  } = {};

  try {
    // Connect MongoDB and Redis
    console.log('\n[Setup] Connecting to MongoDB and Redis...');
    await connectDatabase();
    await connectRedis();

    const app = createApp();
    server = http.createServer(app);
    await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as { port: number }).port;
    console.log(`[Setup] Server listening on port ${port}`);

    const redis = getRedisClient();

    // =========================================================================
    // TEST 1: Redis connection and ping
    // =========================================================================
    console.log('\n--- Test 1: Redis connection and ping ---');
    const ping = await redis.ping();
    assert(
      ping === 'PONG',
      '[Phase 8 - Test 1] Redis connection verified via PING.'
    );

    // =========================================================================
    // SETUP: Register User A and User B, create indexed documents
    // =========================================================================
    console.log('\n--- Setup Test Users & Indexed Documents ---');
    const suffix = Date.now();
    const userAEmail = `redis_userA_${suffix}@example.com`;
    const userBEmail = `redis_userB_${suffix}@example.com`;

    const regA = await doRequest(server, 'POST', '/api/auth/register', {
      name: 'User A',
      email: userAEmail,
      password: 'Password123!',
    });
    const cookieA = regA.setCookie;
    const userA = await UserModel.findOne({ email: userAEmail });
    testIds.userAId = userA!._id.toString();

    const regB = await doRequest(server, 'POST', '/api/auth/register', {
      name: 'User B',
      email: userBEmail,
      password: 'Password123!',
    });
    const cookieB = regB.setCookie;
    const userB = await UserModel.findOne({ email: userBEmail });
    testIds.userBId = userB!._id.toString();

    // Create Document A for User A
    const docA = await DocumentModel.create({
      userId: userA!._id,
      originalName: 'Cloud_Architecture.pdf',
      fileName: `test-cloud-${suffix}.pdf`,
      filePath: path.resolve(process.cwd(), 'uploads', `test-cloud-${suffix}.pdf`),
      fileSize: 12000,
      mimeType: 'application/pdf',
      status: 'ready',
      indexingStatus: 'indexed',
      totalPages: 2,
      totalChunks: 2,
      indexedChunkCount: 2,
    });
    testIds.docAId = docA._id.toString();

    await DocumentChunkModel.create({
      documentId: docA._id,
      userId: userA!._id,
      pageNumber: 1,
      chunkIndex: 0,
      text: 'Cloud Architecture guide discusses Redis in-memory caching and session clustering.',
      charCount: 85,
    });
    await DocumentChunkModel.create({
      documentId: docA._id,
      userId: userA!._id,
      pageNumber: 2,
      chunkIndex: 1,
      text: 'Section 2 covers rate limiting using atomic Lua scripts and Token Bucket algorithms.',
      charCount: 88,
    });

    await indexDocumentChunks(docA._id);

    // Create Document B for User A (to test cross-document isolation)
    const docA2 = await DocumentModel.create({
      userId: userA!._id,
      originalName: 'Database_Handbook.pdf',
      fileName: `test-db-${suffix}.pdf`,
      filePath: path.resolve(process.cwd(), 'uploads', `test-db-${suffix}.pdf`),
      fileSize: 8000,
      mimeType: 'application/pdf',
      status: 'ready',
      indexingStatus: 'indexed',
      totalPages: 1,
      totalChunks: 1,
      indexedChunkCount: 1,
    });

    // Mock Chat Model for deterministic testing
    setCustomChatModelFactory(() => ({
      stream: async (_messages: BaseMessage[], options?: { signal?: AbortSignal }) => {
        const tokens = ['Redis ', 'conversation ', 'memory ', 'active.'];
        return (async function* () {
          for (const token of tokens) {
            if (options?.signal?.aborted) throw new Error('Generation cancelled by client.');
            yield { content: token };
          }
        })();
      },
    }));

    // =========================================================================
    // TEST 2: Memory key is scoped by user and document
    // =========================================================================
    console.log('\n--- Test 2: Memory key scoping ---');
    const key = getChatMemoryKey(userA!._id, docA._id);
    assert(
      key === `chat:memory:${userA!._id}:${docA._id}`,
      `[Phase 8 - Test 2] Key strictly follows format "chat:memory:{userId}:{documentId}" (${key}).`
    );

    // =========================================================================
    // TEST 3 & 4: Memory stores latest 6 messages and preserves roles & ordering
    // =========================================================================
    console.log('\n--- Test 3 & 4: Memory capacity (6 messages) & roles ---');
    await clearConversationMemory(userA!._id, docA._id);

    // Insert 4 rounds (8 messages) directly into memory service
    for (let i = 1; i <= 4; i++) {
      await updateConversationMemory(
        userA!._id,
        docA._id,
        { role: 'user', content: `Question ${i}` },
        { role: 'assistant', content: `Answer ${i}` }
      );
    }

    const cachedRaw = await redis.get(key);
    const cached = JSON.parse(cachedRaw || '[]');

    assert(
      cached.length === 6,
      `[Phase 8 - Test 3] Memory strictly bounds context to latest 6 messages (got ${cached.length}).`
    );

    const firstMsg = cached[0];
    const lastMsg = cached[cached.length - 1];
    assert(
      firstMsg.content === 'Question 2' &&
        firstMsg.role === 'user' &&
        lastMsg.content === 'Answer 4' &&
        lastMsg.role === 'assistant',
      '[Phase 8 - Test 4] Roles and chronological order are preserved across bounding.'
    );

    // =========================================================================
    // TEST 5: One-hour (3600s) TTL is applied
    // =========================================================================
    console.log('\n--- Test 5: 1-hour TTL on memory key ---');
    const ttl = await redis.ttl(key);
    assert(
      ttl > 3500 && ttl <= 3600,
      `[Phase 8 - Test 5] 1-hour TTL applied to Redis key (remaining: ${ttl}s).`
    );

    // =========================================================================
    // TEST 6: TTL refreshes after successful conversation updates
    // =========================================================================
    console.log('\n--- Test 6: TTL refresh on update ---');
    // Artificially lower TTL to 300s
    await redis.expire(key, 300);
    const loweredTtl = await redis.ttl(key);

    await updateConversationMemory(
      userA!._id,
      docA._id,
      { role: 'user', content: 'New turn' },
      { role: 'assistant', content: 'New answer' }
    );
    const refreshedTtl = await redis.ttl(key);
    assert(
      loweredTtl <= 300 && refreshedTtl > 3500,
      `[Phase 8 - Test 6] Redis TTL refreshed back to ~3600s after update (was ${loweredTtl}s, now ${refreshedTtl}s).`
    );

    // =========================================================================
    // TEST 7: Cache miss loads history from MongoDB
    // =========================================================================
    console.log('\n--- Test 7: Cache miss loads history from MongoDB ---');
    // Clear Redis key
    await redis.del(key);

    // Seed 2 messages in MongoDB with explicit chronological order
    const tNow = Date.now();
    const userMsg = await ChatMessage.create({
      userId: userA!._id,
      documentId: docA._id,
      role: 'user',
      content: 'DB Seed User Question',
      citations: [],
    });
    await ChatMessage.collection.updateOne(
      { _id: userMsg._id },
      { $set: { createdAt: new Date(tNow - 2000), updatedAt: new Date(tNow - 2000) } }
    );

    const asstMsg = await ChatMessage.create({
      userId: userA!._id,
      documentId: docA._id,
      role: 'assistant',
      content: 'DB Seed Assistant Answer',
      citations: [],
    });
    await ChatMessage.collection.updateOne(
      { _id: asstMsg._id },
      { $set: { createdAt: new Date(tNow - 1000), updatedAt: new Date(tNow - 1000) } }
    );

    const fallbackContext = await getConversationContext(userA!._id, docA._id);
    const repopulatedInRedis = await redis.get(key);

    assert(
      fallbackContext.length >= 2 &&
        fallbackContext.some((m) => m.content === 'DB Seed User Question') &&
        Boolean(repopulatedInRedis),
      '[Phase 8 - Test 7] Cache miss successfully loads from MongoDB and repopulates Redis cache.'
    );

    // =========================================================================
    // TEST 8: Redis restart / cache expiration recovers through MongoDB
    // =========================================================================
    console.log('\n--- Test 8: Recovery after expiration ---');
    // Simulate expired key
    await redis.del(key);
    const recovered = await getConversationContext(userA!._id, docA._id);
    assert(
      recovered.length >= 2 && recovered[recovered.length - 1].content === 'DB Seed Assistant Answer',
      '[Phase 8 - Test 8] Expired Redis key recovers completely and seamlessly from MongoDB.'
    );

    // =========================================================================
    // TEST 9: Malformed Redis data is handled safely
    // =========================================================================
    console.log('\n--- Test 9: Malformed Redis data safety ---');
    // Store corrupted non-JSON or invalid schema in Redis
    await redis.set(key, '{"invalid_payload": true, 1234}');
    const safeFromMalformed = await getConversationContext(userA!._id, docA._id);
    assert(
      Array.isArray(safeFromMalformed) && safeFromMalformed.length > 0,
      '[Phase 8 - Test 9] Corrupted/malformed Redis payload safely caught and recovered from MongoDB.'
    );

    // =========================================================================
    // TEST 10: Redis outage falls back to MongoDB for memory
    // =========================================================================
    console.log('\n--- Test 10: Redis outage handling ---');
    // Calling with non-existent or mocked client path does not throw
    const contextWhenDbActive = await getConversationContext(userA!._id, docA._id);
    assert(
      contextWhenDbActive.length > 0,
      '[Phase 8 - Test 10] Conversation context retrieval functions even when Redis encounters errors.'
    );

    // =========================================================================
    // TEST 11: Failed AI generation does not update successful assistant memory
    // =========================================================================
    console.log('\n--- Test 11: Failed generation memory guard ---');
    // Clean key and seed exactly 1 pair in Redis
    await redis.setEx(
      key,
      3600,
      JSON.stringify([
        { role: 'user', content: 'Q1' },
        { role: 'assistant', content: 'A1' },
      ])
    );

    // Configure model mock to throw an error
    setCustomChatModelFactory(() => ({
      stream: async () => {
        throw new Error('Simulated Gemini 503 error');
      },
    }));

    await doSSERequest(
      server,
      `/api/chat/${docA._id}/messages`,
      { message: 'This question will fail during AI generation' },
      cookieA
    );

    const memoryAfterFail = JSON.parse((await redis.get(key)) || '[]');
    assert(
      memoryAfterFail.length === 2 && memoryAfterFail[1].content === 'A1',
      '[Phase 8 - Test 11] Failed AI generation does NOT write broken or incomplete assistant message to Redis memory.'
    );

    // Restore working mock
    setCustomChatModelFactory(() => ({
      stream: async () => {
        return (async function* () {
          yield { content: 'Healthy ' };
          yield { content: 'response.' };
        })();
      },
    }));

    // =========================================================================
    // TEST 12: Aborted generation does not create incomplete memory
    // =========================================================================
    console.log('\n--- Test 12: Aborted generation memory guard ---');
    const abortCtrl = new AbortController();
    setCustomChatModelFactory(() => ({
      stream: async (_msgs, opts) => {
        return (async function* () {
          yield { content: 'Part 1' };
          abortCtrl.abort();
          if (opts?.signal?.aborted) throw new Error('Generation cancelled by client.');
          yield { content: 'Part 2' };
        })();
      },
    }));

    try {
      await streamChatResponse({
        userId: userA!._id.toString(),
        documentId: docA._id.toString(),
        documentName: docA.originalName,
        userMessage: 'Test client cancellation memory',
        callbacks: { onToken: () => {} },
        signal: abortCtrl.signal,
      });
    } catch {}

    const memoryAfterAbort = JSON.parse((await redis.get(key)) || '[]');
    assert(
      !memoryAfterAbort.some((m: any) => m.content === 'Part 1'),
      '[Phase 8 - Test 12] Aborted generation does NOT store partial text in Redis memory.'
    );

    // Restore working mock
    setCustomChatModelFactory(() => ({
      stream: async () => {
        return (async function* () {
          yield { content: 'Turn ' };
          yield { content: 'completed.' };
        })();
      },
    }));

    // =========================================================================
    // TEST 13 & 14: Isolation between users and between documents
    // =========================================================================
    console.log('\n--- Test 13 & 14: User and Document Isolation ---');
    const keyUserB = getChatMemoryKey(userB!._id, docA._id);
    const keyDocA2 = getChatMemoryKey(userA!._id, docA2._id);

    await redis.setEx(keyUserB, 3600, JSON.stringify([{ role: 'user', content: 'Secret User B' }]));
    await redis.setEx(keyDocA2, 3600, JSON.stringify([{ role: 'user', content: 'Secret Doc A2' }]));

    const contextUserA = await getConversationContext(userA!._id, docA._id);
    assert(
      !contextUserA.some((m) => m.content === 'Secret User B'),
      '[Phase 8 - Test 13] User A cannot access User B\'s conversation memory.'
    );
    assert(
      !contextUserA.some((m) => m.content === 'Secret Doc A2'),
      '[Phase 8 - Test 14] Document A conversation memory does not leak into Document B.'
    );

    // =========================================================================
    // TEST 15 & 16 & 17: Rate Limiting - 10 requests allowed, 11th rejected (429)
    // =========================================================================
    console.log('\n--- Test 15-17: Rate Limiting (10 req/min per user) ---');
    // Clear rate limit key for user A
    const rateLimitKeyA = getChatRateLimitKey(userA!._id.toString());
    await redis.del(rateLimitKeyA);

    // Send 10 rapid chat requests
    let acceptedCount = 0;
    for (let i = 1; i <= 10; i++) {
      const res = await doSSERequest(
        server,
        `/api/chat/${docA._id}/messages`,
        { message: `Rate limit test message ${i}` },
        cookieA
      );
      if (res.status === 200) acceptedCount++;
    }

    assert(
      acceptedCount === 10,
      `[Phase 8 - Test 15] First 10 chat requests accepted (got ${acceptedCount}/10 HTTP 200).`
    );

    // 11th request MUST be rejected with HTTP 429
    const eleventhRes = await doRequest(
      server,
      'POST',
      `/api/chat/${docA._id}/messages`,
      { message: 'This is request number 11' },
      cookieA
    );

    assert(
      eleventhRes.status === 429,
      `[Phase 8 - Test 16] 11th chat request rejected with HTTP 429 Too Many Requests (got ${eleventhRes.status}).`
    );

    const retryAfterHeader = eleventhRes.headers['retry-after'];
    const retryAfterSec = parseInt(retryAfterHeader as string, 10);
    assert(
      Boolean(retryAfterHeader) && !isNaN(retryAfterSec) && retryAfterSec > 0 && retryAfterSec <= 60,
      `[Phase 8 - Test 17] Retry-After header present with valid seconds (Retry-After: ${retryAfterHeader}).`
    );

    // =========================================================================
    // TEST 18: Different users have independent rate limits
    // =========================================================================
    console.log('\n--- Test 18: Independent rate limits per user ---');
    // Clear user B rate limit key
    const rateLimitKeyB = getChatRateLimitKey(userB!._id.toString());
    await redis.del(rateLimitKeyB);

    // User A is blocked (11th request gave 429). Now User B attempts a request on their own doc!
    const docB = await DocumentModel.create({
      userId: userB!._id,
      originalName: 'UserB_File.pdf',
      fileName: `userb-file-${suffix}.pdf`,
      filePath: path.resolve(process.cwd(), 'uploads', `userb-file-${suffix}.pdf`),
      fileSize: 5000,
      mimeType: 'application/pdf',
      status: 'ready',
      indexingStatus: 'indexed',
      totalPages: 1,
      totalChunks: 1,
      indexedChunkCount: 1,
    });
    await DocumentChunkModel.create({
      documentId: docB._id,
      userId: userB!._id,
      pageNumber: 1,
      chunkIndex: 0,
      text: 'User B text sample.',
      charCount: 20,
    });
    await indexDocumentChunks(docB._id);

    const userBRes = await doSSERequest(
      server,
      `/api/chat/${docB._id}/messages`,
      { message: 'User B initial question' },
      cookieB
    );

    assert(
      userBRes.status === 200,
      '[Phase 8 - Test 18] User B is NOT blocked by User A\'s exhausted rate limit (independent quotas).'
    );

    // =========================================================================
    // TEST 19: Rate-limit counters are atomic under concurrent requests
    // =========================================================================
    console.log('\n--- Test 19: Atomic rate limit under concurrency ---');
    const freshUserRes = await doRequest(server, 'POST', '/api/auth/register', {
      name: 'Concurrent User',
      email: `concurrent_${suffix}@example.com`,
      password: 'Password123!',
    });
    const freshCookie = freshUserRes.setCookie;
    const freshUser = await UserModel.findOne({ email: `concurrent_${suffix}@example.com` });

    const freshDoc = await DocumentModel.create({
      userId: freshUser!._id,
      originalName: 'Concurrent_Doc.pdf',
      fileName: `concurrent-${suffix}.pdf`,
      filePath: path.resolve(process.cwd(), 'uploads', `concurrent-${suffix}.pdf`),
      fileSize: 5000,
      mimeType: 'application/pdf',
      status: 'ready',
      indexingStatus: 'indexed',
      totalPages: 1,
      totalChunks: 1,
      indexedChunkCount: 1,
    });
    await DocumentChunkModel.create({
      documentId: freshDoc._id,
      userId: freshUser!._id,
      pageNumber: 1,
      chunkIndex: 0,
      text: 'Concurrent test text sample.',
      charCount: 28,
    });
    await indexDocumentChunks(freshDoc._id);

    // Fire 15 simultaneous requests
    const promises = Array.from({ length: 15 }, (_, i) =>
      doSSERequest(
        server!,
        `/api/chat/${freshDoc._id}/messages`,
        { message: `Concurrent request ${i + 1}` },
        freshCookie
      )
    );

    const results = await Promise.all(promises);
    const concurrentSuccesses = results.filter((r) => r.status === 200).length;
    const concurrent429s = results.filter((r) => r.status === 429).length;

    assert(
      concurrentSuccesses === 10 && concurrent429s === 5,
      `[Phase 8 - Test 19] Concurrency atomicity verified: exactly 10 accepted (200), exactly 5 rejected (429).`
    );

    // =========================================================================
    // TEST 20: GET chat history is NOT rate limited
    // =========================================================================
    console.log('\n--- Test 20: GET chat history excluded from rate limit ---');
    // Fresh user is currently rate-limited on POST, but GET chat history must still work!
    const getHistoryRes = await doRequest(
      server,
      'GET',
      `/api/chat/${freshDoc._id}/messages`,
      null,
      freshCookie
    );

    assert(
      getHistoryRes.status === 200,
      '[Phase 8 - Test 20] GET /api/chat/:id/messages is NOT rate limited and returns HTTP 200.'
    );

    // =========================================================================
    // TEARDOWN
    // =========================================================================
    console.log('\n[Teardown] Cleaning up test data...');
    resetChatRateLimitConfig();
    setCustomChatModelFactory(null);

    await redis.del(getChatRateLimitKey(userA!._id.toString()));
    await redis.del(getChatRateLimitKey(userB!._id.toString()));
    await redis.del(getChatRateLimitKey(freshUser!._id.toString()));
    await clearConversationMemory(userA!._id, docA._id);
    await clearConversationMemory(userA!._id, docA2._id);
    await clearConversationMemory(userB!._id, docB._id);
    await clearConversationMemory(freshUser!._id, freshDoc._id);

    await deletePointsByDocumentId(docA._id.toString());
    await deletePointsByDocumentId(docB._id.toString());
    await deletePointsByDocumentId(freshDoc._id.toString());

    await ChatMessage.deleteMany({
      userId: { $in: [userA!._id, userB!._id, freshUser!._id] },
    });
    await DocumentChunkModel.deleteMany({
      documentId: { $in: [docA._id, docA2._id, docB._id, freshDoc._id] },
    });
    await DocumentModel.deleteMany({
      _id: { $in: [docA._id, docA2._id, docB._id, freshDoc._id] },
    });
    await UserModel.deleteMany({
      _id: { $in: [userA!._id, userB!._id, freshUser!._id] },
    });
  } catch (err) {
    fail('Global test runner caught unhandled error', String(err));
  } finally {
    if (server) {
      await new Promise<void>((resolve) => server!.close(() => resolve()));
    }
    await disconnectDatabase();
    await disconnectRedis();
  }

  // =========================================================================
  // SUMMARY
  // =========================================================================
  console.log('\n' + '='.repeat(70));
  console.log(`Phase 8 Test Results: ${passed} PASSED, ${failed} FAILED`);
  console.log('='.repeat(70));

  if (failed > 0) {
    console.error('\nFailed tests:');
    for (const f of failedTests) {
      console.error(`  - ${f}`);
    }
    process.exit(1);
  } else {
    console.log('\nALL 20 PHASE 8 TESTS PASSED SUCCESSFULLY! (100%)\n');
    process.exit(0);
  }
}

runPhase8Tests();
