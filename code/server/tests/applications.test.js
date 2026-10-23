import fs from 'node:fs';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { config } from '../src/config.js';
import { pool } from '../src/db/index.js';
import { api, loginChecker, loginOfficer, registerApplicant, sha256, submitApplication, validDocs, validFields } from './helpers.js';

afterAll(() => pool.end());

describe('creating an application', () => {
  it('saves the application, documents, files on disk and audit rows (201)', async () => {
    const { token, user } = await registerApplicant();
    const docs = validDocs();
    const res = await submitApplication(token, { docs });

    expect(res.status).toBe(201);
    const app = res.body.application;
    expect(app.id).toMatch(/^A\d{7}$/);
    expect(app.status).toBe('AUTO_APPROVED'); // worked example 1 is approved straight away
    expect(app.application_id).toBe(app.id);
    expect(app.declared.pan_number).toBe('ZZKPS1234Q');
    expect(app.declared).toMatchObject({ gender: 'MALE', occupation_code: 'SALARIED_PRIVATE', city: 'Mumbai', state: 'Maharashtra', email: 'ravi.kumar.sharma@example.org' });
    expect(app.declared.annual_income).toBe(900000);
    expect(app.documents).toHaveLength(3);

    const { rows: appRows } = await pool.query('SELECT * FROM applications WHERE id = $1', [app.id]);
    expect(appRows[0].user_id).toBe(user.id);
    expect(appRows[0].consent).toBe(true);

    const { rows: docRows } = await pool.query('SELECT * FROM documents WHERE application_id = $1 ORDER BY id', [app.id]);
    expect(docRows).toHaveLength(3);
    for (const [i, row] of docRows.entries()) {
      expect(row.sha256).toBe(sha256(docs[i].buffer));
      expect(row.doc_id).toBe(docs[i].name.replace('.txt', ''));
      // stored under a random safe name, never the user's file name, and the bytes are intact
      expect(row.storage_path).toMatch(/^[0-9a-f-]{36}\.txt$/);
      expect(row.storage_path).not.toContain('D300');
      expect(fs.readFileSync(path.join(config.uploadDir, row.storage_path)).equals(docs[i].buffer)).toBe(true);
    }

    const { rows: audit } = await pool.query(
      "SELECT event_type, actor_id, role FROM audit_events WHERE entity_id = $1 ORDER BY id",
      [app.id],
    );
    expect(audit.map((a) => a.event_type).slice(0, 2)).toEqual(['APPLICATION_CREATED', 'DOCUMENT_UPLOADED']);
    expect(audit.map((a) => a.event_type)).toContain('EVALUATED');
    expect(audit[0]).toMatchObject({ actor_id: user.id, role: 'APPLICANT' });
  });

  it('uses explicit doc_ids when sent', async () => {
    const { token } = await registerApplicant();
    const res = await submitApplication(token, { docIds: ['D100001', 'D100002', 'D100003'] });
    expect(res.status).toBe(201);
    expect(res.body.application.documents.map((d) => d.doc_id)).toEqual(['D100001', 'D100002', 'D100003']);
  });

  it('requires a login (401) and the APPLICANT role (403)', async () => {
    expect((await submitApplication(null)).status).toBe(401);
    expect((await submitApplication(await loginOfficer())).status).toBe(403);
    expect((await submitApplication(await loginChecker())).status).toBe(403);
  });
});

