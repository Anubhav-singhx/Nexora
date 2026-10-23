// Compliance officer (checker): final decisions, mock account opening, dashboard, configuration, watchlists, re-screen.
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { pool } from '../src/db/index.js';
import { api, applicantWith, get, loginChecker, loginOfficer, registerApplicant, send } from './helpers.js';

afterAll(() => pool.end());

const row = async (id) => (await pool.query('SELECT * FROM applications WHERE id = $1', [id])).rows[0];
const decide = (token, id, body) => send('post', `/api/v1/compliance/${id}/decision`, token, body);

/** An application that the officer recommended and that now waits for the checker. */
async function pendingCase(key = 'ravi', recommendation = 'APPROVE') {
  const officer = await loginOfficer();
  const a = await applicantWith(key);
  const res = await send('post', `/api/v1/review/${a.id}/recommend`, officer, { recommendation, comment: 'Reviewed all documents', version: (await row(a.id)).version });
  if (res.status !== 200) throw new Error(JSON.stringify(res.body));
  return a;
}

describe('pending queue (C1)', () => {
  it('lists PENDING_CHECKER cases, HIGH risk first, with the maker recommendation and a masked PAN', async () => {
    const checker = await loginChecker();
    const normal = await pendingCase('ravi');
    const highSystem = await applicantWith('nair'); // HIGH, clean: waits for the checker without a maker
    const { body } = await get('/api/v1/compliance/pending', checker);
    const ids = body.applications.map((a) => a.id);
    expect(ids).toContain(normal.id);
    expect(ids.indexOf(highSystem.id)).toBeLessThan(ids.indexOf(normal.id));
    const sys = body.applications.find((a) => a.id === highSystem.id);
    expect(sys).toMatchObject({ recommended_by: 'SYSTEM', maker_name: null, risk_category: 'HIGH', pan_masked: 'ZZFXXXXX8H' });
    const rec = body.applications.find((a) => a.id === normal.id);
    expect(rec).toMatchObject({ recommended_by: 'KYC_OFFICER', maker_recommendation: 'APPROVE', maker_comment: 'Reviewed all documents', maker_name: expect.any(String) });
    expect(JSON.stringify(body)).not.toMatch(/ZZRPS4521L|ZZFPK7788H/);
  });
});

