import { getConfig, getSanitizedConfig } from './config/env';
import { connectDatabase, isDatabaseConnected, disconnectDatabase } from './config/database';
import { connectRedis, isRedisConnected, disconnectRedis } from './config/redis';
import { verifyQdrantConnection } from './config/qdrant';
import { checkAllServicesStatus } from './config/connectServices';

async function runVerification() {
  console.log('=== PHASE 2 INFRASTRUCTURE VERIFICATION TEST ===\n');

  // 1. Config validation
  console.log('1. Checking Environment Configuration...');
  const config = getConfig();
  console.log('   Config successfully validated with Zod!');
  console.log('   Sanitized config:', JSON.stringify(getSanitizedConfig(), null, 2));

  // 2. Redis Connection
  console.log('\n2. Testing Redis Connection...');
  try {
    const client = await connectRedis();
    const ping = await client.ping();
    const isReady = await isRedisConnected();
    console.log(`   Redis connected: ${isReady}, PING response: ${ping}`);
  } catch (err) {
    console.error('   Redis connection failed:', err);
  }

  // 3. Qdrant Connection
  console.log('\n3. Testing Qdrant Connectivity...');
  try {
    const qdrantOk = await verifyQdrantConnection();
    console.log(`   Qdrant reachable & responsive: ${qdrantOk}`);
  } catch (err) {
    console.error('   Qdrant connection failed:', err);
  }

  // 4. MongoDB Atlas Connection
  console.log('\n4. Testing MongoDB Atlas Connection...');
  try {
    await connectDatabase();
    const mongoReady = isDatabaseConnected();
    console.log(`   MongoDB Atlas connected: ${mongoReady}`);
  } catch (err) {
    console.error('   MongoDB Atlas connection failed:', err);
  }

  // 5. Combined Services Readiness Check
  console.log('\n5. Testing Centralized Services Readiness Status...');
  const overallStatus = await checkAllServicesStatus();
  console.log('   Readiness Report:', JSON.stringify(overallStatus, null, 2));

  // 6. Graceful Disconnect
  console.log('\n6. Testing Graceful Resource Cleanup...');
  await disconnectRedis();
  await disconnectDatabase();
  console.log('   Resources disconnected cleanly.');

  console.log('\n=== VERIFICATION COMPLETE ===');
}

runVerification()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Verification failed with error:', err);
    process.exit(1);
  });
