// Case compliance suite: replays the 12 worked examples of the case document (Section 9) end to end through the
// HTTP API, plus the cross-cutting requirements that a reviewer will probe (FR-1 access, FR-2 validation, FR-7
// concurrency, FR-9 audit, FR-10 dashboard, FR-11 batch). Examples 1-10 are the first ten applications of the
// shipped sample set; each test submits the very same form values and document files as an applicant would.
import { afterAll, describe, expect, it } from 'vitest';
import { pool } from '../src/db/index.js';
import { REASON } from '../src/constants.js';
import { REASON_MESSAGE } from '../src/services/applicantView.js';
import { api, applicantWith, get, login, loginChecker, loginOfficer, registerApplicant, sampleFields, send, submitApplication, validDocs } from './helpers.js';

afterAll(() => pool.end());

const row = async (id) => (await pool.query('SELECT * FROM applications WHERE id = $1', [id])).rows[0];

// example -> [scenario key, final status, decision, reason codes, score, risk, re-KYC date]
const EXAMPLES = [
  [1, 'clean', 'AUTO_APPROVED', 'APPROVE', [], 1, 'LOW', '2036-03-04'],
  [2, 'mehta', 'AUTO_REJECTED', 'REJECT', ['AGE_BELOW_18'], 1, null, null],
  [3, 'pan_mismatch', 'AUTO_REJECTED', 'REJECT', ['PAN_MISMATCH'], 1, null, null],
  [4, 'ravi', 'IN_REVIEW', 'REVIEW', ['NAME_MISMATCH_MINOR'], 0.7647, 'LOW', '2036-03-04'],
  [5, 'stale', 'IN_REVIEW', 'REVIEW', ['ADDRESS_PROOF_STALE'], 1, 'LOW', '2036-03-04'],
  [6, 'orlov', 'AUTO_REJECTED', 'REJECT', ['SANCTIONS_MATCH'], 1, null, null],
  [7, 'malhotra', 'IN_REVIEW', 'REVIEW', ['PEP_MATCH'], 1, 'HIGH', '2028-03-04'],
  [8, 'wrongdoc', 'IN_REVIEW', 'REVIEW', ['DOCUMENT_MISSING', 'DOCUMENT_TYPE_MISMATCH'], 1, 'LOW', '2036-03-04'],
  [9, 'iyer', 'IN_REVIEW', 'REVIEW', ['LOW_EXTRACTION_CONFIDENCE'], 1, 'LOW', '2036-03-04'],
  [10, 'nair', 'PENDING_CHECKER', 'APPROVE', [], 1, 'HIGH', '2028-03-04'],
];

describe('worked examples 1-10 through the API', () => {
  it.each(EXAMPLES)('example %i (%s)', async (_n, key, status, decision, codes, score, risk, rekyc) => {
    const checker = await loginChecker();
    const a = await applicantWith(key);
    const r = await row(a.id);
    expect(r.status).toBe(status);
    expect(r.decision).toBe(decision);
    expect(r.reason_codes).toEqual(codes);
    expect(Number(r.name_match_score)).toBe(score);
    expect(r.risk_category).toBe(risk);
    // GET /applications/:id/decision for staff returns exactly the case's output fields
    const { body } = await get(`/api/v1/applications/${a.id}/decision`, checker);
    expect(body.decision).toMatchObject({ application_id: a.id, decision, reason_codes: codes, name_match_score: score, risk_category: risk, status });
    expect(String(body.decision.rekyc_due_date ?? '').slice(0, 10)).toBe(rekyc ?? '');
    expect(body.decision.documents.length).toBeGreaterThanOrEqual(3);
    // REJECT leaves risk and re-KYC blank
    if (decision === 'REJECT') expect([body.decision.risk_category, body.decision.rekyc_due_date]).toEqual([null, null]);
    // the applicant sees a status and plain reasons, never scores, lists or confidences
    const own = await get(`/api/v1/applications/${a.id}/decision`, a.token);
    expect(JSON.stringify(own.body)).not.toMatch(/name_match_score|risk_category|SANCTIONS|PEP_MATCH|confidence/);
  });
});

