import express, { Application } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { config } from './config/env';
import healthRouter from './modules/health/health.router';
import authRouter from './modules/auth/auth.router';
import documentRouter from './modules/documents/document.router';
import chatRouter from './modules/chat/chat.router';
import adminRouter from './modules/admin/admin.router';
import { notFoundHandler } from './middleware/notFoundHandler';
import { errorHandler } from './middleware/errorHandler';

export const createApp = (): Application => {
  const app: Application = express();

  // Security Middleware
  app.use(helmet());

  // CORS Configuration
  app.use(
    cors({
      origin: config.FRONTEND_URL,
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization'],
    })
  );

  // Cookie Parsing Middleware
  app.use(cookieParser());

  // Body Parsing Middleware
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true, limit: '10mb' }));

  // API Routes
  app.use('/api/health', healthRouter);
  app.use('/api/auth', authRouter);
  app.use('/api/documents', documentRouter);
  app.use('/api/chat', chatRouter);
  app.use('/api/admin', adminRouter);

  // Fallback 404 Handler
  app.use(notFoundHandler);

  // Centralized Error Handler
  app.use(errorHandler);

  return app;
};

const app = createApp();
export default app;
