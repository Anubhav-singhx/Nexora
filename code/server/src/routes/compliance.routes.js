// Compliance officer (checker) APIs. Mounted at /api/v1/compliance.
import { Router } from 'express';
import { ROLES } from '../constants.js';
import { searchAudit } from '../controllers/audit.controller.js';
import * as ctrl from '../controllers/compliance.controller.js';
import { authenticate, requireRole } from '../middleware/auth.js';
import { asyncHandler } from '../utils/errors.js';

const router = Router();
router.use(authenticate, requireRole(ROLES.COMPLIANCE_OFFICER));

router.get('/pending', asyncHandler(ctrl.pendingQueue));
router.get('/dashboard', asyncHandler(ctrl.dashboard));
router.get('/audit', asyncHandler(searchAudit));
router.get('/config', asyncHandler(ctrl.getConfig));
router.patch('/config', asyncHandler(ctrl.patchConfig));
router.get('/watchlists', asyncHandler(ctrl.listWatchlist));
router.post('/watchlists', asyncHandler(ctrl.createWatchlistEntry));
router.patch('/watchlists/:list/:id', asyncHandler(ctrl.updateWatchlistEntry));
router.delete('/watchlists/:list/:id', asyncHandler(ctrl.deleteWatchlistEntry));
router.post('/rescreen', asyncHandler(ctrl.rescreen));
router.post('/:id/decision', asyncHandler(ctrl.decide));
router.post('/:id/open-account', asyncHandler(ctrl.openAccountRetry));

export default router;