describe('worked example 11: maker and checker must differ', () => {
  it('the officer who recommended cannot decide; a different compliance officer can and the mock core bank opens an account', async () => {
    const u1 = await loginChecker(); // a compliance officer who works the review queue
    const a = await applicantWith('ravi'); // example 4
    expect((await row(a.id)).status).toBe('IN_REVIEW');
    const rec = await send('post', `/api/v1/review/${a.id}/recommend`, u1, { recommendation: 'APPROVE', comment: 'Name differs by a middle initial only', version: (await row(a.id)).version });
    expect(rec.status).toBe(200);
    expect((await row(a.id)).status).toBe('PENDING_CHECKER');

    const self = await send('post', `/api/v1/compliance/${a.id}/decision`, u1, { decision: 'APPROVE', comment: '', version: (await row(a.id)).version });
    expect(self.status).toBe(403);
    expect((await row(a.id)).status).toBe('PENDING_CHECKER');

    // U2: the second seeded compliance officer
    const u2 = await login('checker2@demo.com');
    const ok = await send('post', `/api/v1/compliance/${a.id}/decision`, u2, { decision: 'APPROVE', comment: '', version: (await row(a.id)).version });
    expect(ok.status).toBe(200);
    expect(ok.body.application).toMatchObject({ status: 'APPROVED' });
    expect(ok.body.application.core_customer_id).toMatch(/^CUST\d{8}$/);
    expect(ok.body.application.core_account_id).toMatch(/^5010\d{8}$/);
  });
});

describe('worked example 12: officer corrects the PAN of example 9', () => {
  it('re-runs the rules to APPROVE with no codes, goes to the checker, and audits old and new value', async () => {
    const officer = await loginOfficer();
    const a = await applicantWith('iyer');
    expect((await row(a.id)).reason_codes).toEqual(['LOW_EXTRACTION_CONFIDENCE']);
    const noReason = await send('patch', `/api/v1/review/${a.id}/documents/D3000025/fields/pan_number`, officer, { value: 'ZZTPS9012Y', reason: '', version: (await row(a.id)).version });
    expect(noReason.status).toBe(400); // a reason is mandatory
    const fix = await send('patch', `/api/v1/review/${a.id}/documents/D3000025/fields/pan_number`, officer, { value: 'ZZTPS9012Y', reason: 'Card is legible on the original', version: (await row(a.id)).version });
    expect(fix.status).toBe(200);
    const r = await row(a.id);
    expect(r).toMatchObject({ decision: 'APPROVE', status: 'PENDING_CHECKER' });
    expect(r.reason_codes).toEqual([]);
    const ev = (await pool.query("SELECT old_value, new_value, actor_id FROM audit_events WHERE application_id = $1 AND event_type = 'FIELD_CORRECTED'", [a.id])).rows;
    expect(ev).toHaveLength(1);
    // stored values are the real ones (the API masks them); the audit keeps who changed what from what to what
    expect(JSON.stringify(ev[0].old_value)).toContain('ZZTP59O12Y');
    expect(JSON.stringify(ev[0].new_value)).toContain('ZZTPS9012Y');
    expect(ev[0].actor_id).not.toBeNull();
  });
});

describe('FR-1 access control', () => {
  it('applicants cannot use officer or compliance APIs, nor read another applicant\'s case; anonymous is 401', async () => {
    const a = await applicantWith('clean');
    const b = await registerApplicant();
    for (const url of ['/api/v1/review/queue', '/api/v1/compliance/pending', '/api/v1/compliance/dashboard', '/api/v1/compliance/config']) {
      expect((await get(url, a.token)).status, url).toBe(403);
      expect((await api.get(url)).status, url).toBe(401);
    }
    expect([403, 404]).toContain((await get(`/api/v1/applications/${a.id}`, b.token)).status);
    expect([403, 404]).toContain((await get(`/api/v1/applications/${a.id}/decision`, b.token)).status);
    expect((await get('/api/v1/compliance/dashboard', await loginOfficer())).status).toBe(403);
  });
});

