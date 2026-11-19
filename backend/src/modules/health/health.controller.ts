import { Request, Response } from 'express';
import { checkAllServicesStatus } from '../../config/connectServices';

/**
 * Liveness probe: verifies that the Express API process is running.
 * GET /api/health
 */
export const getHealth = (_req: Request, res: Response): void => {
  res.status(200).json({
    success: true,
    message: 'AI Document Workspace API is running',
    timestamp: new Date().toISOString(),
  });
};

/**
 * Readiness probe: checks live connection status of MongoDB, Redis, and Qdrant.
 * GET /api/health/ready
 */
export const getReadiness = async (_req: Request, res: Response): Promise<void> => {
  try {
    const report = await checkAllServicesStatus();

    const responsePayload = {
      success: report.isReady,
      status: report.isReady ? 'ready' : 'not_ready',
      services: {
        mongodb: report.mongodb,
        redis: report.redis,
        qdrant: report.qdrant,
      },
    };

    if (report.isReady) {
      res.status(200).json(responsePayload);
    } else {
      res.status(503).json(responsePayload);
    }
  } catch {
    res.status(503).json({
      success: false,
      status: 'not_ready',
      services: {
        mongodb: 'disconnected',
        redis: 'disconnected',
        qdrant: 'disconnected',
      },
    });
  }
};
