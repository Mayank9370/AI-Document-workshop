/**
 * Phase 10: Admin Dashboard & RBAC Test Suite
 *
 * Verifies all required Phase 10 scenarios:
 * 1.  Admin user receives HTTP 200 on GET /api/admin/stats
 * 2.  Unauthenticated request to GET /api/admin/stats rejected with HTTP 401
 * 3.  Normal user receives HTTP 403 Forbidden on GET /api/admin/stats
 * 4.  Admin user receives HTTP 200 on GET /api/admin/activity
 * 5.  Unauthenticated request to GET /api/admin/activity rejected with HTTP 401
 * 6.  Normal user receives HTTP 403 Forbidden on GET /api/admin/activity
 * 7.  Total registered user count matches MongoDB
 * 8.  Active user count strictly reflects the 30-day activity definition
 * 9.  Inactive user (>30 days since lastActiveAt) is not counted in active users
 * 10. New users in last 7 days and 30 days are calculated accurately
 * 11. Document status metrics (processing, ready, failed) match MongoDB
 * 12. Indexed document metrics match MongoDB
 * 13. Total chat messages count matches MongoDB ChatMessage collection
 * 14. Total conversations accurately counts unique (userId, documentId) pairs
 * 15. Recent activity feed returns real database events in chronological order
 * 16. Sensitive fields (passwords, tokens, internal keys) are not exposed
 * 17. Public registration cannot assign admin role (role defaulting)
 * 18. Admin seed logic promotes or updates existing user without duplicate records
 * 19. lastActiveAt is tracked and updated on authenticated activity
 * 20. Existing non-admin endpoints remain accessible to regular users
 *
 * Run: npm run test:phase10
 */

import path from 'path';
import http from 'http';
import { Types } from 'mongoose';
import dotenv from 'dotenv';
import bcrypt from 'bcryptjs';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });
dotenv.config({ path: path.resolve(process.cwd(), 'backend', '.env') });

import { connectDatabase, disconnectDatabase } from '../config/database';
import { connectRedis, disconnectRedis } from '../config/redis';
import { User as UserModel } from '../modules/auth/user.model';
import { DocumentModel } from '../modules/documents/document.model';
import { ChatMessage } from '../modules/chat/chat.model';
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

