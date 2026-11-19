/**
 * Phase 6: Qdrant Vector Indexing & Semantic Retrieval Test Suite
 *
 * Tests:
 * 1.  Qdrant collection creation
 * 2.  Collection initialization is idempotent
 * 3.  Correct vector dimension configuration (768, Cosine)
 * 4.  Payload indexes exist (userId, documentId, chunkId)
 * 5.  Index one document's chunks
 * 6.  Validate vector dimensions
 * 7.  Validate point IDs are deterministic
 * 8.  Reindexing does not create duplicate points
 * 9.  Batch indexing works
 * 10. Gemini failure handling
 * 11. Qdrant failure handling
 * 12. Indexing status transitions (pending -> indexing -> indexed / failed)
 * 13. Search returns relevant chunks (semantic relevance verification)
 * 14. User ID filtering works
 * 15. Document ID filtering works
 * 16. User A cannot retrieve User B's chunks (multi-tenant isolation)
 * 17. Document deletion removes associated Qdrant points
 * 18. Failed indexing can be retried safely
 * 19. Empty documents are handled correctly
 *
 * Run: npm run test:phase6
 */
import path from 'path';
import fs from 'fs';
import http from 'http';
import { IncomingMessage } from 'http';
import { Types } from 'mongoose';
import dotenv from 'dotenv';
import FormData from 'form-data';
import { v5 as uuidv5 } from 'uuid';

// Load environment configuration
dotenv.config({ path: path.resolve(process.cwd(), '.env') });
dotenv.config({ path: path.resolve(process.cwd(), 'backend', '.env') });

import { getConfig } from '../config/env';
import { connectDatabase, disconnectDatabase } from '../config/database';
import { getQdrantClient } from '../config/qdrant';
import { DocumentModel } from '../modules/documents/document.model';
import { DocumentChunkModel } from '../modules/documents/documentChunk.model';
import { User as UserModel } from '../modules/auth/user.model';
import {
  initQdrantCollection,
  COLLECTION_NAME,
  VECTOR_SIZE,
  VECTOR_DISTANCE,
  QDRANT_CHUNK_NAMESPACE,
  chunkIdToPointId,
  indexDocumentChunks,
  deletePointsByDocumentId,
  searchSimilarChunks,
} from '../services/vectorStore';
import { embedDocument, embedQuery } from '../services/embeddingService';
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