describe('final decision (C2, C3, C7)', () => {
  it('APPROVE of a reviewed case opens the mock account and ends in APPROVED', async () => {
    const checker = await loginChecker();
    const a = await pendingCase('ravi');
    const res = await decide(checker, a.id, { decision: 'APPROVE', comment: '', version: (await row(a.id)).version });
    expect(res.status).toBe(200);
    expect(res.body.application).toMatchObject({ status: 'APPROVED', checker_decision: 'APPROVE' });
    expect(res.body.application.core_account_id).toMatch(/^5010\d{8}$/);
    expect(res.body.application.core_customer_id).toMatch(/^CUST\d{8}$/);
    const view = (await get(`/api/v1/applications/${a.id}`, a.token)).body.application;
    expect(view).toMatchObject({ status: 'APPROVED' });
    expect(view.account_id).toBe(res.body.application.core_account_id);
    const types = (await pool.query('SELECT event_type, role FROM audit_events WHERE application_id = $1 ORDER BY id', [a.id])).rows;
    expect(types.find((t) => t.event_type === 'CHECKER_DECIDED').role).toBe('COMPLIANCE_OFFICER');
    expect(types.map((t) => t.event_type)).toContain('CORE_ACCOUNT_CREATED');
  });

  it('a HIGH-risk system case needs a human checker, who can approve it', async () => {
    const checker = await loginChecker();
    const a = await applicantWith('nair');
    expect((await row(a.id)).status).toBe('PENDING_CHECKER');
    const res = await decide(checker, a.id, { decision: 'APPROVE', comment: 'Verified source of funds', version: (await row(a.id)).version });
    expect(res.status).toBe(200);
    expect(res.body.application.status).toBe('APPROVED');
  });

  it('REJECT and SEND_BACK need a comment of at least 10 characters', async () => {
    const checker = await loginChecker();
    const a = await pendingCase('ravi');
    const v = (await row(a.id)).version;
    expect((await decide(checker, a.id, { decision: 'REJECT', comment: 'no', version: v })).status).toBe(400);
    expect((await decide(checker, a.id, { decision: 'SEND_BACK', version: v })).status).toBe(400);
    expect((await decide(checker, a.id, { decision: 'MAYBE', comment: 'long enough comment', version: v })).status).toBe(400);
    expect((await decide(checker, a.id, { decision: 'APPROVE', comment: 'short', version: v })).status).toBe(400);
    expect((await row(a.id)).status).toBe('PENDING_CHECKER');
  });

  it('REJECT ends in REJECTED without an account', async () => {
    const checker = await loginChecker();
    const a = await pendingCase('ravi', 'REJECT');
    const res = await decide(checker, a.id, { decision: 'REJECT', comment: 'Agree, the name does not match', version: (await row(a.id)).version });
    expect(res.status).toBe(200);
    expect(await row(a.id)).toMatchObject({ status: 'REJECTED', core_account_id: null, checker_decision: 'REJECT' });
  });

  it('SEND_BACK returns the case to IN_REVIEW and clears the old recommendation', async () => {
    const checker = await loginChecker();
    const a = await pendingCase('ravi');
    const res = await decide(checker, a.id, { decision: 'SEND_BACK', comment: 'Please check the address proof again', version: (await row(a.id)).version });
    expect(res.status).toBe(200);
    expect(await row(a.id)).toMatchObject({ status: 'IN_REVIEW', maker_id: null, maker_recommendation: null, checker_decision: 'SEND_BACK' });
    // and the officer can recommend again
    const officer = await loginOfficer();
    const again = await send('post', `/api/v1/review/${a.id}/recommend`, officer, { recommendation: 'APPROVE', comment: 'Second look done', version: (await row(a.id)).version });
    expect(again.status).toBe(200);
  });

  it('403 when the checker is the maker of the case (no self approval); nothing changes', async () => {
    const checker = await loginChecker();
    const me = (await get('/api/v1/auth/me', checker)).body.user;
    const a = await pendingCase('ravi');
    await pool.query('UPDATE applications SET maker_id = $1, version = version + 1 WHERE id = $2', [me.id, a.id]);
    const before = await row(a.id);
    const res = await decide(checker, a.id, { decision: 'APPROVE', comment: 'approving my own work', version: before.version });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
    expect(await row(a.id)).toMatchObject({ status: 'PENDING_CHECKER', core_account_id: null, version: before.version });
  });

  it('409 on a stale version, 409 on illegal transitions, 404 for unknown ids, 403 for other roles', async () => {
    const checker = await loginChecker();
    const a = await pendingCase('ravi');
    const v = (await row(a.id)).version;
    expect((await decide(checker, a.id, { decision: 'APPROVE', comment: '', version: v - 1 })).status).toBe(409);
    expect((await decide(await loginOfficer(), a.id, { decision: 'APPROVE', comment: '', version: v })).status).toBe(403);
    expect((await decide(a.token, a.id, { decision: 'APPROVE', comment: '', version: v })).status).toBe(403);
    expect((await decide(checker, 'A0000000', { decision: 'APPROVE', comment: '', version: 1 })).status).toBe(404);
    expect((await decide(checker, a.id, { decision: 'APPROVE', comment: '', version: v })).status).toBe(200);
    // final application gets another action -> illegal transition
    const again = await decide(checker, a.id, { decision: 'REJECT', comment: 'changing my mind later', version: (await row(a.id)).version });
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('INVALID_TRANSITION');
    // an IN_REVIEW case cannot be decided by the checker either
    const inReview = await applicantWith('ravi');
    const r = await decide(checker, inReview.id, { decision: 'APPROVE', comment: '', version: (await row(inReview.id)).version });
    expect(r.status).toBe(409);
    expect((await row(inReview.id)).status).toBe('IN_REVIEW');
  });

  it('two simultaneous decisions: exactly one wins', async () => {
    const checker = await loginChecker();
    const a = await pendingCase('ravi');
    const v = (await row(a.id)).version;
    const rs = await Promise.all([
      decide(checker, a.id, { decision: 'APPROVE', comment: '', version: v }),
      decide(checker, a.id, { decision: 'REJECT', comment: 'Racing rejection here', version: v }),
    ]);
    expect(rs.map((r) => r.status).sort()).toEqual([200, 409]);
    const n = await pool.query("SELECT count(*)::int AS n FROM audit_events WHERE application_id = $1 AND event_type = 'CHECKER_DECIDED'", [a.id]);
    expect(n.rows[0].n).toBe(1);
  });
});

