// KYC officer (maker) workflow: queue, split-view data, corrections that re-run the rules, recommendations, concurrency.
import { afterAll, describe, expect, it } from 'vitest';
import { pool } from '../src/db/index.js';
import { api, applicantWith, get, loginChecker, loginOfficer, registerApplicant, send } from './helpers.js';

afterAll(() => pool.end());

const row = async (id) => (await pool.query('SELECT * FROM applications WHERE id = $1', [id])).rows[0];
const fieldUrl = (id, doc, field) => `/api/v1/review/${id}/documents/${doc}/fields/${field}`;

describe('access control', () => {
  it('review APIs: 401 without a token, 403 for applicants, 200 for officers (compliance officers may also act as makers)', async () => {
    const applicant = (await registerApplicant()).token;
    const officer = await loginOfficer();
    const checker = await loginChecker();
    expect((await api.get('/api/v1/review/queue')).status).toBe(401);
    expect((await get('/api/v1/review/queue', applicant)).status).toBe(403);
    expect((await get('/api/v1/review/queue', checker)).status).toBe(200);
    expect((await get('/api/v1/review/queue', officer)).status).toBe(200);
    expect((await send('post', '/api/v1/review/A1/recommend', applicant, {})).status).toBe(403);
    expect((await send('patch', fieldUrl('A1', 'D', 'name'), applicant, {})).status).toBe(403);
  });

  it('officers cannot reach compliance APIs and applicants cannot read audit', async () => {
    const officer = await loginOfficer();
    const a = await applicantWith('ravi');
    expect((await get('/api/v1/compliance/pending', officer)).status).toBe(403);
    expect((await get('/api/v1/compliance/dashboard', officer)).status).toBe(403);
    expect((await get('/api/v1/compliance/config', officer)).status).toBe(403);
    expect((await get(`/api/v1/applications/${a.id}/audit`, a.token)).status).toBe(403);
    expect((await get(`/api/v1/applications/${a.id}/audit/export`, officer)).status).toBe(403);
  });
});

describe('queue (K1)', () => {
  it('lists IN_REVIEW applications by risk (HIGH first) and then oldest first, with the PAN masked', async () => {
    const officer = await loginOfficer();
    const low1 = await applicantWith('ravi');
    const high = await applicantWith('malhotra'); // submitted later but HIGH risk
    const low2 = await applicantWith('iyer');
    const { body } = await get('/api/v1/review/queue', officer);
    expect(body.status).toBe('IN_REVIEW');
    const ids = body.applications.map((a) => a.id);
    expect(ids.indexOf(high.id)).toBeLessThan(ids.indexOf(low1.id));
    expect(ids.indexOf(low1.id)).toBeLessThan(ids.indexOf(low2.id));
    // everything HIGH comes before everything else
    const risks = body.applications.map((a) => a.risk_category === 'HIGH');
    const lastHigh = risks.lastIndexOf(true);
    expect(risks.slice(0, lastHigh + 1).every(Boolean)).toBe(true);
    const mine = body.applications.find((a) => a.id === high.id);
    expect(mine.pan_masked).toBe('ZZZXXXXX1K');
    expect(mine.application_id).toBe(high.id);
    expect(JSON.stringify(body)).not.toContain('ZZZPM3321K');
    expect(mine).not.toHaveProperty('mobile');
  });

  it('rejects an unknown status filter', async () => {
    expect((await get('/api/v1/review/queue?status=BOGUS', await loginOfficer())).status).toBe(400);
  });
});

