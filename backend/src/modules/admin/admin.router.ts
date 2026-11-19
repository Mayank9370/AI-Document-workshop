import { Router } from 'express';
import { getAdminStats, getAdminActivity } from './admin.controller';
import { authenticate, authorize } from '../../middleware/auth';

const adminRouter = Router();

// Enforce authentication and admin authorization across all admin routes
adminRouter.use(authenticate);
adminRouter.use(authorize('admin'));

/**
 * GET /api/admin/stats
 * Retrieve system-wide user, document, and chat statistics.
 */
adminRouter.get('/stats', getAdminStats);

/**
 * GET /api/admin/activity
 * Retrieve bounded recent activity feed.
 */
adminRouter.get('/activity', getAdminActivity);

export default adminRouter;