describe('FR-2 validation', () => {
  it('rejects missing, malformed and impossible values and stores nothing', async () => {
    const { token, user } = await registerApplicant();
    const bad = async (over) => (await submitApplication(token, { fields: sampleFields('A2000001', over), docs: validDocs() })).status;
    expect(await bad({ full_name: '' })).toBe(400);
    expect(await bad({ dob: '1990-02-31' })).toBe(400);
    expect(await bad({ dob: '2999-01-01' })).toBe(400);
    expect(await bad({ pincode: '12345' })).toBe(400);
    expect(await bad({ aadhaar_last4: '12' })).toBe(400);
    expect(await bad({ annual_income: '-5' })).toBe(400);
    expect(await bad({ occupation_code: '' })).toBe(400);
    expect(await bad({ consent: 'false' })).toBe(400);
    const n = (await pool.query('SELECT count(*)::int AS n FROM applications WHERE user_id = $1', [user.id])).rows[0].n;
    expect(n).toBe(0);
  });
});

describe('FR-7 concurrency and FR-9 audit', () => {
  it('a stale version is refused with 409 VERSION_CONFLICT', async () => {
    const officer = await loginOfficer();
    const a = await applicantWith('ravi');
    const v = (await row(a.id)).version;
    const first = await send('post', `/api/v1/review/${a.id}/recommend`, officer, { recommendation: 'REJECT', comment: 'Documents belong to someone else', version: v });
    expect(first.status).toBe(200);
    const stale = await send('post', `/api/v1/review/${a.id}/recommend`, officer, { recommendation: 'APPROVE', comment: 'Changed my mind later', version: v });
    expect(stale.status).toBe(409);
  });

  it('every submission leaves created / uploaded / extracted / evaluated events, in order, and the table is append-only', async () => {
    const checker = await loginChecker();
    const a = await applicantWith('clean');
    const types = (await get(`/api/v1/applications/${a.id}/audit`, checker)).body.events.map((e) => e.event_type);
    for (const t of ['APPLICATION_CREATED', 'DOCUMENT_UPLOADED', 'DOCUMENT_EXTRACTED', 'EVALUATED']) expect(types).toContain(t);
    expect(types.indexOf('APPLICATION_CREATED')).toBeLessThan(types.indexOf('EVALUATED'));
    await expect(pool.query("UPDATE audit_events SET details = '{}'::jsonb")).rejects.toThrow(/append-only/);
  });
});

describe('FR-10 dashboard', () => {
  it('reports totals, outcomes, rates and the top reason codes consistent with the database', async () => {
    const checker = await loginChecker();
    await applicantWith('clean');
    await applicantWith('ravi');
    await applicantWith('orlov');
    const { body } = await get('/api/v1/compliance/dashboard', checker);
    const total = (await pool.query('SELECT count(*)::int AS n FROM applications')).rows[0].n;
    expect(body.total).toBe(total);
    for (const k of ['straight_through_rate', 'review_rate', 'reject_rate', 'top_reasons', 'risk', 'by_status', 'review_time']) expect(body, k).toHaveProperty(k);
    expect(body.top_reasons.length).toBeLessThanOrEqual(5);
    expect(body.rule_decisions.APPROVE + body.rule_decisions.REVIEW + body.rule_decisions.REJECT).toBe(body.rule_decisions.decided);
  });
});

describe('FR-8 plain-language reasons', () => {
  it('every one of the 17 reason codes has a readable message that leaks no score, confidence or list name', () => {
    const codes = Object.values(REASON);
    expect(codes).toHaveLength(17);
    for (const code of codes) {
      const text = REASON_MESSAGE[code];
      expect(text, code).toBeTruthy();
      expect(text.length, code).toBeGreaterThan(20);
      expect(text, code).not.toMatch(/\b0\.\d+\b|sanction|watchlist|PEP|score|confidence/i);
    }
  });
});
