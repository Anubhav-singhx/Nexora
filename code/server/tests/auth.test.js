import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { pool } from '../src/db/index.js';
import { resetLoginLimiter } from '../src/services/loginLimiter.js';
import { api, login, registerApplicant } from './helpers.js';

afterAll(() => pool.end());

describe('health and error shape', () => {
  it('GET /health reports ok with the database up', async () => {
    const res = await api.get('/api/v1/health');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'ok', db: 'up' });
  });

  it('unknown routes return the standard error JSON', async () => {
    const res = await api.get('/api/v1/does-not-exist');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('malformed JSON gives 400 INVALID_JSON', async () => {
    const res = await api.post('/api/v1/auth/login').set('Content-Type', 'application/json').send('{bad json');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_JSON');
  });
});

describe('registration', () => {
  it('creates an APPLICANT and returns a token', async () => {
    const { token, user } = await registerApplicant();
    expect(token).toBeTruthy();
    expect(user.role).toBe('APPLICANT');
  });

  it('ignores a role sent by the caller (no privilege escalation)', async () => {
    const res = await api
      .post('/api/v1/auth/register')
      .send({ name: 'Sneaky', email: `sneaky${Date.now()}@test.com`, password: 'Secret123', role: 'COMPLIANCE_OFFICER' });
    expect(res.status).toBe(201);
    expect(res.body.user.role).toBe('APPLICANT');
  });

  it('rejects a duplicate email (case-insensitive) with 409', async () => {
    const { email } = await registerApplicant();
    const res = await api
      .post('/api/v1/auth/register')
      .send({ name: 'Again', email: email.toUpperCase(), password: 'Secret123' });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('EMAIL_TAKEN');
  });

  it.each([
    ['short password', { password: 'Ab1' }, 'password'],
    ['no digit', { password: 'OnlyLetters' }, 'password'],
    ['bad email', { email: 'not-an-email' }, 'email'],
    ['short name', { name: 'A' }, 'name'],
  ])('rejects %s with 400 and names the field', async (_label, override, field) => {
    const body = { name: 'Valid Name', email: `v${Date.now()}@test.com`, password: 'Secret123', ...override };
    const res = await api.post('/api/v1/auth/register').send(body);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.details.map((d) => d.field)).toContain(field);
  });

  it('never stores a plain-text password', async () => {
    const { email } = await registerApplicant();
    const { rows } = await pool.query('SELECT password_hash FROM users WHERE email = $1', [email]);
    expect(rows[0].password_hash).not.toContain('Secret123');
    expect(rows[0].password_hash).toMatch(/^\$2[aby]\$/);
  });
});

describe('login and token checks', () => {
  it('logs in the three seeded demo users with the right roles', async () => {
    for (const [email, role] of [
      ['applicant@demo.com', 'APPLICANT'],
      ['officer@demo.com', 'KYC_OFFICER'],
      ['checker@demo.com', 'COMPLIANCE_OFFICER'],
    ]) {
      const res = await api.post('/api/v1/auth/login').send({ email, password: 'Demo@1234' });
      expect(res.status).toBe(200);
      expect(res.body.user.role).toBe(role);
    }
  });

  it('gives the same 401 for a wrong password and an unknown email', async () => {
    const wrong = await api.post('/api/v1/auth/login').send({ email: 'applicant@demo.com', password: 'WrongPass1' });
    const unknown = await api.post('/api/v1/auth/login').send({ email: 'nobody@nowhere.com', password: 'WrongPass1' });
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(wrong.body).toEqual(unknown.body);
    expect(wrong.body.error.code).toBe('INVALID_CREDENTIALS');
  });

  it('GET /auth/me works with a valid token', async () => {
    const token = await login('officer@demo.com');
    const res = await api.get('/api/v1/auth/me').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({ email: 'officer@demo.com', role: 'KYC_OFFICER' });
    expect(res.body.user.password_hash).toBeUndefined();
  });

  it('returns 401 for missing, garbage and tampered tokens', async () => {
    expect((await api.get('/api/v1/auth/me')).status).toBe(401);
    expect((await api.get('/api/v1/auth/me').set('Authorization', 'Bearer garbage')).status).toBe(401);
    const token = await login('applicant@demo.com');
    const tampered = token.slice(0, -3) + (token.endsWith('abc') ? 'xyz' : 'abc');
    expect((await api.get('/api/v1/auth/me').set('Authorization', `Bearer ${tampered}`)).status).toBe(401);
  });

  it('records login success and failure in the audit log', async () => {
    await api.post('/api/v1/auth/login').send({ email: 'applicant@demo.com', password: 'WrongPass1' });
    await login('applicant@demo.com');
    const { rows } = await pool.query(
      "SELECT DISTINCT event_type FROM audit_events WHERE event_type IN ('LOGIN_FAILED','LOGIN_SUCCESS')",
    );
    expect(rows.map((r) => r.event_type).sort()).toEqual(['LOGIN_FAILED', 'LOGIN_SUCCESS']);
  });
});

describe('brute-force guard', () => {
  beforeEach(() => resetLoginLimiter());
  afterAll(() => resetLoginLimiter());

  it('blocks an email after 8 failed attempts, with Retry-After, even for the right password', async () => {
    const email = 'officer@demo.com';
    for (let i = 0; i < 8; i++) {
      const r = await api.post('/api/v1/auth/login').send({ email, password: 'WrongPass1' });
      expect(r.status).toBe(401);
    }
    const blocked = await api.post('/api/v1/auth/login').send({ email, password: 'Demo@1234' });
    expect(blocked.status).toBe(429);
    expect(blocked.body.error.code).toBe('TOO_MANY_ATTEMPTS');
    expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(0);
    // another account is not affected
    const other = await api.post('/api/v1/auth/login').send({ email: 'checker@demo.com', password: 'Demo@1234' });
    expect(other.status).toBe(200);
  });

  it('a successful login resets the counter', async () => {
    const email = 'applicant@demo.com';
    for (let i = 0; i < 5; i++) await api.post('/api/v1/auth/login').send({ email, password: 'WrongPass1' });
    expect((await api.post('/api/v1/auth/login').send({ email, password: 'Demo@1234' })).status).toBe(200);
    for (let i = 0; i < 5; i++) {
      expect((await api.post('/api/v1/auth/login').send({ email, password: 'WrongPass1' })).status).toBe(401);
    }
  });
});
