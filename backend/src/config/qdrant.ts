import { QdrantClient } from '@qdrant/js-client-rest';
import { config } from './env';
import { logger } from '../utils/logger';

let qdrantClient: QdrantClient | null = null;

/**
 * Returns the singleton QdrantClient instance.
 */
export const getQdrantClient = (): QdrantClient => {
  if (!qdrantClient) {
    qdrantClient = new QdrantClient({
      url: config.QDRANT_URL,
      apiKey: config.QDRANT_API_KEY,
      checkCompatibility: false,
      timeout: 5000,
    });
  }
  return qdrantClient;
};

/**
 * Verifies Qdrant connectivity by performing a non-mutating getCollections call.
 * Returns true if Qdrant responds successfully, false otherwise.
 */
export const verifyQdrantConnection = async (): Promise<boolean> => {
  try {
    const client = getQdrantClient();
    logger.info(`Verifying Qdrant connectivity at ${config.QDRANT_URL}...`);
    const response = await client.getCollections();
    logger.info(
      `Qdrant connection verified successfully. Existing collections: ${response.collections.length}`
    );
    return true;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown Qdrant connection error';
    logger.error(`Qdrant connectivity check failed: ${errorMessage}`);
    return false;
  }
};

/**
 * Returns the current live status of the Qdrant connection.
 */
export const getQdrantStatus = async (): Promise<'connected' | 'disconnected'> => {
  const isConnected = await verifyQdrantConnection();
  return isConnected ? 'connected' : 'disconnected';
};
