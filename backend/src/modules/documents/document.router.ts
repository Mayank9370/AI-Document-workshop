import { Router, Request, Response, NextFunction } from 'express';
import multer from 'multer';
import {
  uploadDocument,
  listDocuments,
  getDocumentById,
  deleteDocument,
  reindexDocument,
  searchDocument,
} from './document.controller';
import { uploadMiddleware } from './document.upload';
import { authenticate } from '../../middleware/auth';
import { sendError } from '../../utils/response';

const router = Router();

/**
 * Custom Multer wrapper to capture size limit and extension errors gracefully
 */
const handleMulterUpload = (req: Request, res: Response, next: NextFunction): void => {
  uploadMiddleware.single('file')(req, res, (err: unknown) => {
    if (err) {
      if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') {
          sendError(res, 'File size exceeds the maximum limit of 10 MB.', 400);
          return;
        }
        sendError(res, `Upload failure: ${err.message}`, 400);
        return;
      }
      if (err instanceof Error) {
        sendError(res, err.message, 400);
        return;
      }
      sendError(res, 'Unknown error during file upload.', 400);
      return;
    }
    next();
  });
};

// All document routes require authentication
router.use(authenticate);

// Document Endpoints
router.post('/upload', handleMulterUpload, uploadDocument);
router.get('/', listDocuments);
router.get('/:id', getDocumentById);
router.delete('/:id', deleteDocument);
router.post('/:id/reindex', reindexDocument);
router.post('/:id/search', searchDocument);

export default router;
