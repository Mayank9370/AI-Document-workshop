/**
 * PDF Text Extraction Service
 *
 * Uses pdf-parse to extract text page by page from local PDF files.
 * Handles malformed PDFs, password-protected PDFs, and text-less PDFs gracefully.
 * Releases all resources (parser.destroy()) after processing.
 * Does NOT perform OCR – scanned PDFs with no extractable text layer will return
 * hasText: false so caller can reject with a meaningful error.
 */
import fs from 'fs';
// pdf-parse 2.x exports PDFParse class
// eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
const pdfParseModule = require('pdf-parse');
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const PDFParse = (pdfParseModule.PDFParse || pdfParseModule.default?.PDFParse || pdfParseModule) as any;

import { logger } from '../utils/logger';

export interface PageText {
  pageNumber: number;
  text: string;
}

export interface PdfExtractionResult {
  pages: PageText[];
  totalPages: number;
  hasText: boolean;
}

/**
 * Extract text from a PDF file, page by page.
 * Returns a PdfExtractionResult with per-page text arrays.
 * Throws descriptive errors for password-protected or malformed PDFs.
 */
export async function extractPdfText(filePath: string): Promise<PdfExtractionResult> {
  // Confirm file exists before attempting to read
  if (!fs.existsSync(filePath)) {
    throw new Error(`PDF file not found at path: ${filePath}`);
  }

  const buffer = fs.readFileSync(filePath);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let parser: any = null;

  try {
    parser = new PDFParse({ data: buffer });
    const result = await parser.getText();

    const totalPages = result.total || result.pages.length || 0;
    const pageTexts: PageText[] = (result.pages || []).map((p: { text?: string; num?: number }, idx: number) => ({
      pageNumber: p.num ?? (idx + 1),
      text: p.text || '',
    }));

    // Detect PDFs with no text layer (e.g. scanned images)
    const totalTextLength = pageTexts.reduce((sum, p) => sum + p.text.trim().length, 0);
    const hasText = totalTextLength > 0;

    if (!hasText) {
      logger.warn(`PDF has no extractable text layer: ${filePath} (${totalPages} page(s))`);
    }

    logger.info(
      `PDF extracted: ${totalPages} page(s), ${totalTextLength} chars total → ${filePath}`
    );

    return { pages: pageTexts, totalPages, hasText };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);

    // Classify common error types
    if (msg.toLowerCase().includes('password')) {
      throw new Error('This PDF is password-protected and cannot be processed without the decryption key.');
    }
    if (
      msg.toLowerCase().includes('invalid pdf') ||
      msg.toLowerCase().includes('bad xref') ||
      msg.toLowerCase().includes('stream') ||
      msg.toLowerCase().includes('corrupt') ||
      msg.toLowerCase().includes('format') ||
      msg.toLowerCase().includes('formaterror')
    ) {
      throw new Error('The PDF file appears to be malformed or corrupted and could not be parsed.');
    }

    logger.error(`PDF extraction failure for ${filePath}: ${msg}`);
    throw new Error(`Failed to extract text from PDF: ${msg}`);
  } finally {
    if (parser && typeof parser.destroy === 'function') {
      try {
        await parser.destroy();
      } catch {
        // Clean release
      }
    }
  }
}
