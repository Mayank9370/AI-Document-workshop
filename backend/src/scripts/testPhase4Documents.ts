import http from 'http';
import fs from 'fs';
import path from 'path';
import { createApp } from '../app';
import { connectDatabase, disconnectDatabase } from '../config/database';
import { User } from '../modules/auth/user.model';
import { DocumentModel } from '../modules/documents/document.model';
import { config } from '../config/env';
import { AUTH_COOKIE_NAME } from '../modules/auth/auth.utils';

interface HttpResponse {
  status: number;
  headers: http.IncomingHttpHeaders;
  cookies: Record<string, string>;
  body: any;
}

const parseCookies = (setCookieHeaders?: string[]): Record<string, string> => {
  const cookies: Record<string, string> = {};
  if (!setCookieHeaders) return cookies;
  setCookieHeaders.forEach((str) => {
    const parts = str.split(';')[0].split('=');
    if (parts.length >= 2) {
      cookies[parts[0].trim()] = parts.slice(1).join('=').trim();
    }
  });
  return cookies;
};

const makeRequest = (
  port: number,
  pathName: string,
  method = 'GET',
  body?: any,
  cookies?: Record<string, string>
): Promise<HttpResponse> => {
  return new Promise((resolve, reject) => {
    const cookieHeader = cookies
      ? Object.entries(cookies)
          .map(([k, v]) => `${k}=${v}`)
          .join('; ')
      : undefined;

    const postData = body ? JSON.stringify(body) : undefined;

    const req = http.request(
      {
        hostname: 'localhost',
        port,
        path: pathName,
        method,
        headers: {
          'Content-Type': 'application/json',
          ...(postData && { 'Content-Length': Buffer.byteLength(postData) }),
          ...(cookieHeader && { Cookie: cookieHeader }),
        },
      },
      (res) => {
        let responseText = '';
        res.on('data', (chunk) => (responseText += chunk));
        res.on('end', () => {
          let parsed;
          try {
            parsed = JSON.parse(responseText);
          } catch {
            parsed = responseText;
          }
          resolve({
            status: res.statusCode || 0,
            headers: res.headers,
            cookies: parseCookies(res.headers['set-cookie']),
            body: parsed,
          });
        });
      }
    );

    req.on('error', reject);
    if (postData) req.write(postData);
    req.end();
  });
};