describe('mock core banking (C7)', () => {
  const KEY = 'dev-core-banking-key-change-me';

  it('the account endpoint is protected by the service API key', async () => {
    expect((await api.post('/api/v1/mock-core-banking/accounts').send({ application_id: 'A3000001' })).status).toBe(401);
    expect((await api.post('/api/v1/mock-core-banking/accounts').set('x-api-key', 'wrong').send({ application_id: 'A3000001' })).status).toBe(401);
    const ok = await api.post('/api/v1/mock-core-banking/accounts').set('x-api-key', KEY).send({ application_id: 'A3000001' });
    expect(ok.status).toBe(201);
    expect(ok.body).toMatchObject({ customer_id: 'CUST03000001', account_id: '501003000001', account_type: 'SAVINGS' });
    const again = await api.post('/api/v1/mock-core-banking/accounts').set('x-api-key', KEY).send({ application_id: 'A3000001' });
    expect(again.body.account_id).toBe(ok.body.account_id); // retrying is safe
    expect((await api.post('/api/v1/mock-core-banking/accounts').set('x-api-key', KEY).send({})).status).toBe(400);
  });

  describe('when core banking is down', () => {
    afterEach(() => {
      delete process.env.CORE_BANKING_FAIL;
    });

    it('the checker approval fails cleanly (502), the case stays PENDING_CHECKER, the failure is audited, retry works', async () => {
      const checker = await loginChecker();
      const a = await pendingCase('ravi');
      process.env.CORE_BANKING_FAIL = '1';
      const res = await decide(checker, a.id, { decision: 'APPROVE', comment: '', version: (await row(a.id)).version });
      expect(res.status).toBe(502);
      expect(res.body.error.code).toBe('CORE_BANKING_UNAVAILABLE');
      expect(await row(a.id)).toMatchObject({ status: 'PENDING_CHECKER', core_account_id: null, checker_decision: null });
      const failed = await pool.query("SELECT 1 FROM audit_events WHERE application_id = $1 AND event_type = 'CORE_ACCOUNT_FAILED'", [a.id]);
      expect(failed.rowCount).toBe(1);
      delete process.env.CORE_BANKING_FAIL;
      const retry = await decide(checker, a.id, { decision: 'APPROVE', comment: '', version: (await row(a.id)).version });
      expect(retry.status).toBe(200);
      expect(retry.body.application.status).toBe('APPROVED');
    });

    it('an automatic approval stays approved; the account is opened later with open-account', async () => {
      const checker = await loginChecker();
      process.env.CORE_BANKING_FAIL = '1';
      const a = await applicantWith('clean');
      expect(a.application.status).toBe('AUTO_APPROVED');
      expect(a.application.account_id).toBeNull();
      expect((await row(a.id)).core_account_id).toBeNull();
      expect((await send('post', `/api/v1/compliance/${a.id}/open-account`, checker, {})).status).toBe(502);
      delete process.env.CORE_BANKING_FAIL;
      const ok = await send('post', `/api/v1/compliance/${a.id}/open-account`, checker, {});
      expect(ok.status).toBe(200);
      expect(ok.body.application.core_account_id).toMatch(/^5010/);
      // idempotent
      const again = await send('post', `/api/v1/compliance/${a.id}/open-account`, checker, {});
      expect(again.body.application.core_account_id).toBe(ok.body.application.core_account_id);
    });
  });

  it('open-account refuses applications that were not approved', async () => {
    const a = await applicantWith('ravi');
    const res = await send('post', `/api/v1/compliance/${a.id}/open-account`, await loginChecker(), {});
    expect(res.status).toBe(409);
  });
});

