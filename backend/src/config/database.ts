import mongoose from 'mongoose';
import { config } from './env';
import { logger } from '../utils/logger';

let isConnecting = false;

// Attach persistent event listeners to Mongoose connection
mongoose.connection.on('connected', () => {
  logger.info('MongoDB Atlas connection established successfully.');
});

mongoose.connection.on('disconnected', () => {
  logger.warn('MongoDB Atlas connection lost/disconnected.');
});

mongoose.connection.on('reconnected', () => {
  logger.info('MongoDB Atlas reconnected successfully.');
});

mongoose.connection.on('error', (err: Error) => {
  logger.error(`MongoDB connection error: ${err.message}`);
});

/**
 * Connect to MongoDB Atlas using the configured connection URI.
 * Implements connection reuse and prevents duplicate connection attempts.
 */
export const connectDatabase = async (): Promise<typeof mongoose> => {
  // If already connected, reuse existing connection
  if (mongoose.connection.readyState === 1) {
    return mongoose;
  }

  // If a connection attempt is in progress, wait for it
  if (isConnecting) {
    logger.debug('MongoDB connection attempt already in progress. Waiting...');
    let waited = 0;
    while ((mongoose.connection.readyState as number) === 2 && waited < 20) {
      await new Promise((resolve) => setTimeout(resolve, 250));
      waited++;
    }
    if ((mongoose.connection.readyState as number) === 1) {
      return mongoose;
    }
  }

  isConnecting = true;

  try {
    logger.info('Connecting to MongoDB Atlas...');
    await mongoose.connect(config.MONGODB_URI, {
      serverSelectionTimeoutMS: 4000,
      connectTimeoutMS: 5000,
      socketTimeoutMS: 30000,
    });
    isConnecting = false;
    return mongoose;
  } catch (error) {
    isConnecting = false;
    const errorMessage = error instanceof Error ? error.message : 'Unknown connection error';
    logger.error(`MongoDB Atlas connection failure: ${errorMessage}`);
    throw error;
  }
};

/**
 * Gracefully close MongoDB Atlas connection.
 */
export const disconnectDatabase = async (): Promise<void> => {
  if (mongoose.connection.readyState !== 0) {
    logger.info('Closing MongoDB Atlas connection...');
    try {
      await mongoose.disconnect();
      logger.info('MongoDB Atlas connection closed.');
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Error during disconnect';
      logger.error(`Error closing MongoDB connection: ${msg}`);
    }
  }
};

/**
 * Get the current MongoDB connection health state.
 */
export const getDatabaseStatus = (): 'connected' | 'connecting' | 'disconnected' => {
  switch (mongoose.connection.readyState) {
    case 1:
      return 'connected';
    case 2:
      return 'connecting';
    default:
      return 'disconnected';
  }
};

export const isDatabaseConnected = (): boolean => {
  return mongoose.connection.readyState === 1;
};
