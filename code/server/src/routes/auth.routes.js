import { Router } from 'express';
import * as ctrl from '../controllers/auth.controller.js';
import { authenticate } from '../middleware/auth.js';
import { asyncHandler } from '../utils/errors.js';

const router = Router();

router.post('/register', asyncHandler(ctrl.register));
router.post('/login', asyncHandler(ctrl.login));
router.get('/me', authenticate, asyncHandler(ctrl.me));

export default router;
