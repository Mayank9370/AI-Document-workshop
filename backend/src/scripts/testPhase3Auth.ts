import http from 'http';
import { createApp } from '../app';
import { connectDatabase, disconnectDatabase } from '../config/database';
import { User } from '../modules/auth/user.model';
import { logger } from '../utils/logger';
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
  path: string,
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
        path,
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
          let parsedBody;
          try {
            parsedBody = JSON.parse(responseText);
          } catch {
            parsedBody = responseText;
          }

          const setCookies = res.headers['set-cookie'];
          const parsedCookies = parseCookies(setCookies);

          resolve({
            status: res.statusCode || 0,
            headers: res.headers,
            cookies: parsedCookies,
            body: parsedBody,
          });
        });
      }
    );

    req.on('error', reject);

    if (postData) {
      req.write(postData);
    }
    req.end();
  });
};

export const runAuthTests = async (): Promise<boolean> => {
  console.log('\n============================================================');
  console.log('       PHASE 3: AUTHENTICATION & RBAC TEST SUITE');
  console.log('============================================================\n');

  // 1. Setup DB and Express server
  await connectDatabase();
  const app = createApp();
  const server = app.listen(0);
  const port = (server.address() as any).port;
  console.log(`Test Express server listening on ephemeral port ${port}.\n`);

  const timestamp = Date.now();
  const testUser = {
    name: 'Test Regular User',
    email: `regular_${timestamp}@example.com`,
    password: 'Password123!',
  };

  const adminUser = {
    name: 'Test Admin User',
    email: `admin_${timestamp}@example.com`,
    password: 'AdminPassword123!',
  };

  let userCookie: Record<string, string> = {};
  let adminCookie: Record<string, string> = {};
  let passedTests = 0;
  const totalTests = 9;

  try {
    // -------------------------------------------------------------
    // Test 1: Successful Registration
    // -------------------------------------------------------------
    console.log('[TEST 1] POST /api/auth/register - Registering a new user...');
    const regRes = await makeRequest(port, '/api/auth/register', 'POST', testUser);
    console.log(`  -> Status: ${regRes.status} (Expected: 201)`);
    console.log(`  -> Response User:`, regRes.body?.data?.user);
    const hasPassword = 'password' in (regRes.body?.data?.user || {});
    console.log(`  -> Password excluded: ${!hasPassword}`);
    console.log(`  -> Assigned Role: ${regRes.body?.data?.user?.role} (Expected: 'user')`);
    console.log(`  -> Auth Cookie Set: ${!!regRes.cookies[AUTH_COOKIE_NAME]}`);

    if (
      regRes.status === 201 &&
      regRes.body?.data?.user?.role === 'user' &&
      !hasPassword &&
      regRes.cookies[AUTH_COOKIE_NAME]
    ) {
      userCookie = { [AUTH_COOKIE_NAME]: regRes.cookies[AUTH_COOKIE_NAME] };
      console.log('  [PASS] Test 1 passed successfully.\n');
      passedTests++;
    } else {
      console.error('  [FAIL] Test 1 failed.');
    }

    // -------------------------------------------------------------
    // Test 2: Duplicate Email Rejection
    // -------------------------------------------------------------
    console.log('[TEST 2] POST /api/auth/register - Attempting duplicate registration...');
    const dupRes = await makeRequest(port, '/api/auth/register', 'POST', testUser);
    console.log(`  -> Status: ${dupRes.status} (Expected: 409)`);
    console.log(`  -> Message: ${dupRes.body?.message}`);

    if (dupRes.status === 409) {
      console.log('  [PASS] Test 2 passed successfully.\n');
      passedTests++;
    } else {
      console.error('  [FAIL] Test 2 failed.');
    }

    // -------------------------------------------------------------
    // Test 3: Successful Login
    // -------------------------------------------------------------
    console.log('[TEST 3] POST /api/auth/login - Logging in with valid credentials...');
    const loginRes = await makeRequest(port, '/api/auth/login', 'POST', {
      email: testUser.email,
      password: testUser.password,
    });
    console.log(`  -> Status: ${loginRes.status} (Expected: 200)`);
    console.log(`  -> Logged In User: ${loginRes.body?.data?.user?.email}`);
    console.log(`  -> Auth Cookie received: ${!!loginRes.cookies[AUTH_COOKIE_NAME]}`);

    if (loginRes.status === 200 && loginRes.cookies[AUTH_COOKIE_NAME]) {
      userCookie = { [AUTH_COOKIE_NAME]: loginRes.cookies[AUTH_COOKIE_NAME] };
      console.log('  [PASS] Test 3 passed successfully.\n');
      passedTests++;
    } else {
      console.error('  [FAIL] Test 3 failed.');
    }

    // -------------------------------------------------------------
    // Test 4: Incorrect Password Rejection
    // -------------------------------------------------------------
    console.log('[TEST 4] POST /api/auth/login - Attempting login with incorrect password...');
    const badLoginRes = await makeRequest(port, '/api/auth/login', 'POST', {
      email: testUser.email,
      password: 'WrongPassword999!',
    });
    console.log(`  -> Status: ${badLoginRes.status} (Expected: 401)`);
    console.log(`  -> Message: ${badLoginRes.body?.message}`);

    if (badLoginRes.status === 401) {
      console.log('  [PASS] Test 4 passed successfully.\n');
      passedTests++;
    } else {
      console.error('  [FAIL] Test 4 failed.');
    }

    // -------------------------------------------------------------
    // Test 5: Authenticated /me Request
    // -------------------------------------------------------------
    console.log('[TEST 5] GET /api/auth/me - Fetching profile with valid auth cookie...');
    const meRes = await makeRequest(port, '/api/auth/me', 'GET', undefined, userCookie);
    console.log(`  -> Status: ${meRes.status} (Expected: 200)`);
    console.log(`  -> Profile:`, meRes.body?.data?.user);

    if (meRes.status === 200 && meRes.body?.data?.user?.email === testUser.email) {
      console.log('  [PASS] Test 5 passed successfully.\n');
      passedTests++;
    } else {
      console.error('  [FAIL] Test 5 failed.');
    }

    // -------------------------------------------------------------
    // Test 6: Unauthenticated /me Request returns 401
    // -------------------------------------------------------------
    console.log('[TEST 6] GET /api/auth/me - Fetching profile without auth cookie...');
    const noAuthRes = await makeRequest(port, '/api/auth/me', 'GET');
    console.log(`  -> Status: ${noAuthRes.status} (Expected: 401)`);
    console.log(`  -> Message: ${noAuthRes.body?.message}`);

    if (noAuthRes.status === 401) {
      console.log('  [PASS] Test 6 passed successfully.\n');
      passedTests++;
    } else {
      console.error('  [FAIL] Test 6 failed.');
    }

    // -------------------------------------------------------------
    // Test 7: Logout Clears Cookie
    // -------------------------------------------------------------
    console.log('[TEST 7] POST /api/auth/logout - Logging out user...');
    const logoutRes = await makeRequest(port, '/api/auth/logout', 'POST', undefined, userCookie);
    console.log(`  -> Status: ${logoutRes.status} (Expected: 200)`);
    const setCookie = logoutRes.headers['set-cookie'];
    const cleared = setCookie?.some((c) => c.includes(`${AUTH_COOKIE_NAME}=;`) || c.includes('Max-Age=0') || c.includes('Expires=Thu, 01 Jan 1970'));
    console.log(`  -> Cookie cleared in header: ${cleared}`);

    if (logoutRes.status === 200 && cleared) {
      console.log('  [PASS] Test 7 passed successfully.\n');
      passedTests++;
    } else {
      console.error('  [FAIL] Test 7 failed.');
    }

    // -------------------------------------------------------------
    // Test 8: Regular User Access to Admin Route Rejected (403 Forbidden)
    // -------------------------------------------------------------
    console.log('[TEST 8] GET /api/auth/admin-test - Regular user accessing admin route...');
    const userAdminTestRes = await makeRequest(
      port,
      '/api/auth/admin-test',
      'GET',
      undefined,
      userCookie
    );
    console.log(`  -> Status: ${userAdminTestRes.status} (Expected: 403)`);
    console.log(`  -> Message: ${userAdminTestRes.body?.message}`);

    if (userAdminTestRes.status === 403) {
      console.log('  [PASS] Test 8 passed successfully.\n');
      passedTests++;
    } else {
      console.error('  [FAIL] Test 8 failed.');
    }

    // -------------------------------------------------------------
    // Test 9: Admin Access to Admin Route Permitted (200 OK)
    // -------------------------------------------------------------
    console.log('[TEST 9] Creating admin account and testing GET /api/auth/admin-test...');
    const adminDoc = new User({
      name: adminUser.name,
      email: adminUser.email,
      password: adminUser.password,
      role: 'admin',
    });
    await adminDoc.save();

    // Login as admin
    const adminLoginRes = await makeRequest(port, '/api/auth/login', 'POST', {
      email: adminUser.email,
      password: adminUser.password,
    });

    adminCookie = { [AUTH_COOKIE_NAME]: adminLoginRes.cookies[AUTH_COOKIE_NAME] };

    const adminTestRes = await makeRequest(
      port,
      '/api/auth/admin-test',
      'GET',
      undefined,
      adminCookie
    );
    console.log(`  -> Status: ${adminTestRes.status} (Expected: 200)`);
    console.log(`  -> Admin Verified Message: ${adminTestRes.body?.message}`);
    console.log(`  -> Admin Role: ${adminTestRes.body?.data?.admin?.role}`);

    if (adminTestRes.status === 200 && adminTestRes.body?.data?.admin?.role === 'admin') {
      console.log('  [PASS] Test 9 passed successfully.\n');
      passedTests++;
    } else {
      console.error('  [FAIL] Test 9 failed.');
    }

    // Clean up created test accounts
    await User.deleteMany({ email: { $in: [testUser.email, adminUser.email] } });
    console.log('Cleaned up test accounts from database.');
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await disconnectDatabase();
    console.log('Server and database closed.\n');
  }

  console.log('============================================================');
  console.log(`TEST SUMMARY: ${passedTests}/${totalTests} TESTS PASSED`);
  console.log('============================================================\n');

  return passedTests === totalTests;
};

if (require.main === module) {
  runAuthTests()
    .then((success) => process.exit(success ? 0 : 1))
    .catch((err) => {
      console.error('Test suite error:', err);
      process.exit(1);
    });
}