describe('corrections re-run the rules (K4, FR-6)', () => {
  it('correcting a poorly read PAN clears LOW_EXTRACTION_CONFIDENCE and stores original + new values', async () => {
    const officer = await loginOfficer();
    const a = await applicantWith('iyer');
    const before = await row(a.id);
    expect(before.reason_codes).toEqual(['LOW_EXTRACTION_CONFIDENCE']);

    const res = await send('patch', fieldUrl(a.id, 'D3000025', 'pan_number'), officer, { value: 'zztps9012y', reason: 'Read from the card image', version: before.version });
    expect(res.status).toBe(200);
    expect(res.body.before.reason_codes).toEqual(['LOW_EXTRACTION_CONFIDENCE']);
    expect(res.body.after).toMatchObject({ decision: 'APPROVE', reason_codes: [] });
    expect(res.body.version).toBeGreaterThan(before.version);
    expect(res.body.status).toBe('PENDING_CHECKER');

    const { rows } = await pool.query("SELECT * FROM extracted_fields WHERE application_id = $1 AND doc_id = 'D3000025' AND field = 'pan_number'", [a.id]);
    expect(rows[0]).toMatchObject({ value: 'ZZTPS9012Y', source: 'OFFICER', original_value: 'ZZTP59O12Y' });
    expect(Number(rows[0].confidence)).toBe(1);
    expect(Number(rows[0].original_confidence)).toBe(0.62);

    // a corrected case never skips the checker: the rules say APPROVE, so it waits in PENDING_CHECKER (the officer is the maker)
    const after = await row(a.id);
    expect(after.status).toBe('PENDING_CHECKER');
    expect(after.decision).toBe('APPROVE');
    expect(after.maker_id).not.toBeNull();
    expect(after.core_account_id).toBeNull();

    const audit = await pool.query("SELECT * FROM audit_events WHERE application_id = $1 AND event_type = 'FIELD_CORRECTED'", [a.id]);
    expect(audit.rows).toHaveLength(1);
    expect(audit.rows[0]).toMatchObject({ actor_id: expect.any(Number), role: 'KYC_OFFICER', document_id: 'D3000025' });
    expect(audit.rows[0].old_value).toMatchObject({ field: 'pan_number', value: 'ZZTP59O12Y', confidence: 0.62 });
    expect(audit.rows[0].new_value).toMatchObject({ value: 'ZZTPS9012Y', confidence: 1, source: 'OFFICER' });
    expect(audit.rows[0].details.reason).toBe('Read from the card image');
    const reeval = await pool.query("SELECT old_value, new_value FROM audit_events WHERE application_id = $1 AND event_type = 'EVALUATED' ORDER BY id DESC LIMIT 1", [a.id]);
    expect(reeval.rows[0].old_value.reason_codes).toEqual(['LOW_EXTRACTION_CONFIDENCE']);
    expect(reeval.rows[0].new_value.reason_codes).toEqual([]);
  });

  it('a correction that creates a real mismatch makes the engine say REJECT but the case stays with the officer', async () => {
    const officer = await loginOfficer();
    const a = await applicantWith('ravi');
    const v = (await row(a.id)).version;
    const res = await send('patch', fieldUrl(a.id, 'D3000010', 'pan_number'), officer, { value: 'ZZZPZ9999Z', reason: 'Typed from the document', version: v });
    expect(res.body.after.decision).toBe('REJECT');
    expect(res.body.after.reason_codes).toEqual(['PAN_MISMATCH', 'NAME_MISMATCH_MINOR']); // R6 before R11
    expect((await row(a.id)).status).toBe('IN_REVIEW');
  });

  it('correcting a name raises the similarity to 1.0000, clears the name reason and sends the case to the checker', async () => {
    const officer = await loginOfficer();
    const a = await applicantWith('ravi');
    const v = (await row(a.id)).version;
    const res = await send('patch', fieldUrl(a.id, 'D3000010', 'name'), officer, { value: 'Ravi Kumar Sharma', reason: 'Full name on the card', version: v });
    expect(res.status).toBe(200);
    expect(res.body.after).toMatchObject({ decision: 'APPROVE', name_match_score: 1, reason_codes: [], risk_category: 'LOW' });
    expect(res.body.status).toBe('PENDING_CHECKER');
  });

  it('a correction whose result is still REVIEW leaves the case in the officer queue', async () => {
    const officer = await loginOfficer();
    const a = await applicantWith('ravi');
    const res = await send('patch', fieldUrl(a.id, 'D3000010', 'name'), officer, { value: 'Ravi K Sharma Jr', reason: 'Another reading', version: (await row(a.id)).version });
    expect(res.body.status).toBe('IN_REVIEW');
    expect((await row(a.id)).maker_id).toBeNull();
  });

  it('can correct the document type the extractor chose', async () => {
    const officer = await loginOfficer();
    const a = await applicantWith('ravi');
    const v = (await row(a.id)).version;
    const res = await send('patch', fieldUrl(a.id, 'D3000012', 'doc_type'), officer, { value: 'bank_statement', reason: 'This is a bank statement', version: v });
    expect(res.status).toBe(200);
    expect(res.body.after.reason_codes).toContain('DOCUMENT_TYPE_MISMATCH');
    const d = await pool.query("SELECT classified_type, classification_confidence FROM documents WHERE application_id = $1 AND doc_id = 'D3000012'", [a.id]);
    expect(d.rows[0].classified_type).toBe('BANK_STATEMENT');
    expect(Number(d.rows[0].classification_confidence)).toBe(1);
  });

  it('validates input: reason length, real dates, version, field and document names', async () => {
    const officer = await loginOfficer();
    const a = await applicantWith('ravi');
    const v = (await row(a.id)).version;
    const ok = { value: 'x', reason: 'valid reason', version: v };
    expect((await send('patch', fieldUrl(a.id, 'D3000010', 'name'), officer, { ...ok, reason: 'no' })).status).toBe(400);
    expect((await send('patch', fieldUrl(a.id, 'D3000010', 'name'), officer, { ...ok, value: '' })).status).toBe(400);
    expect((await send('patch', fieldUrl(a.id, 'D3000010', 'name'), officer, { value: 'x', reason: 'valid reason' })).status).toBe(400);
    expect((await send('patch', fieldUrl(a.id, 'D3000010', 'dob'), officer, { ...ok, value: '31/02/1988' })).status).toBe(400);
    expect((await send('patch', fieldUrl(a.id, 'D3000010', 'Bad-Field'), officer, ok)).status).toBe(400);
    expect((await send('patch', fieldUrl(a.id, 'NOPE', 'name'), officer, ok)).status).toBe(404);
    expect((await send('patch', fieldUrl('A0000000', 'D3000010', 'name'), officer, ok)).status).toBe(404);
    expect((await row(a.id)).version).toBe(v); // nothing changed
  });

  it('stores a corrected date in canonical form', async () => {
    const officer = await loginOfficer();
    const a = await applicantWith('ravi');
    const v = (await row(a.id)).version;
    await send('patch', fieldUrl(a.id, 'D3000010', 'dob'), officer, { value: '22 Jul 1988', reason: 'Date misread', version: v });
    const f = await pool.query("SELECT value FROM extracted_fields WHERE application_id = $1 AND doc_id = 'D3000010' AND field = 'dob'", [a.id]);
    expect(f.rows[0].value).toBe('1988-07-22');
  });

  it('refuses corrections once the case is no longer IN_REVIEW (409)', async () => {
    const officer = await loginOfficer();
    const a = await applicantWith('orlov'); // AUTO_REJECTED
    const res = await send('patch', fieldUrl(a.id, 'D3000016', 'name'), officer, { value: 'X Y', reason: 'trying anyway', version: (await row(a.id)).version });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('INVALID_STATE');
  });
});

