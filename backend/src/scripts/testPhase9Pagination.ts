/**
 * Phase 9: Cursor-Based Pagination Test Suite
 *
 * Verifies all 20 required scenarios:
 * 1.  encodeCursor produces a URL-safe Base64URL string containing createdAt and id
 * 2.  decodeCursor accurately reconstructs original Date and ObjectId
 * 3.  decodeCursor returns null for corrupted/malformed Base64 string
 * 4.  decodeCursor returns null for invalid date string in cursor
 * 5.  decodeCursor returns null for invalid ObjectId in cursor
 * 6.  GET /api/documents returns first page with default limit 10 and valid nextCursor
 * 7.  GET /api/documents rejects invalid/tampered cursor with HTTP 400 Bad Request
 * 8.  GET /api/documents with cursor fetches the next page without skipping or duplicating items
 * 9.  Compound comparison correctly handles documents with identical createdAt timestamps via _id tie-breaker
 * 10. Cursor pagination enforces limit upper bound (clamps to max 50)
 * 11. Last page of documents returns hasMore: false and nextCursor: null
 * 12. Document cursor pagination strictly isolates user data (User A never sees User B's documents)
 * 13. GET /api/chat/:documentId/messages returns first page with default limit 20 and valid nextCursor
 * 14. GET /api/chat/:documentId/messages rejects invalid/tampered cursor with HTTP 400 Bad Request
 * 15. GET /api/chat/:documentId/messages with cursor retrieves older messages with stable ordering
 * 16. Messages with identical timestamps paginate predictably without duplicates
 * 17. Last page of chat history returns hasMore: false and nextCursor: null
 * 18. Chat history pagination strictly enforces multi-tenant document ownership
 * 19. Document model index { userId: 1, createdAt: -1, _id: -1 } is verified in Mongoose schema
 * 20. ChatMessage model index { userId: 1, documentId: 1, createdAt: -1, _id: -1 } is verified in Mongoose schema
 *
 * Run: npm run test:phase9
 */

import path from 'path';
import http from 'http';
import { Types } from 'mongoose';
import dotenv from 'dotenv';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });
dotenv.config({ path: path.resolve(process.cwd(), 'backend', '.env') });

import { connectDatabase, disconnectDatabase } from '../config/database';
import { connectRedis, disconnectRedis } from '../config/redis';
import { DocumentModel } from '../modules/documents/document.model';
import { User as UserModel } from '../modules/auth/user.model';
import { ChatMessage } from '../modules/chat/chat.model';
import {
  encodeCursor,
  decodeCursor,
  buildDescendingCursorFilter,
} from '../utils/cursor';
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
    fail(label, detail);
  }
}

/** Helper to make HTTP requests against the in-memory test server */
function doRequest(
  server: http.Server,
  method: string,
  urlPath: string,
  body?: unknown,
  cookie?: string
): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: any; setCookie?: string }> {
  return new Promise((resolve, reject) => {
    const port = (server.address() as { port: number }).port;
    const jsonBody = body ? JSON.stringify(body) : undefined;

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (jsonBody) {
      headers['Content-Length'] = Buffer.byteLength(jsonBody).toString();
    }
    if (cookie) {
      headers['Cookie'] = cookie;
    }

    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        path: urlPath,
        method,
        headers,
      },
      (res) => {
        let raw = '';
        res.on('data', (chunk) => {
          raw += chunk;
        });
        res.on('end', () => {
          let parsed: any;
          try {
            parsed = JSON.parse(raw);
          } catch {
            parsed = raw;
          }
          const rawCookie = res.headers['set-cookie'];
          const setCookie = Array.isArray(rawCookie) ? rawCookie[0]?.split(';')[0] : rawCookie;
          resolve({
            status: res.statusCode || 500,
            headers: res.headers,
            body: parsed,
            setCookie,
          });
        });
      }
    );

    req.on('error', reject);
    if (jsonBody) {
      req.write(jsonBody);
    }
    req.end();
  });
}