describe('dashboard (FR-10, C4)', () => {
  const sum = (o) => Object.values(o).reduce((x, y) => x + y, 0);

  it('every number equals what the database holds', async () => {
    const checker = await loginChecker();
    await applicantWith('clean');
    await applicantWith('orlov');
    await pendingCase('ravi');
    const { body } = await get('/api/v1/compliance/dashboard', checker);

    const total = (await pool.query('SELECT count(*)::int AS n FROM applications')).rows[0].n;
    expect(body.total).toBe(total);
    expect(sum(body.by_status)).toBe(total);
    for (const s of Object.keys(body.by_status)) {
      const n = (await pool.query('SELECT count(*)::int AS n FROM applications WHERE status = $1', [s])).rows[0].n;
      expect(body.by_status[s], s).toBe(n);
    }
    const decided = (await pool.query('SELECT count(*)::int AS n FROM applications WHERE decision IS NOT NULL')).rows[0].n;
    expect(body.rule_decisions.decided).toBe(decided);
    expect(body.rule_decisions.APPROVE + body.rule_decisions.REVIEW + body.rule_decisions.REJECT).toBe(decided);
    expect(body.final_outcomes.approved).toBe(body.by_status.APPROVED + body.by_status.AUTO_APPROVED);
    expect(body.final_outcomes.rejected).toBe(body.by_status.REJECTED + body.by_status.AUTO_REJECTED);
    expect(body.final_outcomes.approved + body.final_outcomes.rejected + body.final_outcomes.closed_expired + body.final_outcomes.in_progress).toBe(total);
    expect(body.pending_checker).toBe(body.by_status.PENDING_CHECKER);

    const top = (await pool.query('SELECT code, count(*)::int AS n FROM applications, unnest(reason_codes) code GROUP BY code ORDER BY n DESC, code LIMIT 5')).rows;
    expect(body.top_reasons).toEqual(top);
    expect(body.top_reasons.map((r) => r.code)).toContain('NAME_MISMATCH_MINOR');
    expect(body.risk.LOW + body.risk.MEDIUM + body.risk.HIGH).toBe((await pool.query('SELECT count(*)::int AS n FROM applications WHERE risk_category IS NOT NULL')).rows[0].n);
    expect(body.daily.reduce((n, d) => n + d.submitted, 0)).toBe(total);
    expect(body.straight_through_rate).toBeCloseTo(body.by_status.AUTO_APPROVED / decided, 3);
    expect(body.review_rate).toBeCloseTo(body.rule_decisions.REVIEW / decided, 3);
    expect(body.reject_rate).toBeCloseTo(body.rule_decisions.REJECT / decided, 3);
    expect(body.definitions.final_outcomes).toBeTruthy();
  });

  it('date filtering works on IST calendar dates', async () => {
    const checker = await loginChecker();
    const all = (await get('/api/v1/compliance/dashboard', checker)).body;
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
    const same = (await get(`/api/v1/compliance/dashboard?from=${today}&to=${today}`, checker)).body;
    expect(same.total).toBe(all.total);
    expect(same.range).toEqual({ from: today, to: today });
    const past = (await get('/api/v1/compliance/dashboard?from=2020-01-01&to=2020-12-31', checker)).body;
    expect(past.total).toBe(0);
    expect(past.top_reasons).toEqual([]);
    expect(past.review_time.avg_hours).toBeNull();
    // move one application to an earlier day and check the split
    const a = await applicantWith('clean');
    await pool.query("UPDATE applications SET submitted_at = '2025-06-15 10:00:00+05:30' WHERE id = $1", [a.id]);
    const june = (await get('/api/v1/compliance/dashboard?from=2025-06-15&to=2025-06-15', checker)).body;
    expect(june.total).toBe(1);
    expect(june.by_status.AUTO_APPROVED).toBe(1);
    expect(june.daily).toEqual([{ day: '2025-06-15', submitted: 1, approved: 1, rejected: 0 }]);
    expect((await get('/api/v1/compliance/dashboard?from=2025-06-16', checker)).body.total).toBe(all.total + 1 - 1);
  });

  it('rejects an impossible range', async () => {
    const checker = await loginChecker();
    expect((await get('/api/v1/compliance/dashboard?from=2026-02-01&to=2026-01-01', checker)).status).toBe(400);
    expect((await get('/api/v1/compliance/dashboard?from=2026-02-31', checker)).status).toBe(400);
    expect((await get('/api/v1/compliance/dashboard?from=yesterday', checker)).status).toBe(400);
  });

  it('time in review comes from the audit trail (entered -> left IN_REVIEW)', async () => {
    const checker = await loginChecker();
    const a = await pendingCase('ravi');
    // make the review look like it took 3 hours
    await pool.query("UPDATE applications SET submitted_at = submitted_at WHERE id = $1", [a.id]);
    const { body } = await get('/api/v1/compliance/dashboard', checker);
    expect(body.review_time.completed_reviews).toBeGreaterThan(0);
    expect(body.review_time.avg_hours).toBeGreaterThanOrEqual(0);
    const direct = await pool.query(
      `SELECT count(*)::int AS n FROM audit_events e WHERE e.event_type = 'STATUS_CHANGED' AND e.new_value->>'status' = 'IN_REVIEW'
         AND EXISTS (SELECT 1 FROM audit_events x WHERE x.application_id = e.application_id AND x.event_type = 'STATUS_CHANGED' AND x.old_value->>'status' = 'IN_REVIEW' AND x.id > e.id)`,
    );
    expect(body.review_time.completed_reviews).toBe(direct.rows[0].n);
  });
});

