import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { query } from '../db/index.js';
import { asyncHandler, forbidden, unauthorized } from '../utils/errors.js';

export function signToken(user) {
  return jwt.sign({ role: user.role, name: user.name }, config.jwtSecret, {
    algorithm: 'HS256',
    subject: String(user.id),
    expiresIn: config.jwtExpiresIn,
  });
}

/**
 * Verifies the Bearer token, then loads the user from the DB on every request, so a deleted user
 * or a changed role takes effect immediately. Sets req.user = { id, name, email, role }.
 * The role always comes from the database, never from the token.
 */
export const authenticate = asyncHandler(async (req, res, next) => {
  const [scheme, token] = (req.headers.authorization || '').split(' ');
  if (scheme !== 'Bearer' || !token) throw unauthorized('Missing bearer token');

  let payload;
  try {
    payload = jwt.verify(token, config.jwtSecret, { algorithms: ['HS256'] });
  } catch {
    throw unauthorized('Invalid or expired token');
  }

  const { rows } = await query('SELECT id, name, email, role FROM users WHERE id = $1', [payload.sub]);
  if (!rows[0]) throw unauthorized('User no longer exists');
  req.user = rows[0];
  next();
});

/** Server-side role check. Use after authenticate: router.get('/x', authenticate, requireRole(ROLES.X), handler) */
export const requireRole =
  (...roles) =>
  (req, res, next) => {
    if (!req.user) return next(unauthorized());
    if (!roles.includes(req.user.role)) return next(forbidden('Your role cannot access this resource'));
    next();
  };
