/**
 * Text Chunking Service
 *
 * Splits per-page text into overlapping fixed-size chunks for embedding and retrieval.
 *
 * Algorithm:
 * 1. For each page's text, slide a window of `chunkSize` characters forward by
 *    `chunkSize - overlap` characters on each step.
 * 2. This guarantees that consecutive chunks share `overlap` characters of context,
 *    preventing the loss of meaning at chunk boundaries.
 * 3. Empty chunks (pages with no meaningful text after trimming) are skipped.
 * 4. Very short pages (text shorter than `chunkSize`) produce a single chunk.
 * 5. `chunkIndex` is page-scoped (resets to 0 for each page).
 *
 * Chunk size and overlap are configurable via CHUNK_SIZE and CHUNK_OVERLAP env vars.
 */

import { PageText } from './pdfExtractor';
import { getConfig } from '../config/env';

export interface TextChunk {
  pageNumber: number;
  chunkIndex: number;
  text: string;
  charCount: number;
}

/**
 * Chunk a single page's text into overlapping segments.
 */
function chunkPageText(
  pageNumber: number,
  text: string,
  chunkSize: number,
  overlap: number
): TextChunk[] {
  const trimmed = text.trim();
  if (!trimmed) return [];

  const chunks: TextChunk[] = [];
  const step = chunkSize - overlap;

  // Guard against zero/negative step (config misconfiguration)
  if (step <= 0) {
    // Fallback: single chunk with full text
    return [{ pageNumber, chunkIndex: 0, text: trimmed, charCount: trimmed.length }];
  }

  let chunkIndex = 0;
  let start = 0;

  while (start < trimmed.length) {
    const end = Math.min(start + chunkSize, trimmed.length);
    const chunkText = trimmed.slice(start, end).trim();

    if (chunkText.length > 0) {
      chunks.push({
        pageNumber,
        chunkIndex,
        text: chunkText,
        charCount: chunkText.length,
      });
      chunkIndex++;
    }

    // If we've reached the end, stop
    if (end === trimmed.length) break;
    start += step;
  }

  return chunks;
}

/**
 * Chunk all pages from a PDF extraction result.
 * Returns a flat ordered array of TextChunk objects.
 */
export function chunkPages(
  pages: PageText[],
  overrideChunkSize?: number,
  overrideOverlap?: number
): TextChunk[] {
  const cfg = getConfig();
  const chunkSize = overrideChunkSize ?? cfg.CHUNK_SIZE;
  const overlap = overrideOverlap ?? cfg.CHUNK_OVERLAP;

  const allChunks: TextChunk[] = [];

  for (const page of pages) {
    const pageChunks = chunkPageText(page.pageNumber, page.text, chunkSize, overlap);
    allChunks.push(...pageChunks);
  }

  return allChunks;
}
