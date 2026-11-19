import multer from 'multer';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { Request } from 'express';
import { config } from '../../config/env';
import { logger } from '../../utils/logger';

// 10 MB file size limit in bytes
export const MAX_FILE_SIZE = 10 * 1024 * 1024;
export const PDF_MIME_TYPE = 'application/pdf';
export const PDF_MAGIC_BYTES = Buffer.from([0x25, 0x50, 0x44, 0x46]); // "%PDF"

/**
 * Ensures the uploads directory exists safely.
 */
export const ensureUploadDirectory = (): string => {
  const dir = config.UPLOAD_DIR;
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
    logger.info(`Upload directory created at: ${dir}`);
  }
  return dir;
};

// Storage configuration with random collision-free names
const storage = multer.diskStorage({
  destination: (_req: Request, _file: Express.Multer.File, cb) => {
    try {
      const dir = ensureUploadDirectory();
      cb(null, dir);
    } catch (err) {
      cb(err as Error, '');
    }
  },
  filename: (_req: Request, file: Express.Multer.File, cb) => {
    // Generate secure random UUID filename with .pdf extension, completely ignoring user-supplied paths
    const uniqueName = `${Date.now()}-${crypto.randomUUID()}.pdf`;
    cb(null, uniqueName);
  },
});

/**
 * Validates initial MIME type and extension before saving.
 */
const fileFilter = (
  _req: Request,
  file: Express.Multer.File,
  cb: multer.FileFilterCallback
) => {
  const ext = path.extname(file.originalname).toLowerCase();

  if (file.mimetype !== PDF_MIME_TYPE || ext !== '.pdf') {
    return cb(new Error('Invalid file type. Only PDF documents (.pdf) are permitted.'));
  }

  cb(null, true);
};

export const uploadMiddleware = multer({
  storage,
  limits: {
    fileSize: MAX_FILE_SIZE,
    files: 1, // Only 1 file per upload request
  },
  fileFilter,
});

/**
 * Validates the physical file signature (magic bytes) to ensure actual PDF contents.
 * Returns true if valid, false if corrupt/spoofed.
 */
export const validatePdfMagicBytes = async (filePath: string): Promise<boolean> => {
  let fileHandle: fs.promises.FileHandle | null = null;
  try {
    fileHandle = await fs.promises.open(filePath, 'r');
    const buffer = Buffer.alloc(4);
    const { bytesRead } = await fileHandle.read(buffer, 0, 4, 0);

    if (bytesRead < 4) {
      return false;
    }

    // Verify header starts with "%PDF" (0x25, 0x50, 0x44, 0x46)
    return buffer.equals(PDF_MAGIC_BYTES);
  } catch (err) {
    logger.error('Error reading PDF magic bytes:', err);
    return false;
  } finally {
    if (fileHandle) {
      await fileHandle.close();
    }
  }
};

/**
 * Safely removes an uploaded file from disk if validation or database save fails.
 */
export const removePhysicalFile = async (filePath: string): Promise<void> => {
  try {
    if (fs.existsSync(filePath)) {
      await fs.promises.unlink(filePath);
      logger.info(`Cleaned up physical file: ${filePath}`);
    }
  } catch (err) {
    logger.error(`Failed to clean up file at ${filePath}:`, err);
  }
};
