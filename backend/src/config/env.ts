import dotenv from 'dotenv';
import path from 'path';
import { z } from 'zod';

// Load environment variables from .env file (supports running from root or backend directory)
dotenv.config({ path: path.resolve(process.cwd(), '.env') });
dotenv.config({ path: path.resolve(process.cwd(), 'backend', '.env') });

export const envSchema = z.object({
  PORT: z
    .string()
    .default('5000')
    .transform((val) => parseInt(val, 10))
    .pipe(z.number().min(1).max(65535)),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  FRONTEND_URL: z.string().default('http://localhost:3000'),
  MONGODB_URI: z
    .string({
      required_error: 'MONGODB_URI is required. Please configure your MongoDB Atlas connection string.',
    })
    .transform((val) => val.trim().replace(/^["']|["']$/g, ''))
    .refine(
      (val) => val.startsWith('mongodb://') || val.startsWith('mongodb+srv://'),
      'MONGODB_URI must start with "mongodb://" or "mongodb+srv://"'
    ),
  REDIS_URL: z
    .string({
      required_error: 'REDIS_URL is required (e.g. redis://localhost:6379 or redis://redis:6379).',
    })
    .transform((val) => val.trim().replace(/^["']|["']$/g, ''))
    .refine((val) => val.length > 0, 'REDIS_URL cannot be empty'),
  QDRANT_URL: z
    .string({
      required_error: 'QDRANT_URL is required (e.g. http://localhost:6333 or http://qdrant:6333).',
    })
    .transform((val) => val.trim().replace(/^["']|["']$/g, ''))
    .pipe(z.string().url('QDRANT_URL must be a valid HTTP/HTTPS URL')),
  QDRANT_API_KEY: z
    .string()
    .optional()
    .transform((val) => (val && val.trim() ? val.trim().replace(/^["']|["']$/g, '') : undefined)),
  GEMINI_API_KEY: z
    .string()
    .optional()
    .transform((val) => (val && val.trim() ? val.trim().replace(/^["']|["']$/g, '') : undefined)),
  GEMINI_CHAT_MODEL: z
    .string()
    .optional()
    .transform((val) => {
      const trimmed = val ? val.trim().replace(/^["']|["']$/g, '') : '';
      return trimmed || 'gemini-flash-lite-latest';
    }),
  GEMINI_EMBEDDING_MODEL: z
    .string()
    .optional()
    .transform((val) => {
      const trimmed = val ? val.trim().replace(/^["']|["']$/g, '') : '';
      return trimmed || 'gemini-embedding-001';
    }),
  EMBEDDING_DIMENSION: z
    .string()
    .optional()
    .transform((val) => {
      if (!val || !val.trim()) return 768;
      const parsed = parseInt(val.trim(), 10);
      return isNaN(parsed) ? 768 : parsed;
    }),
  // PDF Processing configuration (Phase 5)
  CHUNK_SIZE: z
    .string()
    .optional()
    .transform((val) => (val ? parseInt(val, 10) : 900))
    .pipe(z.number().min(100, 'CHUNK_SIZE must be at least 100 characters')),
  CHUNK_OVERLAP: z
    .string()
    .optional()
    .transform((val) => (val ? parseInt(val, 10) : 120))
    .pipe(z.number().min(0, 'CHUNK_OVERLAP must be non-negative')),
  JWT_SECRET: z
    .string()
    .optional()
    .transform((val) => {
      const trimmed = val ? val.trim().replace(/^["']|["']$/g, '') : '';
      return trimmed || 'ai-document-workspace-jwt-secret-phase3-key-2026';
    }),
  JWT_EXPIRES_IN: z.string().default('1d'),
  ADMIN_EMAIL: z.string().optional().transform((val) => (val && val.trim() ? val.trim() : undefined)),
  ADMIN_PASSWORD: z.string().optional().transform((val) => (val && val.trim() ? val.trim() : undefined)),
  ADMIN_NAME: z.string().default('System Admin'),
  UPLOAD_DIR: z
    .string()
    .default('uploads')
    .transform((val) => {
      const trimmed = val ? val.trim().replace(/^["']|["']$/g, '') : 'uploads';
      return path.isAbsolute(trimmed) ? trimmed : path.resolve(process.cwd(), trimmed);
    }),
});

export type EnvConfig = z.infer<typeof envSchema>;

export const validateEnv = (envData: Record<string, unknown> = process.env): EnvConfig => {
  const result = envSchema.safeParse(envData);
  if (!result.success) {
    const errorDetails = result.error.errors
      .map((err) => `  - ${err.path.join('.')}: ${err.message}`)
      .join('\n');
    throw new Error(`[Configuration Error] Missing or invalid environment variables:\n${errorDetails}`);
  }
  return result.data;
};

let cachedConfig: EnvConfig | null = null;

export const getConfig = (): EnvConfig => {
  if (!cachedConfig) {
    cachedConfig = validateEnv();
  }
  return cachedConfig;
};

/**
 * Returns a sanitized copy of the configuration safe for logging or debugging.
 * Sensitive credentials, keys, and connection strings are masked.
 */
export const getSanitizedConfig = (): Record<string, unknown> => {
  const cfg = getConfig();
  return {
    PORT: cfg.PORT,
    NODE_ENV: cfg.NODE_ENV,
    FRONTEND_URL: cfg.FRONTEND_URL,
    REDIS_URL: cfg.REDIS_URL,
    QDRANT_URL: cfg.QDRANT_URL,
    MONGODB_URI: cfg.MONGODB_URI ? '[CONFIGURED]' : '[NOT SET]',
    QDRANT_API_KEY: cfg.QDRANT_API_KEY ? '[CONFIGURED]' : '[NOT SET]',
    GEMINI_API_KEY: cfg.GEMINI_API_KEY ? '[CONFIGURED]' : '[NOT SET]',
    GEMINI_CHAT_MODEL: cfg.GEMINI_CHAT_MODEL,
    GEMINI_EMBEDDING_MODEL: cfg.GEMINI_EMBEDDING_MODEL,
    EMBEDDING_DIMENSION: cfg.EMBEDDING_DIMENSION,
    CHUNK_SIZE: cfg.CHUNK_SIZE,
    CHUNK_OVERLAP: cfg.CHUNK_OVERLAP,
    JWT_EXPIRES_IN: cfg.JWT_EXPIRES_IN,
    UPLOAD_DIR: cfg.UPLOAD_DIR,
  };
};

export const config = getConfig();
