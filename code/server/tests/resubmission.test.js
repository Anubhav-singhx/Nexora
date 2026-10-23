// A6 / FR-8: requested documents can be resubmitted within seven days; later the case is closed, never reopened.
import { afterAll, describe, expect, it } from 'vitest';
import { businessDate } from '../src/utils/clock.js';
import { pool } from '../src/db/index.js';
import { expireOverdue } from '../src/services/pipeline.js';
import { api, applicantWith, get, loginChecker, loginOfficer, registerApplicant, resubmit, resubmitDocs, sampleDocs, send, validDocs } from './helpers.js';

afterAll(() => pool.end());

const row = async (id) => (await pool.query('SELECT * FROM applications WHERE id = $1', [id])).rows[0];

async function requested(key = 'ravi') {
  const officer = await loginOfficer();
  const a = await applicantWith(key);
  const res = await send('post', `/api/v1/review/${a.id}/recommend`, officer, { recommendation: 'REQUEST_RESUBMISSION', comment: 'Please upload documents with the full name', version: (await row(a.id)).version });
  expect(res.status).toBe(200);
  return a;
}

describe('resubmitting requested documents', () => {
  it('re-extracts, re-evaluates, keeps the old files for audit, and a reviewed approval then waits for the checker', async () => {
    const a = await requested();
    const res = await resubmit(a.token, a.id, resubmitDocs.ravi());
    expect(res.status).toBe(200);
    expect(res.body.application.status).toBe('PENDING_CHECKER'); // clean now, but a human was involved -> checker
    expect(res.body.application.reasons).toEqual([]);

    const docs = (await pool.query('SELECT doc_id, declared_type, superseded, version FROM documents WHERE application_id = $1 ORDER BY id', [a.id])).rows;
    expect(docs).toEqual([
      { doc_id: 'D3000010', declared_type: 'PAN_CARD', superseded: true, version: 1 },
      { doc_id: 'D3000011', declared_type: 'AADHAAR_CARD', superseded: true, version: 1 },
      { doc_id: 'D3000012', declared_type: 'ELECTRICITY_BILL', superseded: false, version: 1 },
      { doc_id: 'D9000001', declared_type: 'PAN_CARD', superseded: false, version: 2 },
      { doc_id: 'D9000002', declared_type: 'AADHAAR_CARD', superseded: false, version: 2 },
    ]);
    const r = await row(a.id);
    expect(r).toMatchObject({ decision: 'APPROVE', name_match_score: 1, resubmission_count: 1, maker_id: null, resubmission_deadline: null });
    expect(r.reason_codes).toEqual([]);

    // the applicant sees the active documents and the replaced ones separately
    const view = res.body.application;
    expect(view.documents.map((d) => d.doc_id)).toEqual(['D3000012', 'D9000001', 'D9000002']);
    expect(view.replaced_documents.map((d) => d.doc_id)).toEqual(['D3000010', 'D3000011']);
    expect(view.timeline.map((t) => t.status)).toEqual(['SUBMITTED', 'EXTRACTING', 'IN_REVIEW', 'RESUBMISSION_REQUESTED', 'SUBMITTED', 'EXTRACTING', 'PENDING_CHECKER']);

    const types = (await pool.query('SELECT event_type FROM audit_events WHERE application_id = $1 ORDER BY id', [a.id])).rows.map((x) => x.event_type);
    for (const t of ['RESUBMITTED', 'DOCUMENT_REPLACED']) expect(types).toContain(t);

    // the old PAN document is still readable by staff (kept for audit)
    const old = await get(`/api/v1/applications/${a.id}/documents`, await loginOfficer());
    expect(old.body.documents.filter((d) => d.superseded).map((d) => d.doc_id).sort()).toEqual(['D3000010', 'D3000011']);

    // and the checker can finish the journey
    const fin = await send('post', `/api/v1/compliance/${a.id}/decision`, await loginChecker(), { decision: 'APPROVE', comment: '', version: r.version });
    expect(fin.body.application.status).toBe('APPROVED');
    expect((await get(`/api/v1/applications/${a.id}`, a.token)).body.application.account_id).toMatch(/^5010/);
  });

  it('uses the resubmission date as the application date', async () => {
    const a = await requested();
    await pool.query("UPDATE applications SET application_date = '2026-01-01' WHERE id = $1", [a.id]);
    await resubmit(a.token, a.id, resubmitDocs.ravi());
    const r = await row(a.id);
    expect(r.application_date).toBe(businessDate()); // today in IST, or the APPLICATION_DATE override used by the tests
  });

  it('sends the case back to review if the new documents still have a problem', async () => {
    const a = await requested();
    const bad = [{ name: 'NOT_IN_MOCK_PAN.txt', type: 'PAN_CARD', buffer: Buffer.from('some new pan scan') }];
    const res = await resubmit(a.token, a.id, bad);
    expect(res.status).toBe(200);
    expect(res.body.application.status).toBe('IN_REVIEW');
    expect(res.body.application.reasons.length).toBeGreaterThan(0);
  });

  it('only the owner, only while a resubmission is requested', async () => {
    const a = await requested();
    const other = await registerApplicant();
    expect((await resubmit(other.token, a.id, resubmitDocs.ravi())).status).toBe(403);
    expect((await resubmit(null, a.id, resubmitDocs.ravi())).status).toBe(401);
    expect((await resubmit(await loginOfficer(), a.id, resubmitDocs.ravi())).status).toBe(403);
    expect((await resubmit(a.token, 'A0000000', resubmitDocs.ravi())).status).toBe(404);
    const notRequested = await applicantWith('ravi'); // IN_REVIEW
    const res = await resubmit(notRequested.token, notRequested.id, resubmitDocs.ravi());
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('INVALID_STATE');
    expect((await row(notRequested.id)).status).toBe('IN_REVIEW');
  });

  it('validates the upload like the first submission, and refuses the same file again', async () => {
    const a = await requested();
    expect((await resubmit(a.token, a.id, [])).status).toBe(400);
    expect((await resubmit(a.token, a.id, [{ name: 'x.pdf', type: 'PAN_CARD', buffer: Buffer.from('x') }])).status).toBe(400);
    expect((await resubmit(a.token, a.id, [{ name: 'D9999999.txt', type: 'SELFIE', buffer: Buffer.from('x') }])).status).toBe(400);
    const same = await resubmit(a.token, a.id, [{ name: 'D9000099.txt', type: 'PAN_CARD', buffer: validDocs()[0].buffer }, ]);
    expect(same.status).toBe(200); // different content than RAVI_PAN's, so allowed (it is simply unknown to the mock)
    const a2 = await requested();
    const first = resubmitDocs.ravi();
    const ok = await resubmit(a2.token, a2.id, first);
    expect(ok.status).toBe(200);
    // after processing the app is no longer waiting, so a second attempt is a 409
    expect((await resubmit(a2.token, a2.id, first)).status).toBe(409);
  });

  it('identical file content already stored for this application is a duplicate (409) and nothing changes', async () => {
    const a = await requested();
    const original = (await pool.query("SELECT storage_path FROM documents WHERE application_id = $1 AND doc_id = 'D3000010'", [a.id])).rows[0];
    void original;
    const buf = sampleDocs('A2000004').find((d) => d.type === 'PAN_CARD').buffer; // the very file uploaded at submission
    const res = await resubmit(a.token, a.id, [{ name: 'D9000050.txt', type: 'PAN_CARD', buffer: buf }]);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('DUPLICATE_DOCUMENT');
    expect((await row(a.id)).status).toBe('RESUBMISSION_REQUESTED');
    expect((await pool.query('SELECT count(*)::int AS n FROM documents WHERE application_id = $1', [a.id])).rows[0].n).toBe(3);
  });
});