const makeMultipartUpload = (
  port: number,
  pathName: string,
  fieldName: string,
  fileName: string,
  fileContent: Buffer,
  mimeType = 'application/pdf',
  cookies?: Record<string, string>
): Promise<HttpResponse> => {
  return new Promise((resolve, reject) => {
    const boundary = `----WebKitFormBoundary${Date.now()}`;
    const cookieHeader = cookies
      ? Object.entries(cookies)
          .map(([k, v]) => `${k}=${v}`)
          .join('; ')
      : undefined;

    const header = Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="${fieldName}"; filename="${fileName}"\r\nContent-Type: ${mimeType}\r\n\r\n`
    );
    const footer = Buffer.from(`\r\n--${boundary}--\r\n`);
    const totalLength = header.length + fileContent.length + footer.length;

    const req = http.request(
      {
        hostname: 'localhost',
        port,
        path: pathName,
        method: 'POST',
        headers: {
          'Content-Type': `multipart/form-data; boundary=${boundary}`,
          'Content-Length': totalLength,
          ...(cookieHeader && { Cookie: cookieHeader }),
        },
      },
      (res) => {
        let responseText = '';
        res.on('data', (chunk) => (responseText += chunk));
        res.on('end', () => {
          let parsed;
          try {
            parsed = JSON.parse(responseText);
          } catch {
            parsed = responseText;
          }
          resolve({
            status: res.statusCode || 0,
            headers: res.headers,
            cookies: parseCookies(res.headers['set-cookie']),
            body: parsed,
          });
        });
      }
    );

    req.on('error', reject);
    req.write(header);
    req.write(fileContent);
    req.write(footer);
    req.end();
  });
};

export const runPhase4Tests = async (): Promise<boolean> => {
  console.log('\n============================================================');
  console.log('       PHASE 4: DOCUMENT MANAGEMENT & UPLOAD TEST SUITE');
  console.log('============================================================\n');

  await connectDatabase();
  const app = createApp();
  const server = app.listen(0);
  const port = (server.address() as any).port;
  console.log(`Ephemeral test server running on port ${port}.\n`);

  const ts = Date.now();
  const userA = { name: 'User Alpha', email: `user_a_${ts}@test.com`, password: 'Password123!' };
  const userB = { name: 'User Beta', email: `user_b_${ts}@test.com`, password: 'Password123!' };

  let cookieA: Record<string, string> = {};
  let cookieB: Record<string, string> = {};

  let docAId = '';
  let docAPath = '';
  let docBId = '';
  let docBPath = '';

  let passedTests = 0;
  const totalTests = 11;

  // Generate valid minimal PDF buffer
  const validPdfBuffer = Buffer.from(
    '%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n2 0 obj\n<< /Type /Pages /Kids [] /Count 0 >>\nendobj\nxref\n0 3\n0000000000 65535 f \n0000000010 00000 n \n0000000060 00000 n \ntrailer\n<< /Size 3 /Root 1 0 R >>\nstartxref\n120\n%%EOF'
  );

  try {
    // 0. Register Test Users A and B
    const regARes = await makeRequest(port, '/api/auth/register', 'POST', userA);
    cookieA = { [AUTH_COOKIE_NAME]: regARes.cookies[AUTH_COOKIE_NAME] };

    const regBRes = await makeRequest(port, '/api/auth/register', 'POST', userB);
    cookieB = { [AUTH_COOKIE_NAME]: regBRes.cookies[AUTH_COOKIE_NAME] };

    console.log(`Registered User A (${userA.email}) & User B (${userB.email})\n`);

    // -------------------------------------------------------------
    // Test 1: Authenticated user can upload a valid PDF
    // -------------------------------------------------------------
    console.log('[TEST 1] Authenticated upload of valid PDF document...');
    const uploadRes = await makeMultipartUpload(
      port,
      '/api/documents/upload',
      'file',
      'annual-report.pdf',
      validPdfBuffer,
      'application/pdf',
      cookieA
    );
    console.log(`  -> Status: ${uploadRes.status} (Expected: 201)`);
    const docData = uploadRes.body?.data?.document;
    console.log(`  -> Original Name: ${docData?.originalName}`);
    console.log(`  -> Stored Filename: ${docData?.fileName}`);
    console.log(`  -> Status: ${docData?.status}`);
    docAId = docData?.id || docData?._id;
    docAPath = docData?.filePath;
    const fileExistsOnDisk = docAPath && fs.existsSync(docAPath);
    console.log(`  -> Physical file exists on disk: ${fileExistsOnDisk}`);

    if (uploadRes.status === 201 && docAId && fileExistsOnDisk && docData.status === 'uploaded') {
      console.log('  [PASS] Test 1 passed.\n');
      passedTests++;
    } else {
      console.error('  [FAIL] Test 1 failed.\n');
    }

    // -------------------------------------------------------------
    // Test 2: Non-PDF files are rejected
    // -------------------------------------------------------------
    console.log('[TEST 2] Rejection of non-PDF file (invalid extension & MIME)...');
    const textBuffer = Buffer.from('This is a plain text file, not a PDF.');
    const nonPdfRes = await makeMultipartUpload(
      port,
      '/api/documents/upload',
      'file',
      'malicious.txt',
      textBuffer,
      'text/plain',
      cookieA
    );
    console.log(`  -> Status: ${nonPdfRes.status} (Expected: 400)`);
    console.log(`  -> Error Message: ${nonPdfRes.body?.message}`);

    // Also test spoofed extension with non-PDF content (failed magic bytes)
    const spoofedRes = await makeMultipartUpload(
      port,
      '/api/documents/upload',
      'file',
      'fake.pdf',
      textBuffer,
      'application/pdf',
      cookieA
    );
    console.log(`  -> Spoofed Magic Bytes Status: ${spoofedRes.status} (Expected: 400)`);
    console.log(`  -> Error Message: ${spoofedRes.body?.message}`);

    if (nonPdfRes.status === 400 && spoofedRes.status === 400) {
      console.log('  [PASS] Test 2 passed.\n');
      passedTests++;
    } else {
      console.error('  [FAIL] Test 2 failed.\n');
    }

    // -------------------------------------------------------------
    // Test 3: Files exceeding 10 MB are rejected
    // -------------------------------------------------------------
    console.log('[TEST 3] Rejection of files exceeding 10 MB...');
    // Create oversized buffer (10.5 MB)
    const largeBuffer = Buffer.alloc(10.5 * 1024 * 1024, '%PDF-1.4\n');
    const largeRes = await makeMultipartUpload(
      port,
      '/api/documents/upload',
      'file',
      'oversized.pdf',
      largeBuffer,
      'application/pdf',
      cookieA
    );
    console.log(`  -> Status: ${largeRes.status} (Expected: 400)`);
    console.log(`  -> Message: ${largeRes.body?.message}`);

    if (largeRes.status === 400 && largeRes.body?.message?.includes('10 MB')) {
      console.log('  [PASS] Test 3 passed.\n');
      passedTests++;
    } else {
      console.error('  [FAIL] Test 3 failed.\n');
    }

    // -------------------------------------------------------------
    // Test 4: Uploaded document metadata is saved in MongoDB
    // -------------------------------------------------------------
    console.log('[TEST 4] Verification of document metadata record in MongoDB...');
    const savedDoc = await DocumentModel.findById(docAId);
    console.log(`  -> Found in DB: ${!!savedDoc}`);
    console.log(`  -> DB User Reference matches User A: ${savedDoc?.userId.toString() === regARes.body?.data?.user?.id}`);
    console.log(`  -> File size recorded: ${savedDoc?.fileSize} bytes`);

    if (savedDoc && savedDoc.originalName === 'annual-report.pdf') {
      console.log('  [PASS] Test 4 passed.\n');
      passedTests++;
    } else {
      console.error('  [FAIL] Test 4 failed.\n');
    }

    // -------------------------------------------------------------
    // Test 5: User can list their documents
    // -------------------------------------------------------------
    console.log('[TEST 5] GET /api/documents - Listing authenticated user documents...');
    const listRes = await makeRequest(port, '/api/documents', 'GET', undefined, cookieA);
    console.log(`  -> Status: ${listRes.status} (Expected: 200)`);
    console.log(`  -> Total Documents: ${listRes.body?.data?.pagination?.total}`);
    console.log(`  -> First Doc Name: ${listRes.body?.data?.documents?.[0]?.originalName}`);

    if (listRes.status === 200 && listRes.body?.data?.documents?.length >= 1) {
      console.log('  [PASS] Test 5 passed.\n');
      passedTests++;
    } else {
      console.error('  [FAIL] Test 5 failed.\n');
    }

    // -------------------------------------------------------------
    // Test 6: User can view document details
    // -------------------------------------------------------------
    console.log(`[TEST 6] GET /api/documents/${docAId} - Retrieving document details...`);
    const getRes = await makeRequest(port, `/api/documents/${docAId}`, 'GET', undefined, cookieA);
    console.log(`  -> Status: ${getRes.status} (Expected: 200)`);
    console.log(`  -> Retrieved Document ID: ${getRes.body?.data?.document?.id}`);

    if (getRes.status === 200 && getRes.body?.data?.document?.id === docAId) {
      console.log('  [PASS] Test 6 passed.\n');
      passedTests++;
    } else {
      console.error('  [FAIL] Test 6 failed.\n');
    }

    // -------------------------------------------------------------
    // Test 7: User A cannot retrieve User B's document (Ownership isolation)
    // -------------------------------------------------------------
    console.log('[TEST 7] Testing ownership isolation on document retrieval...');
    // Upload a document as User B
    const uploadBRes = await makeMultipartUpload(
      port,
      '/api/documents/upload',
      'file',
      'user-b-confidential.pdf',
      validPdfBuffer,
      'application/pdf',
      cookieB
    );
    docBId = uploadBRes.body?.data?.document?.id;
    docBPath = uploadBRes.body?.data?.document?.filePath;
    console.log(`  -> User B document created with ID: ${docBId}`);

    // User A tries to retrieve User B's document
    const crossGetRes = await makeRequest(port, `/api/documents/${docBId}`, 'GET', undefined, cookieA);
    console.log(`  -> User A access to User B doc status: ${crossGetRes.status} (Expected: 404)`);
    console.log(`  -> Message: ${crossGetRes.body?.message}`);

    if (crossGetRes.status === 404) {
      console.log('  [PASS] Test 7 passed.\n');
      passedTests++;
    } else {
      console.error('  [FAIL] Test 7 failed.\n');
    }

    // -------------------------------------------------------------
    // Test 8: User A cannot delete User B's document (Cross-user deletion prevention)
    // -------------------------------------------------------------
    console.log('[TEST 8] Testing ownership enforcement on deletion...');
    const crossDelRes = await makeRequest(port, `/api/documents/${docBId}`, 'DELETE', undefined, cookieA);
    console.log(`  -> User A delete User B doc status: ${crossDelRes.status} (Expected: 404)`);
    // Verify document still exists in database
    const docBStillExists = await DocumentModel.findById(docBId);
    console.log(`  -> User B document still exists in DB: ${!!docBStillExists}`);

    if (crossDelRes.status === 404 && docBStillExists) {
      console.log('  [PASS] Test 8 passed.\n');
      passedTests++;
    } else {
      console.error('  [FAIL] Test 8 failed.\n');
    }

    // -------------------------------------------------------------
    // Test 9: User can delete their own document
    // -------------------------------------------------------------
    console.log(`[TEST 9] DELETE /api/documents/${docAId} - Deleting own document...`);
    const delRes = await makeRequest(port, `/api/documents/${docAId}`, 'DELETE', undefined, cookieA);
    console.log(`  -> Status: ${delRes.status} (Expected: 200)`);

    const docAInDb = await DocumentModel.findById(docAId);
    const docAFileExists = fs.existsSync(docAPath);
    console.log(`  -> Record removed from MongoDB: ${!docAInDb}`);
    console.log(`  -> Physical file removed from disk: ${!docAFileExists}`);

    if (delRes.status === 200 && !docAInDb && !docAFileExists) {
      console.log('  [PASS] Test 9 passed.\n');
      passedTests++;
    } else {
      console.error('  [FAIL] Test 9 failed.\n');
    }

    // -------------------------------------------------------------
    // Test 10: Unauthenticated requests return 401
    // -------------------------------------------------------------
    console.log('[TEST 10] Unauthenticated access to document endpoints...');
    const unauthList = await makeRequest(port, '/api/documents', 'GET');
    const unauthUpload = await makeMultipartUpload(
      port,
      '/api/documents/upload',
      'file',
      'test.pdf',
      validPdfBuffer
    );
    const unauthGet = await makeRequest(port, `/api/documents/${docBId}`, 'GET');
    const unauthDel = await makeRequest(port, `/api/documents/${docBId}`, 'DELETE');

    console.log(`  -> GET /api/documents: ${unauthList.status} (Expected: 401)`);
    console.log(`  -> POST /api/documents/upload: ${unauthUpload.status} (Expected: 401)`);
    console.log(`  -> GET /api/documents/:id: ${unauthGet.status} (Expected: 401)`);
    console.log(`  -> DELETE /api/documents/:id: ${unauthDel.status} (Expected: 401)`);

    if (
      unauthList.status === 401 &&
      unauthUpload.status === 401 &&
      unauthGet.status === 401 &&
      unauthDel.status === 401
    ) {
      console.log('  [PASS] Test 10 passed.\n');
      passedTests++;
    } else {
      console.error('  [FAIL] Test 10 failed.\n');
    }

    // -------------------------------------------------------------
    // Test 11: Failed uploads do not leave unnecessary files or database records
    // -------------------------------------------------------------
    console.log('[TEST 11] Verifying no orphaned files in upload directory...');
    // Clean up User B doc
    await makeRequest(port, `/api/documents/${docBId}`, 'DELETE', undefined, cookieB);

    // Count files in uploads folder matching our test run
    const uploadFiles = fs.readdirSync(config.UPLOAD_DIR);
    const orphanedA = uploadFiles.filter((f) => f.includes(path.basename(docAPath)));
    const orphanedB = uploadFiles.filter((f) => f.includes(path.basename(docBPath)));
    console.log(`  -> Orphaned file for doc A found: ${orphanedA.length > 0}`);
    console.log(`  -> Orphaned file for doc B found: ${orphanedB.length > 0}`);

    if (orphanedA.length === 0 && orphanedB.length === 0) {
      console.log('  [PASS] Test 11 passed.\n');
      passedTests++;
    } else {
      console.error('  [FAIL] Test 11 failed.\n');
    }

    // Cleanup test users
    await User.deleteMany({ email: { $in: [userA.email, userB.email] } });
    console.log('Cleaned up test users from MongoDB.');
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await disconnectDatabase();
    console.log('Server and database closed cleanly.\n');
  }

  console.log('============================================================');
  console.log(`TEST SUMMARY: ${passedTests}/${totalTests} TESTS PASSED`);
  console.log('============================================================\n');

  return passedTests === totalTests;
};

if (require.main === module) {
  runPhase4Tests()
    .then((success) => process.exit(success ? 0 : 1))
    .catch((err) => {
      console.error('Test execution failed:', err);
      process.exit(1);
    });
}
