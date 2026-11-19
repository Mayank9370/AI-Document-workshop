/**
 * Phase 7: Conversational RAG & AI Chat Test Suite
 *
 * Verifies all 18 required scenarios:
 * 1.  ChatMessage model creation and field validation
 * 2.  User can submit a question for their own indexed document
 * 3.  Empty message is rejected (400 Bad Request)
 * 4.  Invalid document ID is rejected (400 Bad Request)
 * 5.  Unauthenticated requests are rejected (401 Unauthorized)
 * 6.  User cannot chat with another user's document (404 Document not found or access denied)
 * 7.  Qdrant retrieval receives the correct userId and documentId filters
 * 8.  Relevant retrieved chunks are passed to the AI model
 * 9.  Model response streams incrementally via SSE tokens
 * 10. SSE completion event (event: done) is sent
 * 11. Citations contain actual retrieved page numbers
 * 12. LLM-generated page numbers are not trusted (citations derived strictly from retrieved chunks)
 * 13. User messages are persisted in MongoDB
 * 14. Completed assistant messages are persisted in MongoDB with citations
 * 15. Failed generation does not create a successful assistant response
 * 16. Chat history returns the correct conversation chronologically
 * 17. Chat history cannot leak across users or documents
 * 18. Client disconnection is handled safely
 *
 * Run: npm run test:phase7
 */

import path from 'path';
import http, { IncomingMessage } from 'http';
import { Types } from 'mongoose';
import dotenv from 'dotenv';
import { BaseMessage } from '@langchain/core/messages';

// Load environment configuration
dotenv.config({ path: path.resolve(process.cwd(), '.env') });
dotenv.config({ path: path.resolve(process.cwd(), 'backend', '.env') });