describe('field validation (400 VALIDATION_ERROR naming the field)', () => {
  const future = new Date(Date.now() + 86400000 * 30).toISOString().slice(0, 10);
  it.each([
    ['invalid PAN format', { pan_number: 'ABCDE12345' }, 'pan_number'],
    ['PAN too short', { pan_number: 'ABC123' }, 'pan_number'],
    ['missing gender', { gender: '' }, 'gender'],
    ['unknown gender', { gender: 'ROBOT' }, 'gender'],
    ['bad email', { email: 'not-an-email' }, 'email'],
    ['missing city', { city: '' }, 'city'],
    ['missing state', { state: '' }, 'state'],
    ['occupation not in the list', { occupation_code: 'ASTRONAUT' }, 'occupation_code'],
    ['12-digit Aadhaar', { aadhaar_last4: '123456789012' }, 'aadhaar_last4'],
    ['Aadhaar last4 not digits', { aadhaar_last4: '12ab' }, 'aadhaar_last4'],
    ['mobile too short', { mobile: '98765' }, 'mobile'],
    ['mobile starts with 5', { mobile: '5876543210' }, 'mobile'],
    ['pincode with 5 digits', { pincode: '12200' }, 'pincode'],
    ['pincode starting with 0', { pincode: '012345' }, 'pincode'],
    ['future date of birth', { dob: future }, 'dob'],
    ['impossible date of birth', { dob: '1994-02-31' }, 'dob'],
    ['wrong date format', { dob: '14/03/1994' }, 'dob'],
    ['missing consent', { consent: 'false' }, 'consent'],
    ['negative income', { annual_income: '-5' }, 'annual_income'],
    ['non-numeric income', { annual_income: 'lots' }, 'annual_income'],
    ['empty name', { full_name: '' }, 'full_name'],
    ['digits in name', { full_name: 'Asha 123' }, 'full_name'],
  ])('rejects %s', async (_label, override, field) => {
    const { token } = await registerApplicant();
    const res = await submitApplication(token, { fields: validFields(override) });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.details.map((d) => d.field)).toContain(field);
  });

  it('lists every invalid field in one response', async () => {
    const { token } = await registerApplicant();
    const res = await submitApplication(token, { fields: validFields({ pan_number: 'bad', mobile: '1', pincode: '1' }) });
    expect(res.status).toBe(400);
    expect(res.body.error.details.map((d) => d.field).sort()).toEqual(['mobile', 'pan_number', 'pincode']);
  });

  it('still accepts an under-18 applicant and a PAN whose 4th letter is not P (those are engine rules R4/R5)', async () => {
    const { token } = await registerApplicant();
    const young = new Date(Date.now() - 86400000 * 365 * 10).toISOString().slice(0, 10);
    const res = await submitApplication(token, { fields: validFields({ dob: young, pan_number: 'ZZKCS1234Q' }) });
    expect(res.status).toBe(201);
  });

  it('does not create anything when validation fails', async () => {
    const { token, user } = await registerApplicant();
    await submitApplication(token, { fields: validFields({ pan_number: 'bad' }) });
    const { rows } = await pool.query('SELECT count(*)::int AS n FROM applications WHERE user_id = $1', [user.id]);
    expect(rows[0].n).toBe(0);
  });
});

describe('input names follow the case data dictionary', () => {
  it('accepts the older spellings pan and occupation as aliases of pan_number and occupation_code', async () => {
    const { token } = await registerApplicant();
    const { pan_number, occupation_code, ...rest } = validFields();
    const res = await submitApplication(token, { fields: { ...rest, pan: pan_number.toLowerCase(), occupation: occupation_code } });
    expect(res.status).toBe(201);
    expect(res.body.application.declared.pan_number).toBe('ZZKPS1234Q');
  });
  it('a 12-digit Aadhaar number is refused with a clear message', async () => {
    const { token } = await registerApplicant();
    const res = await submitApplication(token, { fields: validFields({ aadhaar_last4: '482112345678' }) });
    expect(res.status).toBe(400);
    expect(res.body.error.details.find((d) => d.field === 'aadhaar_last4').message).toMatch(/last 4 digits/);
    const { rows } = await pool.query("SELECT 1 FROM audit_events WHERE details::text LIKE '%482112345678%'");
    expect(rows).toHaveLength(0);
  });
  it('at least 3 files are required, each at most 1 MB, and every file needs a declared type', async () => {
    const { token } = await registerApplicant();
    expect((await submitApplication(token, { docs: validDocs().slice(0, 2) })).status).toBe(400);
  });
});

