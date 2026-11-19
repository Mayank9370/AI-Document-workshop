import { Router } from 'express';
import {
  register,
  login,
  getCurrentUser,
  logout,
  adminTest,
} from './auth.controller';
import { authenticate, authorize } from '../../middleware/auth';

const router = Router();

// Public Authentication Endpoints
router.post('/register', register);
router.post('/login', login);
router.post('/logout', logout);

// Protected User Endpoint
router.get('/me', authenticate, getCurrentUser);

// Admin-Only Verification Endpoint (RBAC test)
router.get('/admin-test', authenticate, authorize('admin'), adminTest);

export default router;