describe('rule configuration changes decisions without a code change (C6)', () => {
  afterEach(async () => {
    await send('patch', '/api/v1/compliance/config', await loginChecker(), { changes: { name_reject_threshold: 0.75, name_match_threshold: 0.9, min_field_confidence: 0.8 } });
  });

  it('lists every key with its default and version', async () => {
    const { body } = await get('/api/v1/compliance/config', await loginChecker());
    const keys = body.config.map((c) => c.key);
    expect(keys).toEqual(expect.arrayContaining(['min_field_confidence', 'name_reject_threshold', 'name_match_threshold', 'watchlist_match_threshold', 'watchlist_possible_threshold', 'min_age', 'pan_pattern', 'address_proof_max_age_days', 'medium_income_threshold', 'rekyc_years', 'required_fields']));
    expect(body.config.find((c) => c.key === 'name_reject_threshold')).toMatchObject({ value: 0.75, default: 0.75 });
  });

  it('a raised reject threshold turns the 0.7647 case into an automatic rejection; restoring brings the review back', async () => {
    const checker = await loginChecker();
    const patch = await send('patch', '/api/v1/compliance/config', checker, { changes: { name_reject_threshold: 0.8 } });
    expect(patch.status).toBe(200);
    expect(patch.body.config.find((c) => c.key === 'name_reject_threshold')).toMatchObject({ value: 0.8, version: expect.any(Number) });
    const rejected = await applicantWith('ravi');
    expect(await row(rejected.id)).toMatchObject({ status: 'AUTO_REJECTED' });
    expect((await row(rejected.id)).reason_codes).toEqual(['NAME_MISMATCH']);
    await send('patch', '/api/v1/compliance/config', checker, { changes: { name_reject_threshold: 0.75 } });
    expect((await row((await applicantWith('ravi')).id)).status).toBe('IN_REVIEW');
    const audit = await pool.query("SELECT old_value, new_value, role FROM audit_events WHERE event_type = 'CONFIG_UPDATED' AND entity_id = 'name_reject_threshold' ORDER BY id DESC LIMIT 2");
    expect(audit.rows[0].role).toBe('COMPLIANCE_OFFICER');
    expect(audit.rows[1].new_value.value).toBe(0.8);
    expect(audit.rows[1].old_value.value).toBe(0.75);
  });

  it('FR-4: lowering name_match_threshold below 0.7647 turns example 4 from REVIEW into an approval, with no code change', async () => {
    const checker = await loginChecker();
    expect((await row((await applicantWith('ravi')).id)).status).toBe('IN_REVIEW');
    expect((await send('patch', '/api/v1/compliance/config', checker, { changes: { name_match_threshold: 0.76 } })).status).toBe(200);
    const after = await row((await applicantWith('ravi')).id);
    expect(after).toMatchObject({ decision: 'APPROVE', status: 'AUTO_APPROVED' });
    expect(after.reason_codes).toEqual([]);
  });

  it('validates keys and values, and refuses inconsistent thresholds', async () => {
    const checker = await loginChecker();
    const bad = async (changes) => (await send('patch', '/api/v1/compliance/config', checker, { changes })).status;
    expect(await bad({ nonsense: 1 })).toBe(400);
    expect(await bad({ min_field_confidence: 5 })).toBe(400);
    expect(await bad({ min_field_confidence: 'high' })).toBe(400);
    expect(await bad({ name_score_aggregation: 'avg' })).toBe(400);
    expect(await bad({ rekyc_years: { HIGH: 2 } })).toBe(400);
    expect(await bad({ name_reject_threshold: 0.95 })).toBe(400); // above name_match_threshold (0.9)
    expect((await send('patch', '/api/v1/compliance/config', checker, {})).status).toBe(400);
    expect((await send('patch', '/api/v1/compliance/config', checker, { changes: [] })).status).toBe(400);
    expect((await get('/api/v1/compliance/config', checker)).body.config.find((c) => c.key === 'name_reject_threshold').value).toBe(0.75);
  });
});

