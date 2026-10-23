// POST /api/v1/documents/:docId/extract - extraction through the configured provider (mock | ai).
// Callable by a signed-in user, or by the backend itself with the service key (header x-service-key).
import crypto from 'node:crypto';
import { Router } from 'express';
import { config } from '../config.js';
import * as ctrl from '../controllers/application.controller.js';
import { authenticate } from '../middleware/auth.js';
import { asyncHandler, unauthorized } from '../utils/errors.js';

const same = (a, b) => {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};

function userOrServiceKey(req, res, next) {
  const key = req.headers['x-service-key'];
  if (key === undefined) return authenticate(req, res, next);
  if (!same(key, config.extraction.serviceKey)) return next(unauthorized('Invalid service key'));
  req.user = { id: null, name: 'extraction-client', email: null, role: 'SYSTEM' };
  req.serviceCall = true;
  next();
}

const router = Router();
router.post('/:docId/extract', userOrServiceKey, asyncHandler(ctrl.extractEndpoint));
export default router;