async function runPhase9Tests() {
  console.log('='.repeat(70));
  console.log('Phase 9: Cursor-Based Pagination Test Suite');
  console.log('='.repeat(70));

  let server: http.Server | undefined;
  const userIdsToCleanup: Types.ObjectId[] = [];
  const docIdsToCleanup: Types.ObjectId[] = [];
  const messageIdsToCleanup: Types.ObjectId[] = [];

  try {
    // 0. Connect DB and Redis, start HTTP server
    console.log('\n[Setup] Connecting to MongoDB Atlas and Redis...');
    await connectDatabase();
    await connectRedis();

    const app = createApp();
    server = http.createServer(app);
    await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as { port: number }).port;
    console.log(`[Setup] Server listening on port ${port}`);

    // =========================================================================
    // TEST 1-5: Cursor Utility Encoding, Decoding, and Validation
    // =========================================================================
    console.log('\n--- Tests 1-5: Cursor utility encode/decode/validation ---');

    const testDate = new Date('2026-11-19T10:00:00.000Z');
    const testId = new Types.ObjectId('6afec7618ff825c3062a04df');

    // Test 1: encodeCursor produces URL-safe Base64URL string
    const encoded = encodeCursor(testDate, testId);
    assert(
      typeof encoded === 'string' &&
        encoded.length > 0 &&
        !encoded.includes('+') &&
        !encoded.includes('/') &&
        !encoded.includes('='),
      `[Phase 9 - Test 1] encodeCursor produces valid Base64URL string: ${encoded}`
    );

    // Test 2: decodeCursor reconstructs original Date and ObjectId
    const decoded = decodeCursor(encoded);
    assert(
      decoded !== null &&
        decoded.createdAt.toISOString() === testDate.toISOString() &&
        decoded.id.toString() === testId.toString(),
      '[Phase 9 - Test 2] decodeCursor accurately reconstructs original Date and ObjectId.'
    );

    // Test 3: decodeCursor returns null for corrupted Base64 string
    const invalidBase64 = '!!!not-a-valid-base64url-string!!!';
    assert(
      decodeCursor(invalidBase64) === null,
      '[Phase 9 - Test 3] decodeCursor returns null for corrupted/malformed cursor string.'
    );

    // Test 4: decodeCursor returns null for invalid date string
    const badDateCursor = Buffer.from(
      JSON.stringify({ createdAt: 'invalid-date-not-an-iso', id: testId.toString() })
    ).toString('base64url');
    assert(
      decodeCursor(badDateCursor) === null,
      '[Phase 9 - Test 4] decodeCursor returns null for invalid date in cursor payload.'
    );

    // Test 5: decodeCursor returns null for invalid ObjectId
    const badIdCursor = Buffer.from(
      JSON.stringify({ createdAt: testDate.toISOString(), id: 'not-an-objectid' })
    ).toString('base64url');
    assert(
      decodeCursor(badIdCursor) === null,
      '[Phase 9 - Test 5] decodeCursor returns null for invalid ObjectId in cursor payload.'
    );

    // =========================================================================
    // SETUP: Register Test Users A and B
    // =========================================================================
    console.log('\n--- Setup Test Users & Fixtures ---');
    const suffix = Date.now();
    const userAEmail = `cursor_usera_${suffix}@example.com`;
    const userBEmail = `cursor_userb_${suffix}@example.com`;

    const regA = await doRequest(server, 'POST', '/api/auth/register', {
      name: 'Cursor User A',
      email: userAEmail,
      password: 'Password123!',
    });
    const cookieA = regA.setCookie;
    const userA = await UserModel.findOne({ email: userAEmail });
    userIdsToCleanup.push(userA!._id);

    const regB = await doRequest(server, 'POST', '/api/auth/register', {
      name: 'Cursor User B',
      email: userBEmail,
      password: 'Password123!',
    });
    const cookieB = regB.setCookie;
    const userB = await UserModel.findOne({ email: userBEmail });
    userIdsToCleanup.push(userB!._id);

    // Create 15 documents for User A with strictly descending createdAt times
    // and two documents with the EXACT same createdAt timestamp to verify tie-breaking
    const baseTime = Date.now();
    const identicalTime = new Date(baseTime - 75000);

    for (let i = 0; i < 15; i++) {
      const docTime =
        i === 7 || i === 8
          ? identicalTime // Identical timestamp for docs 7 and 8 to test tie-breaking
          : new Date(baseTime - i * 10000);

      const doc = await DocumentModel.create({
        userId: userA!._id,
        originalName: `Doc_Page_Test_${i + 1}.pdf`,
        fileName: `doc-page-test-${suffix}-${i + 1}.pdf`,
        filePath: path.resolve(process.cwd(), 'uploads', `doc-page-test-${suffix}-${i + 1}.pdf`),
        fileSize: 1000 + i,
        mimeType: 'application/pdf',
        status: 'ready',
        indexingStatus: 'indexed',
      });
      // Override via raw MongoDB collection so Mongoose timestamps middleware does not touch it
      await DocumentModel.collection.updateOne(
        { _id: doc._id },
        { $set: { createdAt: docTime, updatedAt: docTime } }
      );
      docIdsToCleanup.push(doc._id);
    }

    // Create 3 documents for User B (to test multi-tenant isolation)
    for (let i = 0; i < 3; i++) {
      const docB = await DocumentModel.create({
        userId: userB!._id,
        originalName: `UserB_Doc_${i + 1}.pdf`,
        fileName: `userb-doc-${suffix}-${i + 1}.pdf`,
        filePath: path.resolve(process.cwd(), 'uploads', `userb-doc-${suffix}-${i + 1}.pdf`),
        fileSize: 2000 + i,
        mimeType: 'application/pdf',
        status: 'ready',
        indexingStatus: 'indexed',
      });
      docIdsToCleanup.push(docB._id);
    }

    // =========================================================================
    // TEST 6: GET /api/documents returns first page (default limit 10) with nextCursor
    // =========================================================================
    console.log('\n--- Test 6: First page documents cursor pagination ---');
    const docPage1Res = await doRequest(server, 'GET', '/api/documents', undefined, cookieA);
    const docPage1Data = docPage1Res.body.data;

    assert(
      docPage1Res.status === 200 &&
        docPage1Data.documents.length === 10 &&
        docPage1Data.pagination.hasMore === true &&
        typeof docPage1Data.pagination.nextCursor === 'string' &&
        docPage1Data.pagination.limit === 10,
      `[Phase 9 - Test 6] First page returns 10 documents, hasMore: true, nextCursor present.`
    );

    const docCursor1 = docPage1Data.pagination.nextCursor;

    // =========================================================================
    // TEST 7: GET /api/documents rejects invalid cursor with HTTP 400
    // =========================================================================
    console.log('\n--- Test 7: Reject invalid cursor with HTTP 400 ---');
    const badDocCursorRes = await doRequest(
      server,
      'GET',
      '/api/documents?cursor=malformed_not_base64url',
      undefined,
      cookieA
    );
    assert(
      badDocCursorRes.status === 400,
      `[Phase 9 - Test 7] Invalid cursor query parameter rejected with HTTP 400 Bad Request.`
    );

    // =========================================================================
    // TEST 8: GET /api/documents with cursor fetches next page without skips or duplicates
    // =========================================================================
    console.log('\n--- Test 8: Page 2 documents with cursor ---');
    const docPage2Res = await doRequest(
      server,
      'GET',
      `/api/documents?cursor=${docCursor1}`,
      undefined,
      cookieA
    );
    const docPage2Data = docPage2Res.body.data;

    const page1DocIds = new Set(docPage1Data.documents.map((d: any) => d.id || d._id));
    const page2DocIds = docPage2Data.documents.map((d: any) => d.id || d._id);
    const hasDuplicates = page2DocIds.some((id: string) => page1DocIds.has(id));

    assert(
      docPage2Res.status === 200 &&
        docPage2Data.documents.length === 5 &&
        !hasDuplicates,
      `[Phase 9 - Test 8] Page 2 fetches remaining 5 docs without duplicates (0 overlapping IDs).`
    );

    // =========================================================================
    // TEST 9: Stable tie-breaking for documents with identical timestamps
    // =========================================================================
    console.log('\n--- Test 9: Identical timestamp tie-breaking ---');
    // Combine page 1 and page 2 docs
    const allFetchedDocs = [...docPage1Data.documents, ...docPage2Data.documents];
    const docsWithIdenticalTime = allFetchedDocs.filter(
      (d: any) => new Date(d.createdAt).getTime() === identicalTime.getTime()
    );
    if (docsWithIdenticalTime.length !== 2) {
      console.log('Test 9 debug - expected identicalTime:', identicalTime.toISOString(), 'found count:', docsWithIdenticalTime.length);
      console.log('Sample fetched doc dates:', allFetchedDocs.slice(5, 11).map((d: any) => d.createdAt));
    }

    assert(
      docsWithIdenticalTime.length === 2 &&
        docsWithIdenticalTime[0].id !== docsWithIdenticalTime[1].id,
      `[Phase 9 - Test 9] Two documents with identical createdAt timestamps tie-broken by _id cleanly.`
    );

    // =========================================================================
    // TEST 10: Limit upper bound enforcement (clamp to 50)
    // =========================================================================
    console.log('\n--- Test 10: Max limit enforcement ---');
    const maxLimitRes = await doRequest(
      server,
      'GET',
      '/api/documents?limit=1000',
      undefined,
      cookieA
    );
    assert(
      maxLimitRes.status === 200 && maxLimitRes.body.data.pagination.limit === 50,
      `[Phase 9 - Test 10] Requested limit 1000 clamped to maximum 50.`
    );

    // =========================================================================
    // TEST 11: Last page hasMore: false and nextCursor: null
    // =========================================================================
    console.log('\n--- Test 11: Last page pagination termination ---');
    assert(
      docPage2Data.pagination.hasMore === false && docPage2Data.pagination.nextCursor === null,
      `[Phase 9 - Test 11] Last page returns hasMore: false and nextCursor: null.`
    );

    // =========================================================================
    // TEST 12: Document cursor pagination multi-tenant isolation
    // =========================================================================
    console.log('\n--- Test 12: Document multi-tenant isolation ---');
    const userBDocsRes = await doRequest(server, 'GET', '/api/documents', undefined, cookieB);
    const userBDocsData = userBDocsRes.body.data;
    const userBDocIds = new Set(userBDocsData.documents.map((d: any) => d.id || d._id));
    const leaked = allFetchedDocs.some((d: any) => userBDocIds.has(d.id || d._id));

    assert(
      userBDocsRes.status === 200 &&
        userBDocsData.documents.length === 3 &&
        !leaked,
      `[Phase 9 - Test 12] User B sees only their 3 documents; zero leakage of User A documents.`
    );

    // =========================================================================
    // SETUP CHAT MESSAGES FOR DOCUMENT 1
    // =========================================================================
    console.log('\n--- Setup Chat Messages Fixtures (25 messages) ---');
    const targetDoc = docPage1Data.documents[0];
    const targetDocId = new Types.ObjectId(targetDoc.id || targetDoc._id);

    // Create 25 messages in chronological sequence
    // Two messages share identical timestamp to test tie-breaking
    const chatBaseTime = Date.now() - 300000;
    const chatIdenticalTime = new Date(chatBaseTime + 62500);

    for (let i = 0; i < 25; i++) {
      const msgTime =
        i === 12 || i === 13
          ? chatIdenticalTime
          : new Date(chatBaseTime + i * 5000);

      const msg = await ChatMessage.create({
        userId: userA!._id,
        documentId: targetDocId,
        role: i % 2 === 0 ? 'user' : 'assistant',
        content: `Chat message #${i + 1} for pagination testing.`,
        citations: [],
      });
      // Override via raw MongoDB collection so Mongoose timestamps middleware does not touch it
      await ChatMessage.collection.updateOne(
        { _id: msg._id },
        { $set: { createdAt: msgTime, updatedAt: msgTime } }
      );
      messageIdsToCleanup.push(msg._id);
    }

    // =========================================================================
    // TEST 13: GET /api/chat/:documentId/messages returns first page (default limit 20) with nextCursor
    // =========================================================================
    console.log('\n--- Test 13: Chat history cursor pagination (first page) ---');
    const chatPage1Res = await doRequest(
      server,
      'GET',
      `/api/chat/${targetDocId}/messages`,
      undefined,
      cookieA
    );
    const chatPage1Data = chatPage1Res.body.data;

    assert(
      chatPage1Res.status === 200 &&
        chatPage1Data.messages.length === 20 &&
        chatPage1Data.pagination.hasMore === true &&
        typeof chatPage1Data.pagination.nextCursor === 'string' &&
        chatPage1Data.pagination.limit === 20,
      `[Phase 9 - Test 13] Chat history page 1 returns 20 messages, hasMore: true, nextCursor present.`
    );

    const chatCursor1 = chatPage1Data.pagination.nextCursor;

    // =========================================================================
    // TEST 14: GET /api/chat/:documentId/messages rejects invalid cursor with HTTP 400
    // =========================================================================
    console.log('\n--- Test 14: Chat history rejects invalid cursor ---');
    const badChatCursorRes = await doRequest(
      server,
      'GET',
      `/api/chat/${targetDocId}/messages?cursor=invalid_cursor_xyz`,
      undefined,
      cookieA
    );
    assert(
      badChatCursorRes.status === 400,
      `[Phase 9 - Test 14] Invalid cursor on chat history rejected with HTTP 400 Bad Request.`
    );

    // =========================================================================
    // TEST 15: GET /api/chat/:documentId/messages with cursor retrieves older messages
    // =========================================================================
    console.log('\n--- Test 15: Chat history page 2 with cursor (older messages) ---');
    const chatPage2Res = await doRequest(
      server,
      'GET',
      `/api/chat/${targetDocId}/messages?cursor=${chatCursor1}`,
      undefined,
      cookieA
    );
    const chatPage2Data = chatPage2Res.body.data;

    const page1MsgIds = new Set(chatPage1Data.messages.map((m: any) => m.id));
    const page2MsgIds = chatPage2Data.messages.map((m: any) => m.id);
    const hasChatDuplicates = page2MsgIds.some((id: string) => page1MsgIds.has(id));

    assert(
      chatPage2Res.status === 200 &&
        chatPage2Data.messages.length === 5 &&
        !hasChatDuplicates,
      `[Phase 9 - Test 15] Chat page 2 retrieves remaining 5 older messages without duplicates.`
    );

    // =========================================================================
    // TEST 16: Chat messages with identical timestamps tie-broken predictably
    // =========================================================================
    console.log('\n--- Test 16: Chat identical timestamp tie-breaking ---');
    const allChatMsgs = [...chatPage2Data.messages, ...chatPage1Data.messages];
    const msgsWithIdenticalTime = allChatMsgs.filter(
      (m: any) => new Date(m.createdAt).getTime() === chatIdenticalTime.getTime()
    );

    assert(
      msgsWithIdenticalTime.length === 2 &&
        msgsWithIdenticalTime[0].id !== msgsWithIdenticalTime[1].id,
      `[Phase 9 - Test 16] Chat messages with identical timestamps tie-broken cleanly via _id.`
    );

    // =========================================================================
    // TEST 17: Last page of chat history returns hasMore: false and nextCursor: null
    // =========================================================================
    console.log('\n--- Test 17: Chat last page termination ---');
    assert(
      chatPage2Data.pagination.hasMore === false && chatPage2Data.pagination.nextCursor === null,
      `[Phase 9 - Test 17] Chat history last page returns hasMore: false and nextCursor: null.`
    );

    // =========================================================================
    // TEST 18: Chat history pagination multi-tenant document isolation
    // =========================================================================
    console.log('\n--- Test 18: Chat multi-tenant isolation ---');
    const userBChatRes = await doRequest(
      server,
      'GET',
      `/api/chat/${targetDocId}/messages`,
      undefined,
      cookieB
    );
    assert(
      userBChatRes.status === 404,
      `[Phase 9 - Test 18] User B cannot access chat history or pagination for User A's document (HTTP 404).`
    );

    // =========================================================================
    // TEST 19: Document Model Compound Index Verification
    // =========================================================================
    console.log('\n--- Test 19: Document Model index verification ---');
    const docIndexes = DocumentModel.schema.indexes();
    const hasDocPaginationIndex = docIndexes.some(([indexSpec]) => {
      const keys = Object.keys(indexSpec);
      return (
        keys.length === 3 &&
        indexSpec.userId === 1 &&
        indexSpec.createdAt === -1 &&
        indexSpec._id === -1
      );
    });

    assert(
      hasDocPaginationIndex,
      '[Phase 9 - Test 19] DocumentModel defines compound index { userId: 1, createdAt: -1, _id: -1 }.'
    );

    // =========================================================================
    // TEST 20: ChatMessage Model Compound Index Verification
    // =========================================================================
    console.log('\n--- Test 20: ChatMessage Model index verification ---');
    const chatIndexes = ChatMessage.schema.indexes();
    const hasChatPaginationIndex = chatIndexes.some(([indexSpec]) => {
      const keys = Object.keys(indexSpec);
      return (
        keys.length === 4 &&
        indexSpec.userId === 1 &&
        indexSpec.documentId === 1 &&
        indexSpec.createdAt === -1 &&
        indexSpec._id === -1
      );
    });

    assert(
      hasChatPaginationIndex,
      '[Phase 9 - Test 20] ChatMessage defines compound index { userId: 1, documentId: 1, createdAt: -1, _id: -1 }.'
    );

    // Teardown test artifacts
    console.log('\n[Teardown] Cleaning up test data...');
    await ChatMessage.deleteMany({ _id: { $in: messageIdsToCleanup } });
    await DocumentModel.deleteMany({ _id: { $in: docIdsToCleanup } });
    await UserModel.deleteMany({ _id: { $in: userIdsToCleanup } });
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
  console.log(`Phase 9 Test Results: ${passed} PASSED, ${failed} FAILED`);
  console.log('='.repeat(70));

  if (failed > 0) {
    console.error('\nFailed tests:');
    for (const f of failedTests) {
      console.error(`  - ${f}`);
    }
    process.exit(1);
  } else {
    console.log('\nALL 20 PHASE 9 TESTS PASSED SUCCESSFULLY! (100%)\n');
    process.exit(0);
  }
}

runPhase9Tests();
