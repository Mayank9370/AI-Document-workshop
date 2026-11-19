import { Server } from 'http';
import app from './app';
import { config } from './config/env';
import { connectAllServices } from './config/connectServices';
import { disconnectDatabase } from './config/database';
import { disconnectRedis } from './config/redis';
import { logger } from './utils/logger';
import { resetStuckDocuments } from './services/documentProcessor';
import { resetStuckIndexingDocuments } from './services/vectorStore';

let server: Server | null = null;
let isShuttingDown = false;

/**
 * Gracefully shuts down HTTP server and infrastructure connections.
 * Ensures cleanup is safe even if connections were never established.
 */
export const handleShutdown = async (signal: string): Promise<void> => {
  if (isShuttingDown) {
    logger.warn(`Shutdown already in progress, ignoring duplicate ${signal}`);
    return;
  }
  isShuttingDown = true;

  logger.info(`Received ${signal}. Initiating graceful shutdown...`);

  // Safety fallback: force exit after 10 seconds if connections hang
  const forceExitTimeout = setTimeout(() => {
    logger.error('Graceful shutdown timed out after 10 seconds. Forcing process termination.');
    process.exit(1);
  }, 10000);
  forceExitTimeout.unref();

  // 1. Close HTTP Server (stop accepting new requests)
  if (server) {
    const activeServer = server;
    await new Promise<void>((resolve) => {
      activeServer.close((err) => {
        if (err) {
          logger.error(`Error while closing HTTP server: ${err.message}`);
        } else {
          logger.info('HTTP server closed successfully.');
        }
        resolve();
      });
    });
  }

  // 2. Disconnect Redis
  try {
    await disconnectRedis();
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    logger.error(`Error disconnecting Redis: ${msg}`);
  }

  // 3. Disconnect MongoDB Atlas
  try {
    await disconnectDatabase();
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    logger.error(`Error disconnecting MongoDB: ${msg}`);
  }

  logger.info('Graceful shutdown complete. Exiting process.');
  process.exit(0);
};

// Register OS termination signals
process.on('SIGTERM', () => handleShutdown('SIGTERM'));
process.on('SIGINT', () => handleShutdown('SIGINT'));

/**
 * Bootstrap the application server and initiate infrastructure connections.
 */
export const startServer = async (): Promise<Server> => {
  try {
    // 1. Start HTTP listener
    server = app.listen(config.PORT, () => {
      logger.info(`=======================================================`);
      logger.info(`AI Document Workspace Backend listening on port ${config.PORT}`);
      logger.info(`Environment: ${config.NODE_ENV}`);
      logger.info(`Liveness probe:  http://localhost:${config.PORT}/api/health`);
      logger.info(`Readiness probe: http://localhost:${config.PORT}/api/health/ready`);
      logger.info(`=======================================================`);
    });

    // 2. Connect and verify all infrastructure dependencies
    const status = await connectAllServices();
    if (!status.isReady) {
      logger.warn(
        '[Startup Warning] Backend is active, but some infrastructure dependencies are offline. Readiness probe (/api/health/ready) will report 503 until all services are healthy.'
      );
    }

    // 3. Reset any documents stuck in 'processing' or 'indexing' from a previous crash
    await resetStuckDocuments();
    await resetStuckIndexingDocuments();

    return server;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error during startup';
    logger.error(`Fatal startup failure: ${errorMessage}`);
    process.exit(1);
  }
};

// Start server if this file is run directly
if (process.env.NODE_ENV !== 'test') {
  startServer();
}

export default server;
