import { createClient, RedisClientType } from 'redis';
import { config } from './env';
import { logger } from '../utils/logger';

let redisClient: RedisClientType | null = null;
let isConnecting = false;

/**
 * Returns the singleton Redis client instance, initializing it if needed.
 */
export const getRedisClient = (): RedisClientType => {
  if (!redisClient) {
    redisClient = createClient({
      url: config.REDIS_URL,
      socket: {
        connectTimeout: 5000,
        reconnectStrategy: (retries: number) => {
          if (retries > 5) {
            logger.error('Redis reconnection attempts exhausted (max 5 retries).');
            return new Error('Redis max retries reached');
          }
          const delay = Math.min(retries * 500, 3000);
          logger.warn(`Reconnecting to Redis in ${delay}ms (attempt ${retries}/5)...`);
          return delay;
        },
      },
    });

    redisClient.on('connect', () => {
      logger.info('Redis client socket connected.');
    });

    redisClient.on('ready', () => {
      logger.info('Redis client ready for commands.');
    });

    redisClient.on('error', (err: Error) => {
      logger.error(`Redis connection error: ${err.message}`);
    });

    redisClient.on('reconnecting', () => {
      logger.warn('Redis client attempting reconnection...');
    });

    redisClient.on('end', () => {
      logger.info('Redis connection ended.');
    });
  }

  return redisClient;
};

/**
 * Establishes connection to the Redis server and verifies with PING.
 * Avoids duplicate connections.
 */
export const connectRedis = async (): Promise<RedisClientType> => {
  const client = getRedisClient();

  if (client.isReady) {
    return client;
  }

  if (isConnecting) {
    let waited = 0;
    while (!client.isReady && waited < 20) {
      await new Promise((resolve) => setTimeout(resolve, 250));
      waited++;
    }
    if (client.isReady) {
      return client;
    }
  }

  isConnecting = true;

  try {
    logger.info(`Connecting to Redis at ${config.REDIS_URL}...`);
    if (!client.isOpen) {
      await client.connect();
    }
    // Verify with PING command
    const pingResponse = await client.ping();
    logger.info(`Redis connection verified. Ping response: ${pingResponse}`);
    isConnecting = false;
    return client;
  } catch (error) {
    isConnecting = false;
    const errorMessage = error instanceof Error ? error.message : 'Unknown Redis connection error';
    logger.error(`Failed to connect to Redis: ${errorMessage}`);
    throw error;
  }
};

/**
 * Safely disconnects the Redis client during shutdown.
 */
export const disconnectRedis = async (): Promise<void> => {
  if (redisClient && redisClient.isOpen) {
    logger.info('Closing Redis connection...');
    try {
      await redisClient.quit();
      logger.info('Redis connection closed.');
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Error closing Redis';
      logger.error(`Error disconnecting Redis: ${msg}`);
      try {
        await redisClient.disconnect();
      } catch {
        // Ignore forced disconnect error
      }
    } finally {
      redisClient = null;
    }
  }
};

/**
 * Checks live Redis connectivity by sending a PING.
 */
export const getRedisStatus = async (): Promise<'connected' | 'disconnected'> => {
  if (!redisClient || !redisClient.isOpen || !redisClient.isReady) {
    return 'disconnected';
  }

  try {
    const res = await redisClient.ping();
    return res === 'PONG' ? 'connected' : 'disconnected';
  } catch {
    return 'disconnected';
  }
};

export const isRedisConnected = async (): Promise<boolean> => {
  return (await getRedisStatus()) === 'connected';
};