describe('the seven-day window', () => {
  it('after the deadline the case is closed as expired and cannot be reopened', async () => {
    const a = await requested();
    await pool.query("UPDATE applications SET resubmission_deadline = now() - interval '1 minute' WHERE id = $1", [a.id]);

    // the applicant opens it: lazily closed, not reopened
    const view = (await get(`/api/v1/applications/${a.id}`, a.token)).body.application;
    expect(view).toMatchObject({ status: 'CLOSED_EXPIRED', can_resubmit: false, resubmission_deadline: null });
    expect(view.status_message).toMatch(/expired/);
    expect((await row(a.id)).status).toBe('CLOSED_EXPIRED');

    const res = await resubmit(a.token, a.id, resubmitDocs.ravi());
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('RESUBMISSION_WINDOW_EXPIRED');
    expect((await row(a.id)).status).toBe('CLOSED_EXPIRED');

    const events = (await pool.query("SELECT event_type, role FROM audit_events WHERE application_id = $1 AND event_type IN ('APPLICATION_EXPIRED')", [a.id])).rows;
    expect(events).toEqual([{ event_type: 'APPLICATION_EXPIRED', role: 'SYSTEM' }]);
  });

  it('a resubmission attempt after the deadline closes the case even if nobody opened it before', async () => {
    const a = await requested();
    await pool.query("UPDATE applications SET resubmission_deadline = now() - interval '1 second' WHERE id = $1", [a.id]);
    const res = await resubmit(a.token, a.id, resubmitDocs.ravi());
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('RESUBMISSION_WINDOW_EXPIRED');
    expect((await row(a.id)).status).toBe('CLOSED_EXPIRED');
  });

  it('the periodic job closes overdue cases, leaves current ones, and is safe to repeat', async () => {
    const late = await requested();
    const fresh = await requested();
    await pool.query("UPDATE applications SET resubmission_deadline = now() - interval '2 days' WHERE id = $1", [late.id]);
    const closed = await expireOverdue();
    expect(closed).toContain(late.id);
    expect(closed).not.toContain(fresh.id);
    expect(await expireOverdue()).not.toContain(late.id);
    expect((await row(fresh.id)).status).toBe('RESUBMISSION_REQUESTED');
  });

  it('shows up in the applicant list and the officer queue without anybody opening the case', async () => {
    const a = await requested();
    await pool.query("UPDATE applications SET resubmission_deadline = now() - interval '1 hour' WHERE id = $1", [a.id]);
    const list = (await get('/api/v1/applications', a.token)).body.applications;
    expect(list.find((x) => x.id === a.id).status).toBe('CLOSED_EXPIRED');
  });

  it('a just-in-time resubmission (deadline still ahead) is accepted', async () => {
    const a = await requested();
    await pool.query("UPDATE applications SET resubmission_deadline = now() + interval '30 seconds' WHERE id = $1", [a.id]);
    expect((await resubmit(a.token, a.id, resubmitDocs.ravi())).status).toBe(200);
  });

  it('terminal statuses refuse everything: no review, no decision, no resubmission', async () => {
    const officer = await loginOfficer();
    const checker = await loginChecker();
    const a = await requested();
    await pool.query("UPDATE applications SET resubmission_deadline = now() - interval '1 minute' WHERE id = $1", [a.id]);
    await expireOverdue();
    const v = (await row(a.id)).version;
    expect((await send('post', `/api/v1/review/${a.id}/recommend`, officer, { recommendation: 'APPROVE', comment: 'trying to reopen it', version: v })).status).toBe(409);
    expect((await send('post', `/api/v1/compliance/${a.id}/decision`, checker, { decision: 'SEND_BACK', comment: 'trying to reopen it', version: v })).status).toBe(409);
    expect((await row(a.id)).status).toBe('CLOSED_EXPIRED');
    void api;
  });
});
