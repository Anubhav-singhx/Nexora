// Read-only lookup data for forms. Names only: risk levels are never sent to applicants.
import { Router } from 'express';
import { query } from '../db/index.js';
import { authenticate } from '../middleware/auth.js';
import { asyncHandler } from '../utils/errors.js';

const router = Router();
router.use(authenticate);
router.get('/occupations', asyncHandler(async (req, res) => {
  const { rows } = await query('SELECT code, name FROM occupations ORDER BY name');
  res.json({ occupations: rows });
}));
export default router;