describe('watchlist maintenance and re-screening (C6)', () => {
  it('a new sanctions entry affects the next application; deleting it restores the old outcome', async () => {
    const checker = await loginChecker();
    const created = await send('post', '/api/v1/compliance/watchlists', checker, { list: 'sanctions', name: 'Tanya Sethi', aliases: ['T Sethi'], dob: '1991-04-09', nationality: 'IN', program: 'TEST' });
    expect(created.status).toBe(201);
    expect(created.body.entry.list_id).toMatch(/^SAN\d{4}$/);
    expect(created.body.rescreen_recommended).toBe(true);
    const blocked = await applicantWith('iyer');
    expect((await row(blocked.id)).reason_codes).toContain('SANCTIONS_MATCH');
    expect((await row(blocked.id)).status).toBe('AUTO_REJECTED');
    const del = await send('delete', `/api/v1/compliance/watchlists/sanctions/${created.body.entry.id}`, checker);
    expect(del.status).toBe(200);
    expect((await row((await applicantWith('iyer')).id)).status).toBe('IN_REVIEW');
    const audit = await pool.query("SELECT details FROM audit_events WHERE event_type = 'WATCHLIST_UPDATED' AND entity_id LIKE 'sanctions/%' ORDER BY id DESC LIMIT 2");
    expect(audit.rows.map((r) => r.details.action)).toEqual(['DELETE', 'CREATE']);
  });

  it('lists, searches and updates entries, and validates input', async () => {
    const checker = await loginChecker();
    const list = await get('/api/v1/compliance/watchlists?list=sanctions', checker);
    expect(list.body.count).toBeGreaterThanOrEqual(5);
    const q = await get('/api/v1/compliance/watchlists?list=sanctions&q=dravik', checker);
    expect(q.body.entries.map((e) => e.list_id)).toEqual(['SAN0001']); // found through the alias
    const pep = await get('/api/v1/compliance/watchlists?list=pep', checker);
    expect(pep.body.entries[0]).toHaveProperty('position');
    expect((await get('/api/v1/compliance/watchlists?list=bogus', checker)).status).toBe(400);
    expect((await send('post', '/api/v1/compliance/watchlists', checker, { list: 'pep', name: 'x' })).status).toBe(400);
    expect((await send('post', '/api/v1/compliance/watchlists', checker, { list: 'pep', name: 'Valid Name', dob: '1990-02-31' })).status).toBe(400);
    const made = await send('post', '/api/v1/compliance/watchlists', checker, { list: 'pep', name: 'Temp Official', position: 'Mayor', category: 'LOCAL' });
    const upd = await send('patch', `/api/v1/compliance/watchlists/pep/${made.body.entry.id}`, checker, { position: 'Deputy Mayor' });
    expect(upd.body.entry.position).toBe('Deputy Mayor');
    const withAlias = await send('post', '/api/v1/compliance/watchlists', checker, { list: 'pep', name: 'Alias Holder', aliases: ['A Holder'] });
    const keep = await send('patch', `/api/v1/compliance/watchlists/pep/${withAlias.body.entry.id}`, checker, { position: 'Clerk' });
    expect(keep.body.entry.aliases).toEqual(['A Holder']); // fields that were not sent stay as they were
    await send('delete', `/api/v1/compliance/watchlists/pep/${withAlias.body.entry.id}`, checker);
    expect((await send('patch', '/api/v1/compliance/watchlists/pep/999999', checker, { position: 'x' })).status).toBe(404);
    expect((await send('patch', `/api/v1/compliance/watchlists/pep/${made.body.entry.id}`, checker, {})).status).toBe(400);
    await send('delete', `/api/v1/compliance/watchlists/pep/${made.body.entry.id}`, checker);
    expect((await send('delete', `/api/v1/compliance/watchlists/pep/${made.body.entry.id}`, checker)).status).toBe(404);
    expect((await send('post', '/api/v1/compliance/watchlists', await loginOfficer(), { list: 'pep', name: 'Not Allowed' })).status).toBe(403);
  });

  it('re-screen: a case waiting for the checker that now has a possible sanctions hit goes back to review', async () => {
    const checker = await loginChecker();
    const a = await pendingCase('ravi'); // officer recommended approval of a name-discrepancy case
    const untouched = await pendingCase('malhotra');
    expect((await row(a.id)).status).toBe('PENDING_CHECKER');
    const entry = await send('post', '/api/v1/compliance/watchlists', checker, { list: 'sanctions', name: 'Ravi Kumar Sharma', dob: '1980-01-01', program: 'TEST' });
    const res = await send('post', '/api/v1/compliance/rescreen', checker, {});
    expect(res.status).toBe(200);
    const mine = res.body.changed.find((c) => c.application_id === a.id);
    expect(mine).toMatchObject({ status: 'IN_REVIEW', after: { reason_codes: ['NAME_MISMATCH_MINOR', 'SANCTIONS_POSSIBLE_MATCH'], risk_category: 'HIGH' } });
    expect(res.body.changed.find((c) => c.application_id === untouched.id)).toBeUndefined();
    expect(await row(a.id)).toMatchObject({ status: 'IN_REVIEW', maker_id: null });
    expect((await row(untouched.id)).status).toBe('PENDING_CHECKER');
    const events = await pool.query("SELECT event_type FROM audit_events WHERE entity_id = 'rescreen' ORDER BY id");
    expect(events.rows.map((e) => e.event_type)).toContain('RESCREEN_RUN');
    // clean up and re-screen again: the possible hit disappears
    await send('delete', `/api/v1/compliance/watchlists/sanctions/${entry.body.entry.id}`, checker);
    const back = await send('post', '/api/v1/compliance/rescreen', checker, {});
    expect(back.body.changed.find((c) => c.application_id === a.id).after.reason_codes).toEqual(['NAME_MISMATCH_MINOR']);
  });

  it('re-screen leaves unchanged cases (and their versions) alone', async () => {
    const checker = await loginChecker();
    const a = await applicantWith('ravi');
    const v = (await row(a.id)).version;
    await send('post', '/api/v1/compliance/rescreen', checker, { application_ids: [a.id] });
    expect((await row(a.id)).version).toBe(v);
    expect((await send('post', '/api/v1/compliance/rescreen', await loginOfficer(), {})).status).toBe(403);
  });
});

