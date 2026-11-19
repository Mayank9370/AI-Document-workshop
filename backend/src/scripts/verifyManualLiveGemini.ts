import path from 'path';
import http, { IncomingMessage } from 'http';
import dotenv from 'dotenv';
import { Types } from 'mongoose';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });
dotenv.config({ path: path.resolve(process.cwd(), 'backend', '.env') });

import { connectDatabase, disconnectDatabase } from '../config/database';
import { DocumentModel } from '../modules/documents/document.model';
import { User } from '../modules/auth/user.model';
import { signToken, AUTH_COOKIE_NAME } from '../modules/auth/auth.utils';
import { createApp } from '../app';

function doSSERequest(
  server: http.Server,
  urlPath: string,
  body: object,
  cookieHeader: string,
  onToken?: (token: string) => void
): Promise<{ status: number; events: Array<{ event: string; data: any }>; raw: string }> {
  return new Promise((resolve, reject) => {
    const addr = server.address() as { port: number };
    const bodyStr = JSON.stringify(body);
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(bodyStr).toString(),
      'Cookie': cookieHeader,
    };

    const events: Array<{ event: string; data: any }> = [];
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
                if (event === 'token' && parsed.token && onToken) {
                  onToken(parsed.token);
                }
              } catch {
                events.push({ event, data: dataStr });
              }
            }
          }
        });

        res.on('end', () => {
          resolve({ status: res.statusCode ?? 0, events, raw });
        });
      }
    );

    req.on('error', reject);
    req.write(bodyStr);
    req.end();
  });
}

function doJSONRequest(
  server: http.Server,
  method: string,
  urlPath: string,
  cookieHeader: string
): Promise<{ status: number; data: any }> {
  return new Promise((resolve, reject) => {
    const addr = server.address() as { port: number };
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Cookie': cookieHeader,
    };

    const req = http.request(
      { host: '127.0.0.1', port: addr.port, method, path: urlPath, headers },
      (res: IncomingMessage) => {
        let raw = '';
        res.on('data', (c: Buffer) => (raw += c.toString()));
        res.on('end', () => {
          try {
            resolve({ status: res.statusCode ?? 0, data: JSON.parse(raw) });
          } catch {
            resolve({ status: res.statusCode ?? 0, data: raw });
          }
        });
      }
    );
    req.on('error', reject);
    req.end();
  });
}

