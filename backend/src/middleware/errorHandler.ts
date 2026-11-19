import { Request, Response, NextFunction } from 'express';
import { logger } from '../utils/logger';
import { sendError } from '../utils/response';

export interface AppError extends Error {
  statusCode?: number;
}

export const errorHandler = (
  err: AppError,
  req: Request,
  res: Response,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  next: NextFunction
): void => {
  const statusCode = err.statusCode || 500;
  const message = err.message || 'Internal Server Error';

  logger.error(`[${req.method} ${req.originalUrl}] - ${message}`, {
    stack: process.env.NODE_ENV !== 'production' ? err.stack : undefined,
  });

  sendError(
    res,
    message,
    statusCode,
    process.env.NODE_ENV !== 'production' ? err.stack : undefined
  );
};