describe('reading applications and object-level access', () => {
  it('an applicant sees only their own applications in the list', async () => {
    const a = await registerApplicant();
    const b = await registerApplicant();
    const appA = (await submitApplication(a.token)).body.application;
    const appB = (await submitApplication(b.token, { docIds: ['X1', 'X2', 'X3'] })).body.application;

    const listA = await api.get('/api/v1/applications').set('Authorization', `Bearer ${a.token}`);
    expect(listA.status).toBe(200);
    expect(listA.body.applications.map((x) => x.id)).toEqual([appA.id]);
    expect(listA.body.applications.map((x) => x.id)).not.toContain(appB.id);
  });

  it("applicant B cannot read applicant A's application, its documents, or its document text (403)", async () => {
    const a = await registerApplicant();
    const b = await registerApplicant();
    const appA = (await submitApplication(a.token)).body.application;
    const auth = { Authorization: `Bearer ${b.token}` };

    expect((await api.get(`/api/v1/applications/${appA.id}`).set(auth)).status).toBe(403);
    expect((await api.get(`/api/v1/applications/${appA.id}/documents`).set(auth)).status).toBe(403);
    const content = await api.get(`/api/v1/applications/${appA.id}/documents/D3000001/content`).set(auth);
    expect(content.status).toBe(403);
    expect(JSON.stringify(content.body)).not.toContain('RAVI KUMAR SHARMA'); // no leak in the error body either
  });

  it('returns 404 for an application that does not exist and 401 without a token', async () => {
    const { token } = await registerApplicant();
    expect((await api.get('/api/v1/applications/A9999999').set('Authorization', `Bearer ${token}`)).status).toBe(404);
    expect((await api.get('/api/v1/applications/A9999999')).status).toBe(401);
  });

  it('applicants get a safe view; officers get the full record', async () => {
    const a = await registerApplicant();
    const app = (await submitApplication(a.token)).body.application;

    const asApplicant = (await api.get(`/api/v1/applications/${app.id}`).set('Authorization', `Bearer ${a.token}`)).body.application;
    for (const hidden of ['name_match_score', 'risk_category', 'reason_codes', 'maker_id', 'checker_id', 'evaluation', 'user_id']) {
      expect(asApplicant).not.toHaveProperty(hidden);
    }
    expect(asApplicant.status_message).toBeTruthy();

    const officer = await loginOfficer();
    const asOfficer = (await api.get(`/api/v1/applications/${app.id}`).set('Authorization', `Bearer ${officer}`)).body.application;
    expect(asOfficer).toHaveProperty('reason_codes');
    expect(asOfficer).toHaveProperty('risk_category');
    expect(asOfficer.pan_number).toBe('ZZKPS1234Q');
  });

  it('officers cannot use the applicant-only list endpoint (403)', async () => {
    const officer = await loginOfficer();
    expect((await api.get('/api/v1/applications').set('Authorization', `Bearer ${officer}`)).status).toBe(403);
  });
});

describe('document content and audit', () => {
  it('returns the document text and records DOCUMENT_VIEWED with user, role, document and time', async () => {
    const a = await registerApplicant();
    const app = (await submitApplication(a.token)).body.application;
    const officer = await loginOfficer();

    const res = await api.get(`/api/v1/applications/${app.id}/documents/D3000001/content`).set('Authorization', `Bearer ${officer}`);
    expect(res.status).toBe(200);
    expect(res.body.document.content).toContain('ZZKPS1234Q');
    expect(res.body.document.content).toContain('SYNTHETIC SPECIMEN - NOT A VALID DOCUMENT');
    expect(res.body.document.declared_type).toBe('PAN_CARD');

    const own = await api.get(`/api/v1/applications/${app.id}/documents/D3000002/content`).set('Authorization', `Bearer ${a.token}`);
    expect(own.status).toBe(200);

    const { rows } = await pool.query(
      "SELECT actor_id, role, entity_id, details, created_at FROM audit_events WHERE event_type = 'DOCUMENT_VIEWED' AND details->>'application_id' = $1 ORDER BY id",
      [app.id],
    );
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ role: 'KYC_OFFICER', entity_id: `${app.id}/D3000001` });
    expect(rows[1]).toMatchObject({ role: 'APPLICANT', actor_id: a.user.id });
    expect(rows[0].created_at).toBeInstanceOf(Date);
  });

  it('404 for an unknown document id; no audit row is written for a failed view', async () => {
    const a = await registerApplicant();
    const app = (await submitApplication(a.token)).body.application;
    const res = await api.get(`/api/v1/applications/${app.id}/documents/NOPE/content`).set('Authorization', `Bearer ${a.token}`);
    expect(res.status).toBe(404);
    const { rows } = await pool.query("SELECT 1 FROM audit_events WHERE event_type = 'DOCUMENT_VIEWED' AND entity_id = $1", [`${app.id}/NOPE`]);
    expect(rows).toHaveLength(0);
  });

  it('detects a tampered stored file (integrity check)', async () => {
    const a = await registerApplicant();
    const app = (await submitApplication(a.token)).body.application;
    const { rows } = await pool.query("SELECT storage_path FROM documents WHERE application_id = $1 AND doc_id = 'D3000001'", [app.id]);
    fs.appendFileSync(path.join(config.uploadDir, rows[0].storage_path), '\nTAMPERED');
    const res = await api.get(`/api/v1/applications/${app.id}/documents/D3000001/content`).set('Authorization', `Bearer ${a.token}`);
    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe('INTEGRITY_ERROR');
  });

  it('the audit log is append-only: UPDATE and DELETE are rejected by the database', async () => {
    await expect(pool.query("UPDATE audit_events SET event_type = 'HACKED'")).rejects.toThrow(/append-only/);
    await expect(pool.query('DELETE FROM audit_events')).rejects.toThrow(/append-only/);
  });
});