describe('audit trail (FR-9, C5)', () => {
  it('shows every action on an application in order, with who did it', async () => {
    const checker = await loginChecker();
    const officer = await loginOfficer();
    const a = await pendingCase('ravi');
    await get(`/api/v1/applications/${a.id}/documents/D3000010/content`, officer);
    await decide(checker, a.id, { decision: 'APPROVE', comment: '', version: (await row(a.id)).version });
    const { body } = await get(`/api/v1/applications/${a.id}/audit`, checker);
    const types = body.events.map((e) => e.event_type);
    for (const t of ['APPLICATION_CREATED', 'DOCUMENT_UPLOADED', 'DOCUMENT_EXTRACTED', 'EVALUATED', 'MAKER_RECOMMENDED', 'DOCUMENT_VIEWED', 'CHECKER_DECIDED', 'CORE_ACCOUNT_CREATED']) expect(types).toContain(t);
    expect(body.events.map((e) => e.id)).toEqual([...body.events.map((e) => e.id)].sort((x, y) => x - y));
    expect(body.events.find((e) => e.event_type === 'MAKER_RECOMMENDED').actor).toMatchObject({ role: 'KYC_OFFICER', name: 'Demo KYC Officer' });
    expect(body.events.find((e) => e.event_type === 'DOCUMENT_VIEWED').document_id).toBe('D3000010');
    // an officer may read the audit of a case too
    expect((await get(`/api/v1/applications/${a.id}/audit`, officer)).status).toBe(200);
  });

  it('masks PANs in the API response, in corrections and in the CSV export; the export is itself audited', async () => {
    const checker = await loginChecker();
    const officer = await loginOfficer();
    const a = await applicantWith('iyer');
    const corr = await send('patch', `/api/v1/review/${a.id}/documents/D3000025/fields/pan_number`, officer, { value: 'ZZTPS9012Y', reason: 'Read from the card', version: (await row(a.id)).version });
    expect(corr.status, JSON.stringify(corr.body)).toBe(200);
    const json = await get(`/api/v1/applications/${a.id}/audit`, checker);
    expect(JSON.stringify(json.body)).not.toMatch(/ZZTPS9012Y|ZZTP59O12Y/);
    const fix = json.body.events.find((e) => e.event_type === 'FIELD_CORRECTED');
    expect(fix.new_value.value).toBe('ZZTXXXXX2Y');
    const csv = await get(`/api/v1/applications/${a.id}/audit/export`, checker);
    expect(csv.status).toBe(200);
    expect(csv.headers['content-type']).toMatch(/text\/csv/);
    expect(csv.headers['content-disposition']).toContain(`audit_${a.id}.csv`);
    const lines = csv.text.trim().split('\n');
    expect(lines[0]).toBe('id,timestamp,application_id,document_id,actor_id,actor_role,event_type,entity_type,entity_id,old_value,new_value,details');
    expect(csv.text).not.toMatch(/ZZTPS9012Y|ZZTP59O12Y/);
    expect(lines.length).toBe(json.body.events.length + 1);
    const logged = await pool.query("SELECT 1 FROM audit_events WHERE application_id = $1 AND event_type = 'AUDIT_EXPORTED'", [a.id]);
    expect(logged.rowCount).toBe(1);
  });

  it('cannot be modified or deleted, even by direct SQL (database trigger)', async () => {
    await expect(pool.query("UPDATE audit_events SET details = '{}'::jsonb")).rejects.toThrow(/append-only/);
    await expect(pool.query('DELETE FROM audit_events WHERE id > 0')).rejects.toThrow(/append-only/);
  });

  it('search filters by application, event type, actor role and date', async () => {
    const checker = await loginChecker();
    const a = await pendingCase('ravi');
    const byApp = await get(`/api/v1/compliance/audit?application_id=${a.id}`, checker);
    expect(byApp.body.events.length).toBeGreaterThan(5);
    expect(byApp.body.events.every((e) => e.application_id === a.id)).toBe(true);
    const byType = await get(`/api/v1/compliance/audit?application_id=${a.id}&event_type=MAKER_RECOMMENDED`, checker);
    expect(byType.body.events).toHaveLength(1);
    const bySystem = await get(`/api/v1/compliance/audit?application_id=${a.id}&actor_role=SYSTEM`, checker);
    expect(bySystem.body.events.every((e) => e.actor.role === 'SYSTEM')).toBe(true);
    expect((await get('/api/v1/compliance/audit?from=2020-01-01&to=2020-01-02', checker)).body.events).toEqual([]);
    expect((await get('/api/v1/compliance/audit?actor_role=HACKER', checker)).status).toBe(400);
    expect((await get('/api/v1/compliance/audit?limit=2', checker)).body.events).toHaveLength(2);
    expect((await get('/api/v1/compliance/audit', await loginOfficer())).status).toBe(403);
  });

  it('applicants cannot read another person\'s audit or any audit at all', async () => {
    const a = await applicantWith('ravi');
    const b = await registerApplicant();
    expect((await get(`/api/v1/applications/${a.id}/audit`, b.token)).status).toBe(403);
    expect((await get(`/api/v1/applications/${a.id}/audit`, a.token)).status).toBe(403);
  });
});
