// OWNER: Person 1. All routers are mounted here ONCE.
import { Router } from 'express';
import { query } from '../db/index.js';
import applicationRoutes from './application.routes.js';
import authRoutes from './auth.routes.js';
import complianceRoutes from './compliance.routes.js';
import coreBankingRoutes from './coreBanking.routes.js';
import documentsRoutes from './documents.routes.js';
import referenceRoutes from './reference.routes.js';
import reviewRoutes from './review.routes.js';

const router = Router();

router.get('/health', async (req, res) => {
  let db = 'up';
  try {
    await query('SELECT 1');
  } catch {
    db = 'down';
  }
  res.status(db === 'up' ? 200 : 503).json({
    status: db === 'up' ? 'ok' : 'degraded',
    db,
    time: new Date().toISOString(),
  });
});

router.use('/auth', authRoutes);
router.use('/applications', applicationRoutes);
router.use('/documents', documentsRoutes);
router.use('/reference', referenceRoutes);
router.use('/review', reviewRoutes);
router.use('/compliance', complianceRoutes);
router.use('/mock-core-banking', coreBankingRoutes);

export default router;