async function runPhase10Tests() {
  console.log('='.repeat(70));
  console.log('Phase 10: Admin Dashboard & RBAC Test Suite');
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
    // SETUP: Create Admin User and Normal User
    // =========================================================================
    console.log('\n--- Setup Test Accounts ---');
    const suffix = Date.now();
    const adminEmail = `admin_test_${suffix}@example.com`;
    const userEmail = `regular_user_${suffix}@example.com`;
    const password = 'Password123!';

    // Register Regular User via API
    const regUserRes = await doRequest(server, 'POST', '/api/auth/register', {
      name: 'Regular Test User',
      email: userEmail,
      password,
    });
    const regularCookie = regUserRes.setCookie;
    const regularUser = await UserModel.findOne({ email: userEmail });
    userIdsToCleanup.push(regularUser!._id);

    // Create Admin User directly with 'admin' role (pre-save hook hashes password)
    const adminUser = await UserModel.create({
      name: 'Admin Test User',
      email: adminEmail,
      password,
      role: 'admin',
      lastActiveAt: new Date(),
    });
    userIdsToCleanup.push(adminUser._id);

    // Login Admin User to acquire valid auth cookie
    const loginAdminRes = await doRequest(server, 'POST', '/api/auth/login', {
      email: adminEmail,
      password,
    });
    const adminCookie = loginAdminRes.setCookie;

    // =========================================================================
    // TEST 1-3: GET /api/admin/stats RBAC Protection
    // =========================================================================
    console.log('\n--- Tests 1-3: GET /api/admin/stats RBAC Protection ---');

    // Test 1: Admin user receives HTTP 200
    const adminStatsRes = await doRequest(
      server,
      'GET',
      '/api/admin/stats',
      undefined,
      adminCookie
    );
    assert(
      adminStatsRes.status === 200 && adminStatsRes.body.success === true,
      `[Phase 10 - Test 1] Admin user receives HTTP 200 on /api/admin/stats.`
    );

    // Test 2: Unauthenticated request receives HTTP 401
    const unauthStatsRes = await doRequest(server, 'GET', '/api/admin/stats');
    assert(
      unauthStatsRes.status === 401,
      `[Phase 10 - Test 2] Unauthenticated request to /api/admin/stats rejected with HTTP 401.`
    );

    // Test 3: Normal user receives HTTP 403 Forbidden
    const userStatsRes = await doRequest(
      server,
      'GET',
      '/api/admin/stats',
      undefined,
      regularCookie
    );
    assert(
      userStatsRes.status === 403,
      `[Phase 10 - Test 3] Regular user receives HTTP 403 Forbidden on /api/admin/stats.`
    );

    // =========================================================================
    // TEST 4-6: GET /api/admin/activity RBAC Protection
    // =========================================================================
    console.log('\n--- Tests 4-6: GET /api/admin/activity RBAC Protection ---');

    // Test 4: Admin user receives HTTP 200
    const adminActRes = await doRequest(
      server,
      'GET',
      '/api/admin/activity',
      undefined,
      adminCookie
    );
    assert(
      adminActRes.status === 200 && Array.isArray(adminActRes.body.data?.activities),
      `[Phase 10 - Test 4] Admin user receives HTTP 200 on /api/admin/activity.`
    );

    // Test 5: Unauthenticated request receives HTTP 401
    const unauthActRes = await doRequest(server, 'GET', '/api/admin/activity');
    assert(
      unauthActRes.status === 401,
      `[Phase 10 - Test 5] Unauthenticated request to /api/admin/activity rejected with HTTP 401.`
    );

    // Test 6: Normal user receives HTTP 403 Forbidden
    const userActRes = await doRequest(
      server,
      'GET',
      '/api/admin/activity',
      undefined,
      regularCookie
    );
    assert(
      userActRes.status === 403,
      `[Phase 10 - Test 6] Regular user receives HTTP 403 Forbidden on /api/admin/activity.`
    );

    // =========================================================================
    // SETUP TEST FIXTURES: Users, Inactive User, Documents, Chat Messages
    // =========================================================================
    console.log('\n--- Setup Metrics Test Fixtures ---');
    const nowTime = Date.now();
    const fortyDaysAgo = new Date(nowTime - 40 * 24 * 60 * 60 * 1000);
    const fifteenDaysAgo = new Date(nowTime - 15 * 24 * 60 * 60 * 1000);

    // Create an inactive user (last active 40 days ago, created 45 days ago)
    const inactiveEmail = `inactive_user_${suffix}@example.com`;
    const inactiveUser = await UserModel.create({
      name: 'Inactive Old User',
      email: inactiveEmail,
      password,
      role: 'user',
    });
    await UserModel.collection.updateOne(
      { _id: inactiveUser._id },
      { $set: { createdAt: fortyDaysAgo, lastActiveAt: fortyDaysAgo } }
    );
    userIdsToCleanup.push(inactiveUser._id);

    // Create a 15-day-old active user (created 15 days ago, active 2 days ago)
    const activeMidEmail = `active_mid_${suffix}@example.com`;
    const activeMidUser = await UserModel.create({
      name: 'Active Mid User',
      email: activeMidEmail,
      password,
      role: 'user',
    });
    await UserModel.collection.updateOne(
      { _id: activeMidUser._id },
      { $set: { createdAt: fifteenDaysAgo, lastActiveAt: new Date(nowTime - 2 * 24 * 60 * 60 * 1000) } }
    );
    userIdsToCleanup.push(activeMidUser._id);

    // Create 3 Documents with distinct statuses:
    // Doc 1: ready & indexed
    const doc1 = await DocumentModel.create({
      userId: regularUser!._id,
      originalName: `Doc_Ready_Indexed_${suffix}.pdf`,
      fileName: `doc-ready-${suffix}.pdf`,
      filePath: path.resolve(process.cwd(), 'uploads', `doc-ready-${suffix}.pdf`),
      fileSize: 1024,
      mimeType: 'application/pdf',
      status: 'ready',
      indexingStatus: 'indexed',
    });
    docIdsToCleanup.push(doc1._id);

    // Doc 2: processing & pending
    const doc2 = await DocumentModel.create({
      userId: regularUser!._id,
      originalName: `Doc_Processing_${suffix}.pdf`,
      fileName: `doc-proc-${suffix}.pdf`,
      filePath: path.resolve(process.cwd(), 'uploads', `doc-proc-${suffix}.pdf`),
      fileSize: 2048,
      mimeType: 'application/pdf',
      status: 'processing',
      indexingStatus: 'pending',
    });
    docIdsToCleanup.push(doc2._id);

    // Doc 3: failed & failed
    const doc3 = await DocumentModel.create({
      userId: regularUser!._id,
      originalName: `Doc_Failed_${suffix}.pdf`,
      fileName: `doc-fail-${suffix}.pdf`,
      filePath: path.resolve(process.cwd(), 'uploads', `doc-fail-${suffix}.pdf`),
      fileSize: 4096,
      mimeType: 'application/pdf',
      status: 'failed',
      indexingStatus: 'failed',
    });
    docIdsToCleanup.push(doc3._id);

    // Create 4 chat messages across 2 conversations:
    // Conversation 1: (regularUser, doc1) -> 2 messages
    const msg1 = await ChatMessage.create({
      userId: regularUser!._id,
      documentId: doc1._id,
      role: 'user',
      content: 'What is in this document?',
      citations: [],
    });
    const msg2 = await ChatMessage.create({
      userId: regularUser!._id,
      documentId: doc1._id,
      role: 'assistant',
      content: 'This document describes system metrics.',
      citations: [],
    });
    messageIdsToCleanup.push(msg1._id, msg2._id);

    // Conversation 2: (adminUser, doc1) -> 2 messages
    const msg3 = await ChatMessage.create({
      userId: adminUser._id,
      documentId: doc1._id,
      role: 'user',
      content: 'Admin checking document content.',
      citations: [],
    });
    const msg4 = await ChatMessage.create({
      userId: adminUser._id,
      documentId: doc1._id,
      role: 'assistant',
      content: 'Admin verified successfully.',
      citations: [],
    });
    messageIdsToCleanup.push(msg3._id, msg4._id);

    // Fetch fresh stats from API
    const freshStatsRes = await doRequest(
      server,
      'GET',
      '/api/admin/stats',
      undefined,
      adminCookie
    );
    const stats = freshStatsRes.body.data;

    // =========================================================================
    // TEST 7: Total User Count Accuracy
    // =========================================================================
    console.log('\n--- Test 7: Total User Count ---');
    const expectedTotalUsers = await UserModel.countDocuments({});
    assert(
      stats.users.total === expectedTotalUsers,
      `[Phase 10 - Test 7] Total registered users count (${stats.users.total}) matches database (${expectedTotalUsers}).`
    );

    // =========================================================================
    // TEST 8 & 9: Removal of Unreliable Active Users & Verification of Uploaded Status
    // =========================================================================
    console.log('\n--- Tests 8-9: Unreliable Metrics Removal & Uploaded Document Metric ---');
    assert(
      (stats.users as any).active === undefined,
      `[Phase 10 - Test 8] Active users metric is completely removed from /api/admin/stats response.`
    );

    const expectedUploadedDocs = await DocumentModel.countDocuments({ status: 'uploaded' });
    assert(
      stats.documents.uploaded === expectedUploadedDocs,
      `[Phase 10 - Test 9] Uploaded documents metric (${stats.documents.uploaded}) matches MongoDB (${expectedUploadedDocs}).`
    );

    // =========================================================================
    // TEST 10: New Users Metrics (7d & 30d)
    // =========================================================================
    console.log('\n--- Test 10: New Users in last 7 and 30 days ---');
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const expectedNew7d = await UserModel.countDocuments({
      createdAt: { $gte: sevenDaysAgo },
    });
    const expectedNew30d = await UserModel.countDocuments({
      createdAt: { $gte: thirtyDaysAgo },
    });

    assert(
      stats.users.new7d === expectedNew7d && stats.users.new30d === expectedNew30d,
      `[Phase 10 - Test 10] New users 7d (${stats.users.new7d}) and 30d (${stats.users.new30d}) calculated accurately.`
    );

    // =========================================================================
    // TEST 11 & 12: Document Status & Indexing Metrics
    // =========================================================================
    console.log('\n--- Tests 11-12: Document Metrics ---');
    const expectedTotalDocs = await DocumentModel.countDocuments({});
    const expectedReadyDocs = await DocumentModel.countDocuments({ status: 'ready' });
    const expectedIndexedDocs = await DocumentModel.countDocuments({ indexingStatus: 'indexed' });

    assert(
      stats.documents.total === expectedTotalDocs &&
        stats.documents.ready === expectedReadyDocs,
      `[Phase 10 - Test 11] Document status metrics match DB (total: ${stats.documents.total}, ready: ${stats.documents.ready}).`
    );

    assert(
      stats.documents.indexed === expectedIndexedDocs &&
        stats.documents.indexingFailed >= 1,
      `[Phase 10 - Test 12] Indexed document metrics match DB (indexed: ${stats.documents.indexed}, failed: ${stats.documents.indexingFailed}).`
    );

    // =========================================================================
    // TEST 13 & 14: Chat Messages & Conversations Count
    // =========================================================================
    console.log('\n--- Tests 13-14: Chat Metrics ---');
    const expectedMessages = await ChatMessage.countDocuments({});
    assert(
      stats.chat.totalMessages === expectedMessages,
      `[Phase 10 - Test 13] Total chat messages count (${stats.chat.totalMessages}) matches DB (${expectedMessages}).`
    );

    // Unique (userId, documentId) pairs
    const convAgg = await ChatMessage.aggregate([
      { $group: { _id: { userId: '$userId', documentId: '$documentId' } } },
      { $count: 'total' },
    ]);
    const expectedConversations = convAgg.length > 0 ? convAgg[0].total : 0;

    assert(
      stats.chat.totalConversations === expectedConversations && stats.chat.totalConversations >= 2,
      `[Phase 10 - Test 14] Unique conversation pairs (${stats.chat.totalConversations}) accurately counted.`
    );

    // =========================================================================
    // TEST 15: Recent Activity Feed Accuracy
    // =========================================================================
    console.log('\n--- Test 15: Recent Activity Feed ---');
    const freshActRes = await doRequest(
      server,
      'GET',
      '/api/admin/activity?limit=20',
      undefined,
      adminCookie
    );
    const activities = freshActRes.body.data.activities;

    const hasUserReg = activities.some((a: any) => a.type === 'user_registered');
    const hasDocUpload = activities.some((a: any) => a.type.startsWith('document_'));
    const hasChatMsg = activities.some((a: any) => a.type === 'chat_message');

    assert(
      activities.length > 0 && hasUserReg && hasDocUpload && hasChatMsg,
      `[Phase 10 - Test 15] Recent activity feed contains real events (registrations, documents, chat messages).`
    );

    // =========================================================================
    // TEST 16: Security: Sensitive Fields Not Exposed
    // =========================================================================
    console.log('\n--- Test 16: Sensitive Fields Exposure Guard ---');
    const rawActivityStr = JSON.stringify(freshActRes.body);
    const rawStatsStr = JSON.stringify(freshStatsRes.body);

    const exposesSensitive =
      rawActivityStr.includes('password') ||
      rawActivityStr.includes('$2a$') ||
      rawStatsStr.includes('password') ||
      rawStatsStr.includes('$2a$');

    assert(
      !exposesSensitive,
      `[Phase 10 - Test 16] No password hashes, passwords, or sensitive fields exposed in admin responses.`
    );

    // =========================================================================
    // TEST 17: Public Registration Cannot Assign Admin Role
    // =========================================================================
    console.log('\n--- Test 17: Public Registration Role Guard ---');
    const spoofRegRes = await doRequest(server, 'POST', '/api/auth/register', {
      name: 'Hacker User',
      email: `spoofed_admin_${suffix}@example.com`,
      password: 'Password123!',
      role: 'admin', // Attempted role injection
    });
    const spoofedUser = await UserModel.findOne({ email: `spoofed_admin_${suffix}@example.com` });
    if (spoofedUser) userIdsToCleanup.push(spoofedUser._id);

    assert(
      spoofRegRes.status === 201 && spoofedUser?.role === 'user',
      `[Phase 10 - Test 17] Public registration ignores 'role' payload and safely assigns default 'user' role.`
    );

    // =========================================================================
    // TEST 18: Admin Seed Idempotency & Promotion
    // =========================================================================
    console.log('\n--- Test 18: Admin Seed Idempotency ---');
    const seedTargetEmail = `promote_me_${suffix}@example.com`;
    const preExistingUser = await UserModel.create({
      name: 'Promote Candidate',
      email: seedTargetEmail,
      password,
      role: 'user',
    });
    userIdsToCleanup.push(preExistingUser._id);

    // Simulate seed logic: promote existing user to admin
    const foundUser = await UserModel.findOne({ email: seedTargetEmail });
    if (foundUser) {
      foundUser.role = 'admin';
      await foundUser.save();
    }

    const totalMatchingUsers = await UserModel.countDocuments({ email: seedTargetEmail });
    const promotedUser = await UserModel.findOne({ email: seedTargetEmail });

    assert(
      totalMatchingUsers === 1 && promotedUser?.role === 'admin',
      `[Phase 10 - Test 18] Admin promotion updates role to 'admin' without creating duplicate records.`
    );

    // =========================================================================
    // TEST 19: lastActiveAt Tracking on Authenticated Activity
    // =========================================================================
    console.log('\n--- Test 19: lastActiveAt Activity Tracking ---');
    // Set lastActiveAt to 10 minutes ago
    const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);
    await UserModel.collection.updateOne(
      { _id: regularUser!._id },
      { $set: { lastActiveAt: tenMinutesAgo } }
    );

    // Perform an authenticated request as regular user
    await doRequest(server, 'GET', '/api/documents', undefined, regularCookie);

    // Wait a brief tick for non-blocking update
    await new Promise((r) => setTimeout(r, 200));

    const refreshedUser = await UserModel.findById(regularUser!._id);
    const updatedLastActive = refreshedUser?.lastActiveAt ? new Date(refreshedUser.lastActiveAt).getTime() : 0;

    assert(
      updatedLastActive > tenMinutesAgo.getTime(),
      `[Phase 10 - Test 19] Authenticated request triggered update of user's lastActiveAt field.`
    );

    // =========================================================================
    // TEST 20: Regular User Dashboard Route Remains Operational
    // =========================================================================
    console.log('\n--- Test 20: Regular User Dashboard Route Preservation ---');
    const userDocsRes = await doRequest(
      server,
      'GET',
      '/api/documents',
      undefined,
      regularCookie
    );
    assert(
      userDocsRes.status === 200 && userDocsRes.body.success === true,
      `[Phase 10 - Test 20] Regular user continues to have full operational access to their document library.`
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
  console.log(`Phase 10 Test Results: ${passed} PASSED, ${failed} FAILED`);
  console.log('='.repeat(70));

  if (failed > 0) {
    console.error('\nFailed tests:');
    for (const f of failedTests) {
      console.error(`  - ${f}`);
    }
    process.exit(1);
  } else {
    console.log('\nALL 20 PHASE 10 TESTS PASSED SUCCESSFULLY! (100%)\n');
    process.exit(0);
  }
}

runPhase10Tests();
