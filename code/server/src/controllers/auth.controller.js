import bcrypt from 'bcryptjs';
import { clearFailures, recordFailure, retryAfterSeconds } from '../services/loginLimiter.js';
import { AUDIT, ROLES } from '../constants.js';
import { config } from '../config.js';
import { query, withTransaction } from '../db/index.js';
import { signToken } from '../middleware/auth.js';
import { recordAudit } from '../services/audit.js';
import { AppError, conflict } from '../utils/errors.js';
import { loginSchema, parseOrThrow, registerSchema } from '../validators/auth.js';

const publicUser = (u) => ({ id: u.id, name: u.name, email: u.email, role: u.role });

// Compared against when the email does not exist, so response time does not reveal which emails are registered.
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', config.bcryptRounds);

/** POST /auth/register - public sign-up always creates an APPLICANT. Role cannot be chosen by the caller. */
export async function register(req, res) {
  const { name, email, password } = parseOrThrow(registerSchema, req.body);
  const hash = await bcrypt.hash(password, config.bcryptRounds);

  const user = await withTransaction(async (client) => {
    const exists = await client.query('SELECT 1 FROM users WHERE email = $1', [email]);
    if (exists.rowCount) throw conflict('EMAIL_TAKEN', 'An account with this email already exists');
    const { rows } = await client.query(
      `INSERT INTO users (name, email, password_hash, role) VALUES ($1, $2, $3, $4)
       RETURNING id, name, email, role`,
      [name, email, hash, ROLES.APPLICANT],
    );
    await recordAudit(client, {
      actor: rows[0],
      eventType: AUDIT.USER_REGISTERED,
      entityType: 'user',
      entityId: rows[0].id,
    });
    return rows[0];
  });

  res.status(201).json({ token: signToken(user), user: publicUser(user) });
}

/** POST /auth/login - same error for unknown email and wrong password. */
export async function login(req, res) {
  const { email, password } = parseOrThrow(loginSchema, req.body);
  const wait = retryAfterSeconds(req.ip, email);
  if (wait) {
    res.set('Retry-After', String(wait));
    throw new AppError(429, 'TOO_MANY_ATTEMPTS', `Too many failed sign-in attempts. Try again in ${Math.ceil(wait / 60)} minute(s).`);
  }
  const { rows } = await query('SELECT * FROM users WHERE email = $1', [email]);
  const user = rows[0];

  const ok = await bcrypt.compare(password, user ? user.password_hash : DUMMY_HASH);
  if (!user || !ok) {
    recordFailure(req.ip, email);
    await recordAudit({ query }, {
      actor: null,
      eventType: AUDIT.LOGIN_FAILED,
      entityType: 'user',
      entityId: user ? user.id : null,
      details: { email },
    });
    throw new AppError(401, 'INVALID_CREDENTIALS', 'Invalid email or password');
  }

  clearFailures(req.ip, email);
  await recordAudit({ query }, { actor: user, eventType: AUDIT.LOGIN_SUCCESS, entityType: 'user', entityId: user.id });
  res.json({ token: signToken(user), user: publicUser(user) });
}

/** GET /auth/me */
export async function me(req, res) {
  res.json({ user: publicUser(req.user) });
}
