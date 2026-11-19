import { getSanitizedConfig } from './env';
import { connectDatabase, isDatabaseConnected } from './database';
import { connectRedis, isRedisConnected } from './redis';
import { verifyQdrantConnection } from './qdrant';
import { initQdrantCollection } from '../services/vectorStore';
import { logger } from '../utils/logger';

export interface ServiceStatusReport {
  mongodb: 'connected' | 'disconnected';
  redis: 'connected' | 'disconnected';
  qdrant: 'connected' | 'disconnected';
  isReady: boolean;
}

/**
 * Connects to all required infrastructure services (MongoDB, Redis, Qdrant)
 * with a controlled startup policy.
 */
export const connectAllServices = async (): Promise<ServiceStatusReport> => {
  logger.info('--- Initializing Infrastructure Dependencies ---');
  logger.info('Environment Configuration (Sanitized):', getSanitizedConfig());

  // 1. MongoDB Atlas
  try {
    await connectDatabase();
    logger.info('[Service Online] MongoDB Atlas connected.');
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Connection failed';
    logger.error(`[Service Offline] MongoDB Atlas failed to connect: ${msg}`);
  }

  // 2. Redis
  try {
    await connectRedis();
    logger.info('[Service Online] Redis connected and responsive.');
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Connection failed';
    logger.error(`[Service Offline] Redis failed to connect: ${msg}`);
  }

  // 3. Qdrant
  try {
    const qdrantOk = await verifyQdrantConnection();
    if (qdrantOk) {
      logger.info('[Service Online] Qdrant Vector DB verified.');
      // Initialize vector collection and payload indexes
      await initQdrantCollection();
      logger.info('[Qdrant Ready] Document chunks collection and payload indexes initialized.');
    } else {
      logger.error('[Service Offline] Qdrant Vector DB is unreachable.');
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Connection check failed';
    logger.error(`[Service Offline] Qdrant Vector DB error: ${msg}`);
  }

  const status = await checkAllServicesStatus();
  if (status.isReady) {
    logger.info('All infrastructure services are healthy and ready.');
  } else {
    logger.warn('Infrastructure readiness check: NOT READY. Some dependencies are offline.');
  }

  return status;
};

/**
 * Inspects live status of all dependencies without re-initiating connection spam.
 */
export const checkAllServicesStatus = async (): Promise<ServiceStatusReport> => {
  const [mongoConnected, redisConnected, qdrantConnected] = await Promise.all([
    Promise.resolve(isDatabaseConnected()),
    isRedisConnected(),
    verifyQdrantConnection(),
  ]);

  const mongodb = mongoConnected ? 'connected' : 'disconnected';
  const redis = redisConnected ? 'connected' : 'disconnected';
  const qdrant = qdrantConnected ? 'connected' : 'disconnected';
  const isReady = mongoConnected && redisConnected && qdrantConnected;

  return {
    mongodb,
    redis,
    qdrant,
    isReady,
  };
};
