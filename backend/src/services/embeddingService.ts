/**
 * Gemini Embedding Service
 *
 * Generates text embeddings using the Google Gemini Embedding API.
 * Supports single and batch embedding generation.
 * Implements bounded retry with exponential backoff for transient errors.
 * Validates returned vector dimensions against configured EMBEDDING_DIMENSION.
 *
 * IMPORTANT:
 * - The Gemini API key is read from the backend env and NEVER exposed to the frontend.
 * - Embeddings are NOT persisted in MongoDB; they will be stored in Qdrant (Phase 6).
 */
import { GoogleGenerativeAI, TaskType } from '@google/generative-ai';
import { getConfig } from '../config/env';
import { logger } from '../utils/logger';

export interface EmbeddingResult {
  text: string;
  embedding: number[];
  dimensions: number;
}

/** Maximum number of retry attempts for transient errors */
const MAX_RETRIES = 3;
/** Initial backoff in ms (doubles on each retry) */
const INITIAL_BACKOFF_MS = 500;

/**
 * Sleep helper for backoff delays.
 */
const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Determine whether an error warrants a retry (transient / rate-limit).
 */
function isRetryableError(err: unknown): boolean {
  const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();
  return (
    msg.includes('429') ||
    msg.includes('quota') ||
    msg.includes('rate limit') ||
    msg.includes('503') ||
    msg.includes('unavailable') ||
    msg.includes('timeout') ||
    msg.includes('econnreset') ||
    msg.includes('socket hang up')
  );
}

let _genAI: GoogleGenerativeAI | null = null;

function getGenAI(): GoogleGenerativeAI {
  if (!_genAI) {
    const cfg = getConfig();
    if (!cfg.GEMINI_API_KEY) {
      throw new Error(
        'GEMINI_API_KEY is not configured. Please set it in backend/.env to use embedding generation.'
      );
    }
    _genAI = new GoogleGenerativeAI(cfg.GEMINI_API_KEY);
  }
  return _genAI;
}

/**
 * Generate an embedding vector for a single text string.
 * Retries up to MAX_RETRIES times on transient API errors.
 *
 * @param text - Input text string
 * @param taskType - TaskType.RETRIEVAL_DOCUMENT for chunks or TaskType.RETRIEVAL_QUERY for search queries
 */
export async function embedText(
  text: string,
  taskType: TaskType = TaskType.RETRIEVAL_DOCUMENT
): Promise<EmbeddingResult> {
  const cfg = getConfig();
  const modelName = cfg.GEMINI_EMBEDDING_MODEL;
  const expectedDimensions = cfg.EMBEDDING_DIMENSION;

  if (!text || !text.trim()) {
    throw new Error('Cannot embed empty or whitespace-only text.');
  }

  const genAI = getGenAI();
  const model = genAI.getGenerativeModel({ model: modelName });

  let lastError: unknown;
  let backoff = INITIAL_BACKOFF_MS;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const embedPayload: any = {
        content: { role: 'user', parts: [{ text: text.trim() }] },
        taskType,
      };

      if (expectedDimensions) {
        embedPayload.outputDimensionality = expectedDimensions;
      }

      const result = await model.embedContent(embedPayload);

      const embedding = result.embedding.values;
      if (!embedding || embedding.length === 0) {
        throw new Error('Gemini API returned an empty embedding vector.');
      }

      if (embedding.length !== expectedDimensions) {
        logger.warn(
          `Embedding dimension mismatch: expected ${expectedDimensions}, got ${embedding.length} ` +
            `(model: ${modelName}). Proceeding with actual dimensions.`
        );
      }

      return {
        text: text.trim(),
        embedding,
        dimensions: embedding.length,
      };
    } catch (err: unknown) {
      lastError = err;
      const msg = err instanceof Error ? err.message : String(err);

      if (isRetryableError(err) && attempt < MAX_RETRIES) {
        logger.warn(
          `Gemini embedding attempt ${attempt}/${MAX_RETRIES} failed (retryable): ${msg}. ` +
            `Retrying in ${backoff}ms...`
        );
        await sleep(backoff);
        backoff *= 2;
        continue;
      }

      // Non-retryable or final attempt – break out
      break;
    }
  }

  const errMsg = lastError instanceof Error ? lastError.message : String(lastError);
  logger.error(`Gemini embedding failed after ${MAX_RETRIES} attempts: ${errMsg}`);
  throw new Error(`Embedding generation failed: ${errMsg}`);
}

/**
 * Generate embedding for a document chunk using TaskType.RETRIEVAL_DOCUMENT.
 */
export async function embedDocument(text: string): Promise<EmbeddingResult> {
  return embedText(text, TaskType.RETRIEVAL_DOCUMENT);
}

/**
 * Generate embedding for a user search query using TaskType.RETRIEVAL_QUERY.
 */
export async function embedQuery(query: string): Promise<EmbeddingResult> {
  return embedText(query, TaskType.RETRIEVAL_QUERY);
}

/**
 * Generate embeddings for a batch of text strings.
 * Sequential to respect rate limits.
 */
export async function embedBatch(
  texts: string[],
  taskType: TaskType = TaskType.RETRIEVAL_DOCUMENT
): Promise<EmbeddingResult[]> {
  if (texts.length === 0) return [];

  const results: EmbeddingResult[] = [];
  for (const text of texts) {
    const result = await embedText(text, taskType);
    results.push(result);
  }
  return results;
}
