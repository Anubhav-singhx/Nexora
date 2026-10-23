// KYC officer (maker) APIs. Mounted at /api/v1/review.
import { Router } from 'express';
import { ROLES } from '../constants.js';
import * as ctrl from '../controllers/review.controller.js';
import { authenticate, requireRole } from '../middleware/auth.js';
import { asyncHandler } from '../utils/errors.js';

const router = Router();
// KYC officers are the makers. Compliance officers may also work the queue, which is exactly why the checker guard
// "maker and checker must differ" exists (a compliance officer who recommended a case cannot decide it).
router.use(authenticate, requireRole(ROLES.KYC_OFFICER, ROLES.COMPLIANCE_OFFICER));

router.get('/queue', asyncHandler(ctrl.reviewQueue));
router.patch('/:id/documents/:docId/fields/:field', asyncHandler(ctrl.correctField));
router.post('/:id/recommend', asyncHandler(ctrl.recommend));

export default router;