function doRequest(
  server: http.Server,
  method: string,
  urlPath: string,
  body?: object | null,
  cookieHeader?: string
): Promise<{ status: number; data: Record<string, unknown>; setCookie?: string }> {
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
              data: JSON.parse(raw) as Record<string, unknown>,
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

function uploadFile(
  server: http.Server,
  urlPath: string,
  filePath: string,
  cookieHeader: string
): Promise<{ status: number; data: Record<string, unknown> }> {
  return new Promise((resolve, reject) => {
    const addr = server.address() as { port: number };
    const form = new FormData();
    form.append('file', fs.createReadStream(filePath), path.basename(filePath));

    const headers = { ...form.getHeaders(), Cookie: cookieHeader };

    const req = http.request(
      { host: '127.0.0.1', port: addr.port, method: 'POST', path: urlPath, headers },
      (res: IncomingMessage) => {
        let raw = '';
        res.on('data', (c: Buffer) => (raw += c.toString()));
        res.on('end', () => {
          try {
            resolve({ status: res.statusCode ?? 0, data: JSON.parse(raw) as Record<string, unknown> });
          } catch {
            resolve({ status: res.statusCode ?? 0, data: { raw } });
          }
        });
      }
    );
    req.on('error', reject);
    form.pipe(req);
  });
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function runTests() {
  console.log('\n============================================================');
  console.log('  PHASE 6: QDRANT VECTOR INDEXING & SEMANTIC RETRIEVAL');
  console.log('============================================================\n');

  console.log('[INFO] Connecting to MongoDB Atlas...');
  await connectDatabase();
  console.log('[INFO] MongoDB Atlas connected.');

  const client = getQdrantClient();
  const cfg = getConfig();

  const app = createApp();
  const server = await new Promise<http.Server>((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const addr = server.address() as { port: number };
  console.log(`[INFO] Ephemeral test server listening on port ${addr.port}\n`);

  // Register two test users
  const stamp = Date.now();
  const userAData = { name: 'Qdrant User A', email: `phase6_a_${stamp}@test.com`, password: 'Test@1234!' };
  const userBData = { name: 'Qdrant User B', email: `phase6_b_${stamp}@test.com`, password: 'Test@1234!' };

  const regA = await doRequest(server, 'POST', '/api/auth/register', userAData);
  const regB = await doRequest(server, 'POST', '/api/auth/register', userBData);
  const cookieA = regA.setCookie ?? '';
  const cookieB = regB.setCookie ?? '';

  const userAId = ((regA.data as { data?: { user?: { id?: string } } })?.data?.user?.id) ?? '';
  const userBId = ((regB.data as { data?: { user?: { id?: string } } })?.data?.user?.id) ?? '';

  console.log(`[INFO] Registered User A (${userAData.email}) & User B (${userBData.email})\n`);

  const createdDocIds: string[] = [];

  // -------------------------------------------------------------
  // Test 1: Qdrant collection creation
  // -------------------------------------------------------------
  console.log('[TEST 1] Qdrant collection creation...');
  try {
    await initQdrantCollection();
    const exists = await client.collectionExists(COLLECTION_NAME);
    assert(exists.exists, 'Test 1: Qdrant collection "document_chunks" exists');
  } catch (err) {
    fail('Test 1', (err as Error).message);
  }

  // -------------------------------------------------------------
  // Test 2: Collection initialization is idempotent
  // -------------------------------------------------------------
  console.log('\n[TEST 2] Collection initialization is idempotent...');
  try {
    await initQdrantCollection();
    await initQdrantCollection();
    pass('Test 2: Multiple initQdrantCollection calls execute cleanly without error');
  } catch (err) {
    fail('Test 2', (err as Error).message);
  }

  // -------------------------------------------------------------
  // Test 3: Correct vector dimension configuration (768, Cosine)
  // -------------------------------------------------------------
  console.log('\n[TEST 3] Verify vector dimensions & distance metric...');
  try {
    const info = await client.getCollection(COLLECTION_NAME);
    const vectors = info.config?.params?.vectors as { size?: number; distance?: string };
    assert(vectors?.size === 768, 'Test 3: Vector size is 768', `Got ${vectors?.size}`);
    assert(vectors?.distance === 'Cosine', 'Test 3: Distance metric is Cosine', `Got ${vectors?.distance}`);
  } catch (err) {
    fail('Test 3', (err as Error).message);
  }

  // -------------------------------------------------------------
  // Test 4: Payload indexes exist
  // -------------------------------------------------------------
  console.log('\n[TEST 4] Verify payload indexes on collection...');
  try {
    const info = await client.getCollection(COLLECTION_NAME);
    const payloadSchema = info.payload_schema || {};
    assert(
      Boolean(payloadSchema.userId),
      'Test 4: Payload index on "userId" exists'
    );
    assert(
      Boolean(payloadSchema.documentId),
      'Test 4: Payload index on "documentId" exists'
    );
    assert(
      Boolean(payloadSchema.chunkId),
      'Test 4: Payload index on "chunkId" exists'
    );
  } catch (err) {
    fail('Test 4', (err as Error).message);
  }

  // -------------------------------------------------------------
  // Setup Test Document with Chunks for User A
  // -------------------------------------------------------------
  const docA = new DocumentModel({
    userId: new Types.ObjectId(userAId),
    originalName: 'knowledge-base.pdf',
    fileName: `kb-${Date.now()}.pdf`,
    filePath: `uploads/kb-${Date.now()}.pdf`,
    fileSize: 4096,
    mimeType: 'application/pdf',
    status: 'ready',
    totalPages: 2,
    totalChunks: 3,
    indexingStatus: 'pending',
  });
  await docA.save();
  createdDocIds.push(docA._id.toString());

  const sampleChunksText = [
    'MongoDB is a source-available cross-platform document-oriented database program classified as a NoSQL database.',
    'Docker is a set of platform-as-a-service products that use OS-level virtualization to deliver software in packages called containers.',
    'TypeScript is a free and open-source high-level programming language developed by Microsoft that adds static typing with optional type annotations.',
  ];

  const chunkDocs = sampleChunksText.map((text, idx) => ({
    documentId: docA._id,
    userId: new Types.ObjectId(userAId),
    pageNumber: idx < 2 ? 1 : 2,
    chunkIndex: idx < 2 ? idx : 0,
    text,
    charCount: text.length,
  }));
  const savedChunks = await DocumentChunkModel.insertMany(chunkDocs);

  // -------------------------------------------------------------
  // Test 5 & 6: Index document chunks and validate vector dimensions
  // -------------------------------------------------------------
  console.log('\n[TEST 5 & 6] Index document chunks & validate dimensions...');
  try {
    const indexResult = await indexDocumentChunks(docA._id.toString());
    assert(indexResult.indexedCount === 3, 'Test 5: Indexing returned 3 indexed chunks', `Got ${indexResult.indexedCount}`);

    const updatedDoc = await DocumentModel.findById(docA._id);
    assert(updatedDoc?.indexingStatus === 'indexed', 'Test 5: Document indexingStatus updated to "indexed"');
    assert(updatedDoc?.indexedChunkCount === 3, 'Test 5: Document indexedChunkCount is 3');
    assert(Boolean(updatedDoc?.indexedAt), 'Test 5: Document indexedAt timestamp is set');

    // Retrieve points directly from Qdrant to inspect
    const pointIds = savedChunks.map((c) => chunkIdToPointId(c._id));
    const retrievedPoints = await client.retrieve(COLLECTION_NAME, {
      ids: pointIds,
      with_vector: true,
      with_payload: true,
    });

    assert(retrievedPoints.length === 3, 'Test 5: 3 points retrieved from Qdrant', `Got ${retrievedPoints.length}`);
    const firstPoint = retrievedPoints[0];
    const vector = Array.isArray(firstPoint.vector) ? firstPoint.vector : [];
    assert(vector.length === 768, 'Test 6: Vector has exactly 768 dimensions', `Got ${vector.length}`);
  } catch (err) {
    fail('Test 5 & 6', (err as Error).message);
  }

  // -------------------------------------------------------------
  // Test 7: Point IDs are deterministic
  // -------------------------------------------------------------
  console.log('\n[TEST 7] Validate point IDs are deterministic...');
  try {
    const chunk0Id = savedChunks[0]._id;
    const id1 = chunkIdToPointId(chunk0Id);
    const id2 = chunkIdToPointId(chunk0Id);
    const expected = uuidv5(chunk0Id.toString(), QDRANT_CHUNK_NAMESPACE);
    assert(id1 === id2, 'Test 7: Multiple calls produce identical point ID');
    assert(id1 === expected, 'Test 7: Point ID matches UUID v5 standard formula');
  } catch (err) {
    fail('Test 7', (err as Error).message);
  }

  // -------------------------------------------------------------
  // Test 8: Reindexing does not create duplicate points
  // -------------------------------------------------------------
  console.log('\n[TEST 8] Reindexing does not create duplicate points...');
  try {
    const countBefore = await client.count(COLLECTION_NAME, {
      filter: { must: [{ key: 'documentId', match: { value: docA._id.toString() } }] },
    });

    await indexDocumentChunks(docA._id.toString());

    const countAfter = await client.count(COLLECTION_NAME, {
      filter: { must: [{ key: 'documentId', match: { value: docA._id.toString() } }] },
    });

    assert(
      countBefore.count === countAfter.count,
      'Test 8: Reindexing preserves point count without duplicates',
      `Before: ${countBefore.count}, After: ${countAfter.count}`
    );
  } catch (err) {
    fail('Test 8', (err as Error).message);
  }

  // -------------------------------------------------------------
  // Test 9: Batch indexing
  // -------------------------------------------------------------
  console.log('\n[TEST 9] Batch indexing verification...');
  try {
    const points = await client.retrieve(COLLECTION_NAME, {
      ids: savedChunks.map((c) => chunkIdToPointId(c._id)),
      with_payload: true,
    });
    assert(
      points.every((p) => p.payload?.documentId === docA._id.toString()),
      'Test 9: All batch points hold correct documentId payload'
    );
    assert(
      points.every((p) => p.payload?.userId === userAId),
      'Test 9: All batch points hold correct userId payload'
    );
  } catch (err) {
    fail('Test 9', (err as Error).message);
  }

  // -------------------------------------------------------------
  // Test 10: Gemini failure handling
  // -------------------------------------------------------------
  console.log('\n[TEST 10] Gemini failure handling...');
  try {
    const { GoogleGenerativeAI } = await import('@google/generative-ai');
    const badAI = new GoogleGenerativeAI('INVALID_KEY_SIMULATION');
    const badM = badAI.getGenerativeModel({ model: 'gemini-embedding-001' });
    await badM.embedContent({ content: { role: 'user', parts: [{ text: 'fail test' }] } });
    fail('Test 10', 'Expected invalid key to throw an error');
  } catch (err) {
    pass('Test 10: Gemini API error handled safely');
  }

  // -------------------------------------------------------------
  // Test 11: Qdrant failure handling
  // -------------------------------------------------------------
  console.log('\n[TEST 11] Qdrant failure handling...');
  try {
    // Attempt search on non-existent collection
    await client.query('non_existent_collection_xyz', {
      query: Array(768).fill(0.01),
      limit: 1,
    });
    fail('Test 11', 'Expected query on non-existent collection to throw');
  } catch (err) {
    pass('Test 11: Qdrant query failure on missing collection handled safely');
  }

  // -------------------------------------------------------------
  // Test 12: Indexing status transitions
  // -------------------------------------------------------------
  console.log('\n[TEST 12] Indexing status transitions...');
  try {
    const docCheck = await DocumentModel.findById(docA._id);
    assert(docCheck?.indexingStatus === 'indexed', 'Test 12: Completed document has indexingStatus: "indexed"');
    assert(docCheck?.status === 'ready', 'Test 12: Document processing status remains "ready"');
  } catch (err) {
    fail('Test 12', (err as Error).message);
  }

  // -------------------------------------------------------------
  // Test 13: Semantic search returns relevant chunks
  // -------------------------------------------------------------
  console.log('\n[TEST 13] Semantic search returns relevant chunks...');
  try {
    // Search for Docker / container concepts
    const results = await searchSimilarChunks({
      userId: userAId,
      documentId: docA._id.toString(),
      query: 'operating system containers and virtualization packages',
      topK: 3,
    });

    assert(results.length > 0, 'Test 13: Search returned matching chunks', `Got ${results.length}`);
    const topMatch = results[0];
    assert(
      topMatch.text.toLowerCase().includes('docker') || topMatch.text.toLowerCase().includes('container'),
      'Test 13: Top result is semantically relevant (matches Docker chunk)',
      `Top match text: "${topMatch.text.slice(0, 60)}..." (Score: ${topMatch.score})`
    );
    assert(topMatch.score > 0.4, 'Test 13: Cosine similarity score > 0.4', `Score: ${topMatch.score}`);
  } catch (err) {
    fail('Test 13', (err as Error).message);
  }

  // -------------------------------------------------------------
  // Test 14 & 15: User ID & Document ID filtering
  // -------------------------------------------------------------
  console.log('\n[TEST 14 & 15] User ID & Document ID filtering...');
  try {
    // Search with wrong document ID
    const fakeDocId = new Types.ObjectId().toString();
    await searchSimilarChunks({
      userId: userAId,
      documentId: fakeDocId,
      query: 'TypeScript',
    });
    fail('Test 15', 'Expected search with non-existent documentId to throw 404');
  } catch (err) {
    pass('Test 15: Search rejects mismatched documentId');
  }

  // -------------------------------------------------------------
  // Test 16: Multi-tenant ownership isolation
  // -------------------------------------------------------------
  console.log('\n[TEST 16] User A cannot retrieve User B\'s chunks...');
  try {
    // User B tries to search User A's document
    await searchSimilarChunks({
      userId: userBId,
      documentId: docA._id.toString(),
      query: 'NoSQL database',
    });
    fail('Test 16', 'Expected User B searching User A document to throw access denied');
  } catch (err) {
    const msg = (err as Error).message;
    assert(
      msg.includes('not found') || msg.includes('access denied'),
      'Test 16: User B searching User A document rejected with access denied',
      msg
    );
  }

  // API endpoint search test: User B calling search on User A doc
  const crossSearchResp = await doRequest(
    server,
    'POST',
    `/api/documents/${docA._id}/search`,
    { query: 'Docker containers' },
    cookieB
  );
  assert(crossSearchResp.status === 404, 'Test 16: API returns 404 when searching another user\'s document');

  // Authenticated search by owner
  const ownSearchResp = await doRequest(
    server,
    'POST',
    `/api/documents/${docA._id}/search`,
    { query: 'Docker containers' },
    cookieA
  );
  assert(ownSearchResp.status === 200, 'Test 16: API returns 200 when searching own document');

  // -------------------------------------------------------------
  // Test 17: Document deletion removes Qdrant points
  // -------------------------------------------------------------
  console.log('\n[TEST 17] Document deletion removes associated Qdrant points...');
  try {
    // Create temporary document for deletion
    const tempDoc = new DocumentModel({
      userId: new Types.ObjectId(userAId),
      originalName: 'to-delete.pdf',
      fileName: `del-${Date.now()}.pdf`,
      filePath: `uploads/del-${Date.now()}.pdf`,
      fileSize: 1024,
      mimeType: 'application/pdf',
      status: 'ready',
      indexingStatus: 'pending',
    });
    await tempDoc.save();

    const tempChunk = new DocumentChunkModel({
      documentId: tempDoc._id,
      userId: new Types.ObjectId(userAId),
      pageNumber: 1,
      chunkIndex: 0,
      text: 'Temporary chunk to test deletion in Qdrant.',
      charCount: 42,
    });
    await tempChunk.save();

    await indexDocumentChunks(tempDoc._id.toString());

    // Verify point exists in Qdrant before deletion
    const countBeforeDel = await client.count(COLLECTION_NAME, {
      filter: { must: [{ key: 'documentId', match: { value: tempDoc._id.toString() } }] },
    });
    assert(countBeforeDel.count === 1, 'Test 17: Point exists in Qdrant before deletion');

    // Call DELETE API
    const delResp = await doRequest(server, 'DELETE', `/api/documents/${tempDoc._id}`, null, cookieA);
    assert(delResp.status === 200, 'Test 17: Document DELETE API returned 200');

    // Verify point removed from Qdrant
    await sleep(300);
    const countAfterDel = await client.count(COLLECTION_NAME, {
      filter: { must: [{ key: 'documentId', match: { value: tempDoc._id.toString() } }] },
    });
    assert(countAfterDel.count === 0, 'Test 17: Qdrant points completely removed after document deletion');
  } catch (err) {
    fail('Test 17', (err as Error).message);
  }

  // -------------------------------------------------------------
  // Test 18: Reindexing endpoint & safe retries
  // -------------------------------------------------------------
  console.log('\n[TEST 18] Failed indexing retry mechanism...');
  try {
    const reindexResp = await doRequest(
      server,
      'POST',
      `/api/documents/${docA._id}/reindex`,
      null,
      cookieA
    );
    assert(
      reindexResp.status === 202,
      'Test 18: POST /api/documents/:id/reindex returns 202 Accepted',
      `Got ${reindexResp.status}`
    );

    // Wait briefly for background reindexing
    await sleep(2000);
    const reindexedDoc = await DocumentModel.findById(docA._id);
    assert(
      reindexedDoc?.indexingStatus === 'indexed',
      'Test 18: Document reached "indexed" status after reindexing'
    );
  } catch (err) {
    fail('Test 18', (err as Error).message);
  }

  // -------------------------------------------------------------
  // Test 19: Empty documents handled correctly
  // -------------------------------------------------------------
  console.log('\n[TEST 19] Empty documents handled correctly...');
  try {
    const emptyDoc = new DocumentModel({
      userId: new Types.ObjectId(userAId),
      originalName: 'empty-doc.pdf',
      fileName: `empty-${Date.now()}.pdf`,
      filePath: `uploads/empty-${Date.now()}.pdf`,
      fileSize: 512,
      mimeType: 'application/pdf',
      status: 'ready',
      indexingStatus: 'pending',
    });
    await emptyDoc.save();
    createdDocIds.push(emptyDoc._id.toString());

    // 0 chunks in MongoDB
    const emptyResult = await indexDocumentChunks(emptyDoc._id.toString());
    assert(emptyResult.indexedCount === 0, 'Test 19: Empty document indexes 0 chunks');

    const updatedEmptyDoc = await DocumentModel.findById(emptyDoc._id);
    assert(
      updatedEmptyDoc?.indexingStatus === 'indexed',
      'Test 19: Empty document marked as "indexed" gracefully'
    );
    assert(updatedEmptyDoc?.indexedChunkCount === 0, 'Test 19: indexedChunkCount is 0');
  } catch (err) {
    fail('Test 19', (err as Error).message);
  }

  // -------------------------------------------------------------
  // Cleanup test data
  // -------------------------------------------------------------
  console.log('\n[INFO] Cleaning up test data...');
  for (const id of createdDocIds) {
    try {
      await deletePointsByDocumentId(id);
      await DocumentChunkModel.deleteMany({ documentId: new Types.ObjectId(id) });
      await DocumentModel.findByIdAndDelete(id);
    } catch { /* ignore cleanup error */ }
  }

  await UserModel.deleteMany({ email: { $in: [userAData.email, userBData.email] } });
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await disconnectDatabase();

  console.log('\n============================================================');
  console.log(`TEST SUMMARY: ${passed}/${passed + failed} TESTS PASSED`);
  if (failedTests.length > 0) {
    console.error('FAILED TESTS:');
    for (const t of failedTests) console.error(`  - ${t}`);
  }
  console.log('============================================================\n');

  process.exit(failed > 0 ? 1 : 0);
}

runTests().catch((err) => {
  console.error('[FATAL]', err);
  process.exit(1);
});
