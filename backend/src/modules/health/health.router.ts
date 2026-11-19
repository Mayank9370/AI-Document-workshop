import { Router } from 'express';
import { getHealth, getReadiness } from './health.controller';

const router = Router();

// Liveness probe
router.get('/', getHealth);

// Readiness probe
router.get('/ready', getReadiness);

export default router;