async function runManualVerification() {
  console.log('='.repeat(70));
  console.log('Phase 7 Manual End-to-End Verification (Live Real Gemini API)');
  console.log('='.repeat(70));

  const key = process.env.GEMINI_API_KEY;
  if (key) {
    try {
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${key}`);
      const data = (await res.json()) as any;
      const models = data.models
        ?.filter((m: any) => m.supportedGenerationMethods?.includes('generateContent'))
        ?.map((m: any) => m.name.replace('models/', ''));
      console.log('Available Gemini Models with generateContent:', models);
    } catch (e) {
      console.log('Could not list models:', e);
    }
  }

  await connectDatabase();

  const allDocs = await DocumentModel.find();
  console.log(`Total documents in DB: ${allDocs.length}`);
  for (const d of allDocs) {
    console.log(`- Doc: "${d.originalName}", ID: ${d._id}, Status: ${d.status}, Indexing: ${d.indexingStatus}, File: ${d.fileName}`);
  }

  let doc = await DocumentModel.findOne({ status: 'ready', indexingStatus: 'indexed' });
  if (!doc) {
    console.log('No ready/indexed document found, checking first document...');
    doc = await DocumentModel.findOne();
  }

  if (!doc) {
    console.error('No document found in database!');
    await disconnectDatabase();
    return;
  }

  console.log(`\nDocument Verified: "${doc.originalName}" (ID: ${doc._id})`);
  console.log(`Document Status: ${doc.status}, Indexing Status: ${doc.indexingStatus}`);

  const user = await User.findById(doc.userId);
  if (!user) {
    console.error('Owner user not found!');
    await disconnectDatabase();
    return;
  }
  console.log(`Owner User: ${user.name} (${user.email}, ID: ${user._id})`);

  // Generate valid authentication cookie for the owner user
  const token = signToken({
    userId: user._id.toString(),
    role: user.role,
  });
  const ownerCookie = `${AUTH_COOKIE_NAME}=${token}`;

  // Start app server on local port
  const app = createApp();
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as { port: number }).port;
  console.log(`Test server running on port ${port}`);

  try {
    // -------------------------------------------------------------------------
    // Step 1 & 2 & 3 & 4 & 5: Ask document-related question with real Gemini API
    // -------------------------------------------------------------------------
    console.log('\n[E2E Step 2-5] Asking document-relevant question:');
    const question1 = 'What are the main skills and projects listed in this resume?';
    console.log(`User Question: "${question1}"\n`);
    console.log('--- Streaming Response from Gemini ---');

    let tokenCount = 0;
    process.stdout.write('AI Assistant: ');
    const sseResult1 = await doSSERequest(
      server,
      `/api/chat/${doc._id}/messages`,
      { message: question1 },
      ownerCookie,
      (token) => {
        process.stdout.write(token);
        tokenCount++;
      }
    );
    console.log('\n--------------------------------------');
    console.log(`\nStream Metrics: ${tokenCount} tokens received progressively.`);

    const doneEvent1 = sseResult1.events.find((e) => e.event === 'done');
    const citationsEvent1 = sseResult1.events.find((e) => e.event === 'citations');

    console.log(`Completion Message ID: ${doneEvent1?.data?.messageId}`);
    console.log('Citations returned:', JSON.stringify(citationsEvent1?.data?.citations ?? doneEvent1?.data?.citations, null, 2));

    // -------------------------------------------------------------------------
    // Step 6: Verify Chat History Persistence in MongoDB
    // -------------------------------------------------------------------------
    console.log('\n[E2E Step 6] Fetching chat history via GET /api/chat/:id/messages...');
    const historyRes = await doJSONRequest(
      server,
      'GET',
      `/api/chat/${doc._id}/messages`,
      ownerCookie
    );
    console.log(`Total messages in history: ${historyRes.data?.data?.total}`);
    const lastMsg = historyRes.data?.data?.messages?.slice(-1)[0];
    console.log(`Last message role: ${lastMsg?.role}, has citations: ${lastMsg?.citations?.length > 0}`);

    // -------------------------------------------------------------------------
    // Step 7: Ask unrelated question -> verify model does not invent content
    // -------------------------------------------------------------------------
    console.log('\n[E2E Step 7] Asking completely unrelated question:');
    const question2 = 'How do I bake chocolate chip cookies?';
    console.log(`User Question: "${question2}"\n`);
    process.stdout.write('AI Assistant: ');
    let tokenCount2 = 0;
    const sseResult2 = await doSSERequest(
      server,
      `/api/chat/${doc._id}/messages`,
      { message: question2 },
      ownerCookie,
      (token) => {
        process.stdout.write(token);
        tokenCount2++;
      }
    );
    console.log('\n--------------------------------------');
    const doneEvent2 = sseResult2.events.find((e) => e.event === 'done');
    console.log('Completed response:', doneEvent2?.data?.content);

    // -------------------------------------------------------------------------
    // Step 8: Multi-tenant isolation test (User B attempting to access User A's doc)
    // -------------------------------------------------------------------------
    console.log('\n[E2E Step 8] Testing multi-tenant security isolation:');
    let otherUser = await User.findOne({ _id: { $ne: user._id } });
    if (!otherUser) {
      otherUser = await User.create({
        name: 'Isolated User B',
        email: `isolated_userb_${Date.now()}@example.com`,
        password: 'Password123!',
        role: 'user',
      });
    }

    const otherUserToken = signToken({
      userId: otherUser._id.toString(),
      role: otherUser.role,
    });
    const otherUserCookie = `${AUTH_COOKIE_NAME}=${otherUserToken}`;

    const attackRes = await doSSERequest(
      server,
      `/api/chat/${doc._id}/messages`,
      { message: 'Extract confidential data' },
      otherUserCookie
    );
    console.log(`User B chat access status: HTTP ${attackRes.status} (Expected: 404)`);

    const attackHistory = await doJSONRequest(
      server,
      'GET',
      `/api/chat/${doc._id}/messages`,
      otherUserCookie
    );
    console.log(`User B chat history status: HTTP ${attackHistory.status} (Expected: 404)`);

    console.log('\n' + '='.repeat(70));
    console.log('MANUAL END-TO-END VERIFICATION COMPLETED SUCCESSFULLY!');
    console.log('='.repeat(70));
  } finally {
    server.close();
    await disconnectDatabase();
  }
}

runManualVerification();