describe('recommendation (K5, K7)', () => {
  it('needs a comment of at least 10 characters and a valid recommendation', async () => {
    const officer = await loginOfficer();
    const a = await applicantWith('ravi');
    const v = (await row(a.id)).version;
    expect((await send('post', `/api/v1/review/${a.id}/recommend`, officer, { recommendation: 'APPROVE', comment: 'too short', version: v })).status).toBe(400);
    expect((await send('post', `/api/v1/review/${a.id}/recommend`, officer, { recommendation: 'MAYBE', comment: 'a long enough comment', version: v })).status).toBe(400);
    expect((await row(a.id)).status).toBe('IN_REVIEW');
  });

  it('APPROVE and REJECT both go to the checker; the officer cannot finalise anything', async () => {
    const officer = await loginOfficer();
    for (const recommendation of ['APPROVE', 'REJECT']) {
      const a = await applicantWith('ravi');
      const res = await send('post', `/api/v1/review/${a.id}/recommend`, officer, { recommendation, comment: 'Documents checked by hand', version: (await row(a.id)).version });
      expect(res.status).toBe(200);
      const r = await row(a.id);
      expect(r).toMatchObject({ status: 'PENDING_CHECKER', maker_recommendation: recommendation, maker_comment: 'Documents checked by hand' });
      expect(r.maker_id).not.toBeNull();
      expect(r.core_account_id).toBeNull();
      const audit = await pool.query("SELECT role, details FROM audit_events WHERE application_id = $1 AND event_type = 'MAKER_RECOMMENDED'", [a.id]);
      expect(audit.rows[0].role).toBe('KYC_OFFICER');
      expect(audit.rows[0].details.comment).toBe('Documents checked by hand');
    }
  });

  it('REQUEST_RESUBMISSION opens a 7-day window', async () => {
    const officer = await loginOfficer();
    const a = await applicantWith('ravi');
    const t0 = Date.now();
    const res = await send('post', `/api/v1/review/${a.id}/recommend`, officer, { recommendation: 'REQUEST_RESUBMISSION', comment: 'Please send full-name documents', version: (await row(a.id)).version });
    expect(res.status).toBe(200);
    const r = await row(a.id);
    expect(r.status).toBe('RESUBMISSION_REQUESTED');
    const days = (new Date(r.resubmission_deadline).getTime() - t0) / 86400000;
    expect(days).toBeGreaterThan(6.99);
    expect(days).toBeLessThan(7.01);
    const view = (await get(`/api/v1/applications/${a.id}`, a.token)).body.application;
    expect(view).toMatchObject({ status: 'RESUBMISSION_REQUESTED', can_resubmit: true });
    expect(view.resubmission_deadline).toBeTruthy();
  });

  it('only IN_REVIEW applications can be recommended (409 otherwise)', async () => {
    const officer = await loginOfficer();
    const a = await applicantWith('orlov');
    const res = await send('post', `/api/v1/review/${a.id}/recommend`, officer, { recommendation: 'APPROVE', comment: 'trying to override', version: (await row(a.id)).version });
    expect(res.status).toBe(409);
    expect((await row(a.id)).status).toBe('AUTO_REJECTED');
    expect((await send('post', '/api/v1/review/A0000000/recommend', officer, { recommendation: 'APPROVE', comment: 'does not exist', version: 1 })).status).toBe(404);
  });
});