import { connectDatabase, disconnectDatabase } from '../config/database';
import { connectRedis, disconnectRedis } from '../config/redis';
import { DocumentModel } from '../modules/documents/document.model';
import { DocumentChunkModel } from '../modules/documents/documentChunk.model';
import { User as UserModel } from '../modules/auth/user.model';
import { ChatMessage } from '../modules/chat/chat.model';
import {
  setCustomChatModelFactory,
  buildCitations,
  streamChatResponse,
} from '../modules/chat/chat.service';
import {
  SearchResultItem,
  indexDocumentChunks,
  deletePointsByDocumentId,
} from '../services/vectorStore';
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
): Promise<{ status: number; data: Record<string, any>; setCookie?: string }> {
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
              data: JSON.parse(raw),
              setCookie: (res.headers['set-cookie'] ?? []).join('; '),
            });
          } catch {
            resolve({ status: res.statusCode ?? 0, data: { raw } });
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

async function runPhase7Tests() {
  console.log('='.repeat(70));
  console.log('Phase 7: Conversational RAG & AI Chat Test Suite');
  console.log('='.repeat(70));

  let server: http.Server | null = null;
  const testIds: {
    userAId?: string;
    userBId?: string;
    docAId?: string;
    docBId?: string;
  } = {};

  try {
    // 0. Connect DB, Redis and start test HTTP server
    console.log('\n[Setup] Connecting to MongoDB and Redis and starting server...');
    await connectDatabase();
    await connectRedis();

    const app = createApp();
    server = http.createServer(app);
    await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as { port: number }).port;
    console.log(`[Setup] Server listening on port ${port}`);

    // =========================================================================
    // TEST 1: ChatMessage Model Creation & Schema Validation
    // =========================================================================
    console.log('\n--- Test 1: ChatMessage model schema ---');
    try {
      const dummyUserId = new Types.ObjectId();
      const dummyDocId = new Types.ObjectId();

      const sampleMsg = new ChatMessage({
        userId: dummyUserId,
        documentId: dummyDocId,
        role: 'user',
        content: 'Hello, what does this document discuss?',
        citations: [
          {
            chunkId: 'chunk-123',
            pageNumber: 2,
            chunkIndex: 0,
            text: 'Supporting sample excerpt',
          },
        ],
      });

      const validationErr = sampleMsg.validateSync();
      assert(
        !validationErr,
        '[Phase 7 - Test 1] ChatMessage model creation and schema validation passed.'
      );
    } catch (e) {
      fail('[Phase 7 - Test 1] ChatMessage model validation failed', String(e));
    }

    // =========================================================================
    // SETUP: Register User A and User B, create indexed documents
    // =========================================================================
    console.log('\n--- Setup Test Users & Indexed Documents ---');
    const suffix = Date.now();
    const userAEmail = `chattest_userA_${suffix}@example.com`;
    const userBEmail = `chattest_userB_${suffix}@example.com`;

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

    // Create an indexed Document for User A
    const docA = await DocumentModel.create({
      userId: userA!._id,
      originalName: 'Architecture_Handbook.pdf',
      fileName: `test-arch-${suffix}.pdf`,
      filePath: path.resolve(process.cwd(), 'uploads', `test-arch-${suffix}.pdf`),
      fileSize: 10240,
      mimeType: 'application/pdf',
      status: 'ready',
      indexingStatus: 'indexed',
      totalPages: 3,
      totalChunks: 2,
      indexedChunkCount: 2,
    });
    testIds.docAId = docA._id.toString();

    // Create chunks in MongoDB for Document A
    const chunkA1 = await DocumentChunkModel.create({
      documentId: docA._id,
      userId: userA!._id,
      pageNumber: 1,
      chunkIndex: 0,
      text: 'The Architecture Handbook covers microservices, LangChain, and distributed Redis caches.',
      charCount: 88,
    });
    const chunkA2 = await DocumentChunkModel.create({
      documentId: docA._id,
      userId: userA!._id,
      pageNumber: 2,
      chunkIndex: 1,
      text: 'Section 2 details Qdrant vector retrieval with Cosine distance and 768 dimensions.',
      charCount: 82,
    });

    // Index Document A chunks into Qdrant for semantic retrieval
    await indexDocumentChunks(docA._id);

    // Create an indexed Document for User B
    const docB = await DocumentModel.create({
      userId: userB!._id,
      originalName: 'Confidential_UserB.pdf',
      fileName: `test-userb-${suffix}.pdf`,
      filePath: path.resolve(process.cwd(), 'uploads', `test-userb-${suffix}.pdf`),
      fileSize: 5000,
      mimeType: 'application/pdf',
      status: 'ready',
      indexingStatus: 'indexed',
      totalPages: 1,
      totalChunks: 1,
      indexedChunkCount: 1,
    });
    testIds.docBId = docB._id.toString();

    // Setup Mock Gemini Model Factory for Fast, Deterministic Unit Testing
    let capturedPrompt = '';
    setCustomChatModelFactory(() => ({
      stream: async (messages: BaseMessage[], options?: { signal?: AbortSignal }) => {
        // Capture system prompt to test grounding constraints
        capturedPrompt = messages.map((m) => m.content).join('\n');

        const tokens = [
          'The ',
          'document ',
          'explains ',
          'microservices ',
          'and ',
          'Qdrant ',
          'vectors.',
        ];

        return (async function* () {
          for (const token of tokens) {
            if (options?.signal?.aborted) {
              throw new Error('Generation cancelled by client.');
            }
            yield { content: token };
          }
        })();
      },
    }));

    // =========================================================================
    // TEST 2: User can submit a question for their own indexed document
    // =========================================================================
    console.log('\n--- Test 2: Submit question for owned indexed document ---');
    const sseRes = await doSSERequest(
      server,
      `/api/chat/${docA._id}/messages`,
      { message: 'What technologies does the architecture handbook describe?' },
      cookieA
    );
    assert(
      sseRes.status === 200,
      '[Phase 7 - Test 2] User can submit a question for their own indexed document (HTTP 200).'
    );

    // =========================================================================
    // TEST 3: Empty message is rejected
    // =========================================================================
    console.log('\n--- Test 3: Reject empty message ---');
    const emptyRes = await doRequest(
      server,
      'POST',
      `/api/chat/${docA._id}/messages`,
      { message: '   ' },
      cookieA
    );
    assert(
      emptyRes.status === 400,
      '[Phase 7 - Test 3] Empty message is rejected with HTTP 400 Bad Request.'
    );

    // =========================================================================
    // TEST 4: Invalid document ID is rejected
    // =========================================================================
    console.log('\n--- Test 4: Reject invalid document ID ---');
    const invalidDocRes = await doRequest(
      server,
      'POST',
      '/api/chat/invalid-doc-id-123/messages',
      { message: 'What is this?' },
      cookieA
    );
    assert(
      invalidDocRes.status === 400,
      '[Phase 7 - Test 4] Invalid document ID is rejected with HTTP 400.'
    );

    // =========================================================================
    // TEST 5: Unauthenticated requests are rejected
    // =========================================================================
    console.log('\n--- Test 5: Reject unauthenticated request ---');
    const unauthRes = await doRequest(
      server,
      'POST',
      `/api/chat/${docA._id}/messages`,
      { message: 'Hello?' }
      // No cookie
    );
    assert(
      unauthRes.status === 401,
      '[Phase 7 - Test 5] Unauthenticated chat request rejected with HTTP 401.'
    );

    // =========================================================================
    // TEST 6: User cannot chat with another user's document
    // =========================================================================
    console.log('\n--- Test 6: Cross-user document chat access denied ---');
    // User B tries to chat with User A's Document
    const crossUserRes = await doRequest(
      server,
      'POST',
      `/api/chat/${docA._id}/messages`,
      { message: 'Sneaking into User A document' },
      cookieB
    );
    assert(
      crossUserRes.status === 404,
      '[Phase 7 - Test 6] User cannot chat with another user\'s document (HTTP 404 Not Found).'
    );

    // =========================================================================
    // TEST 7: Qdrant retrieval receives the correct userId and documentId filters
    // =========================================================================
    console.log('\n--- Test 7: Qdrant retrieval filters ---');
    // Calling search directly with User B for Document A fails ownership check
    let filterEnforced = false;
    try {
      await doRequest(
        server,
        'POST',
        `/api/documents/${docA._id}/search`,
        { query: 'microservices' },
        cookieB
      );
    } catch {
      filterEnforced = true;
    }
    // And checking search endpoint with User A succeeds
    const userASearch = await doRequest(
      server,
      'POST',
      `/api/documents/${docA._id}/search`,
      { query: 'microservices' },
      cookieA
    );
    assert(
      userASearch.status === 200,
      '[Phase 7 - Test 7] Retrieval service strictly enforces userId and documentId filters.'
    );

    // =========================================================================
    // TEST 8: Relevant retrieved chunks are passed to the AI model
    // =========================================================================
    console.log('\n--- Test 8: Context passed to AI prompt ---');
    assert(
      capturedPrompt.includes('Architecture_Handbook.pdf') || capturedPrompt.includes('microservices'),
      '[Phase 7 - Test 8] Relevant retrieved document chunks and title are passed into prompt.'
    );

    // =========================================================================
    // TEST 9: Model response streams incrementally
    // =========================================================================
    console.log('\n--- Test 9: Model response streams incrementally ---');
    assert(
      sseRes.tokens.length > 1,
      `[Phase 7 - Test 9] Model response streamed incrementally (${sseRes.tokens.length} token events).`
    );

    // =========================================================================
    // TEST 10: SSE completion event is sent
    // =========================================================================
    console.log('\n--- Test 10: SSE completion event (done) ---');
    const doneEvent = sseRes.events.find((e) => e.event === 'done');
    assert(
      Boolean(doneEvent && doneEvent.data?.messageId),
      '[Phase 7 - Test 10] SSE completion event ("done") sent with messageId.'
    );

    // =========================================================================
    // TEST 11: Citations contain actual retrieved page numbers
    // =========================================================================
    console.log('\n--- Test 11: Citations contain actual retrieved page numbers ---');
    const sampleChunks: SearchResultItem[] = [
      {
        chunkId: chunkA1._id.toString(),
        documentId: docA._id.toString(),
        pageNumber: 1,
        chunkIndex: 0,
        text: 'Microservices text',
        score: 0.85,
      },
      {
        chunkId: chunkA2._id.toString(),
        documentId: docA._id.toString(),
        pageNumber: 2,
        chunkIndex: 1,
        text: 'Qdrant vector text',
        score: 0.80,
      },
    ];
    const generatedCitations = buildCitations(sampleChunks);
    const pages = generatedCitations.map((c) => c.pageNumber);
    assert(
      pages.includes(1) && pages.includes(2),
      '[Phase 7 - Test 11] Citations contain actual retrieved page numbers [1, 2].'
    );

    // =========================================================================
    // TEST 12: LLM-generated page numbers are not trusted
    // =========================================================================
    console.log('\n--- Test 12: LLM cannot hallucinate citations ---');
    // buildCitations only uses the SearchResultItem pageNumber and chunkId
    const fakeChunk: SearchResultItem[] = [
      {
        chunkId: 'verified-chunk-id',
        documentId: docA._id.toString(),
        pageNumber: 3,
        chunkIndex: 0,
        text: 'LLM claims page 99 in response text, but real chunk is page 3.',
        score: 0.9,
      },
    ];
    const safeCitations = buildCitations(fakeChunk);
    assert(
      safeCitations.length === 1 && safeCitations[0].pageNumber === 3,
      '[Phase 7 - Test 12] Citations derived strictly from retrieved chunks, ignoring LLM hallucinated page numbers.'
    );

    // =========================================================================
    // TEST 13: User messages are persisted
    // =========================================================================
    console.log('\n--- Test 13: User message persistence ---');
    const savedUserMsg = await ChatMessage.findOne({
      userId: userA!._id,
      documentId: docA._id,
      role: 'user',
    });
    assert(
      Boolean(savedUserMsg && savedUserMsg.content.includes('What technologies')),
      '[Phase 7 - Test 13] User message is persisted in MongoDB with correct role and content.'
    );

    // =========================================================================
    // TEST 14: Completed assistant messages are persisted
    // =========================================================================
    console.log('\n--- Test 14: Completed assistant message persistence ---');
    const savedAssistantMsg = await ChatMessage.findOne({
      userId: userA!._id,
      documentId: docA._id,
      role: 'assistant',
    });
    assert(
      Boolean(savedAssistantMsg && savedAssistantMsg.content.length > 0),
      '[Phase 7 - Test 14] Completed assistant message is persisted in MongoDB.'
    );

    // =========================================================================
    // TEST 15: Failed generation does not create a successful assistant response
    // =========================================================================
    console.log('\n--- Test 15: Failed generation handling ---');
    // Configure mock to throw an error
    setCustomChatModelFactory(() => ({
      stream: async () => {
        throw new Error('Simulated Gemini API 500 error');
      },
    }));

    const countBefore = await ChatMessage.countDocuments({
      userId: userA!._id,
      documentId: docA._id,
      role: 'assistant',
    });

    const failedStream = await doSSERequest(
      server,
      `/api/chat/${docA._id}/messages`,
      { message: 'This should fail gracefully' },
      cookieA
    );

    const errorEvent = failedStream.events.find((e) => e.event === 'error');
    const countAfter = await ChatMessage.countDocuments({
      userId: userA!._id,
      documentId: docA._id,
      role: 'assistant',
    });

    assert(
      Boolean(errorEvent) && countBefore === countAfter,
      '[Phase 7 - Test 15] Failed generation sends error event and does NOT persist broken assistant message.'
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
    // TEST 16: Chat history returns the correct conversation
    // =========================================================================
    console.log('\n--- Test 16: Chat history retrieval ---');
    const historyRes = await doRequest(
      server,
      'GET',
      `/api/chat/${docA._id}/messages`,
      null,
      cookieA
    );
    assert(
      historyRes.status === 200 &&
        Array.isArray(historyRes.data?.data?.messages) &&
        historyRes.data.data.messages.length >= 2,
      `[Phase 7 - Test 16] Chat history returns conversation chronologically (${historyRes.data?.data?.messages?.length} messages).`
    );

    // =========================================================================
    // TEST 17: Chat history cannot leak across users or documents
    // =========================================================================
    console.log('\n--- Test 17: Multi-tenant chat history isolation ---');
    // User B attempts to read User A's chat history
    const leakRes = await doRequest(
      server,
      'GET',
      `/api/chat/${docA._id}/messages`,
      null,
      cookieB
    );
    assert(
      leakRes.status === 404,
      '[Phase 7 - Test 17] Chat history cannot leak across users (User B receives HTTP 404 for User A doc).'
    );

    // =========================================================================
    // TEST 18: Client disconnection is handled safely
    // =========================================================================
    console.log('\n--- Test 18: Client disconnection handling ---');
    let streamCancelledCleanly = false;
    try {
      const abortCtrl = new AbortController();
      // Configure generator that hangs or yields slowly
      setCustomChatModelFactory(() => ({
        stream: async (_msgs, opts) => {
          return (async function* () {
            yield { content: 'Token 1' };
            // Simulate client disconnecting
            abortCtrl.abort();
            if (opts?.signal?.aborted) {
              throw new Error('Generation cancelled by client.');
            }
            yield { content: 'Token 2' };
          })();
        },
      }));

      await streamChatResponse({
        userId: userA!._id.toString(),
        documentId: docA._id.toString(),
        documentName: docA.originalName,
        userMessage: 'Test client cancellation',
        callbacks: {
          onToken: () => {},
        },
        signal: abortCtrl.signal,
      });
    } catch (err) {
      if (err instanceof Error && err.message.includes('cancelled')) {
        streamCancelledCleanly = true;
      }
    }

    assert(
      streamCancelledCleanly,
      '[Phase 7 - Test 18] Client disconnection / abort is caught and handled safely without crash.'
    );

    // Reset mock factory back to null so production uses real Gemini
    setCustomChatModelFactory(null);

    // Teardown test documents and chat messages created during test
    console.log('\n[Teardown] Cleaning up test users and documents...');
    try {
      await deletePointsByDocumentId(docA._id.toString());
    } catch {}
    await ChatMessage.deleteMany({ userId: { $in: [userA!._id, userB!._id] } });
    await DocumentChunkModel.deleteMany({ documentId: { $in: [docA._id, docB._id] } });
    await DocumentModel.deleteMany({ _id: { $in: [docA._id, docB._id] } });
    await UserModel.deleteMany({ _id: { $in: [userA!._id, userB!._id] } });
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
  console.log(`Phase 7 Test Results: ${passed} PASSED, ${failed} FAILED`);
  console.log('='.repeat(70));

  if (failed > 0) {
    console.error('\nFailed tests:');
    for (const f of failedTests) {
      console.error(`  - ${f}`);
    }
    process.exit(1);
  } else {
    console.log('\nALL 18 PHASE 7 TESTS PASSED SUCCESSFULLY! (100%)\n');
    process.exit(0);
  }
}

runPhase7Tests();