describe('two officers on the same case (HTTP 409)', () => {
  it('the second action on an old version is refused', async () => {
    const officer = await loginOfficer();
    const a = await applicantWith('ravi');
    const v = (await row(a.id)).version;
    const first = await send('patch', fieldUrl(a.id, 'D3000010', 'name'), officer, { value: 'RAVI KUMAR SHARMA', reason: 'First officer fix', version: v });
    expect(first.status).toBe(200);
    const second = await send('patch', fieldUrl(a.id, 'D3000011', 'name'), officer, { value: 'RAVI KUMAR SHARMA', reason: 'Second officer fix', version: v });
    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe('VERSION_CONFLICT');
    expect(second.body.error.details.your_version).toBe(v);
    const stale = await send('post', `/api/v1/review/${a.id}/recommend`, officer, { recommendation: 'APPROVE', comment: 'Based on old version', version: v });
    expect(stale.status).toBe(409);
  });

  it('really simultaneous requests: exactly one wins', async () => {
    const officer = await loginOfficer();
    const a = await applicantWith('ravi');
    const v = (await row(a.id)).version;
    const body = (recommendation) => ({ recommendation, comment: 'Racing recommendation here', version: v });
    const results = await Promise.all([
      send('post', `/api/v1/review/${a.id}/recommend`, officer, body('APPROVE')),
      send('post', `/api/v1/review/${a.id}/recommend`, officer, body('REJECT')),
      send('post', `/api/v1/review/${a.id}/recommend`, officer, body('REQUEST_RESUBMISSION')),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409, 409]);
    const events = await pool.query("SELECT count(*)::int AS n FROM audit_events WHERE application_id = $1 AND event_type = 'MAKER_RECOMMENDED'", [a.id]);
    expect(events.rows[0].n).toBe(1);
  });
});

describe('staff can read the case and the documents (K2, K3, K6)', () => {
  it('officer opens a document: text returned and the view is audited with user, role, document and time', async () => {
    const officer = await loginOfficer();
    const a = await applicantWith('ravi');
    const res = await get(`/api/v1/applications/${a.id}/documents/D3000010/content`, officer);
    expect(res.status).toBe(200);
    expect(res.body.document.content).toContain('RAVI K SHARMA');
    const audit = await pool.query("SELECT actor_id, role, application_id, document_id, created_at FROM audit_events WHERE event_type = 'DOCUMENT_VIEWED' AND application_id = $1", [a.id]);
    expect(audit.rows).toHaveLength(1);
    expect(audit.rows[0]).toMatchObject({ role: 'KYC_OFFICER', document_id: 'D3000010' });
    expect(audit.rows[0].actor_id).not.toBeNull();
  });

  it('the case detail has the rule trace with mismatch values, confidence and watchlist results', async () => {
    const officer = await loginOfficer();
    const a = await applicantWith('ravi');
    const { application } = (await get(`/api/v1/applications/${a.id}`, officer)).body;
    const r11 = application.evaluation.rules.find((r) => r.rule === 'R11');
    expect(r11).toMatchObject({ status: 'TRIGGERED', code: 'NAME_MISMATCH_MINOR', outcome: 'REVIEW' });
    expect(r11.evidence.score).toBe(0.7647);
    expect(application.evaluation.name_scores).toHaveLength(2);
    expect(application.evaluation.watchlist.sanctions.status).toBe('CLEAR');
    expect(application.pan_number).toBe('ZZRPS4521L'); // full PAN in the detail view; masked in lists, logs and exports
    expect(application.version).toBeGreaterThan(0);
  });
});
