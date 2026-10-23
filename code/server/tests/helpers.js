import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import request from 'supertest';
import app from '../src/app.js';
import { parseCsv } from '../src/utils/csv.js';
import { TEST_PASSWORD } from './testEnv.js';

export const api = request(app);
export const here = path.dirname(fileURLToPath(import.meta.url));
export const fixture = (name) => fs.readFileSync(path.join(here, 'fixtures', name));

export async function login(email, password = TEST_PASSWORD) {
  const res = await api.post('/api/v1/auth/login').send({ email, password });
  if (res.status !== 200) throw new Error(`login failed for ${email}: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body.token;
}
export const loginOfficer = () => login('officer@demo.com');
export const loginChecker = () => login('checker@demo.com');

let counter = 0;
export async function registerApplicant() {
  const email = `user${Date.now()}_${counter++}_${crypto.randomBytes(3).toString('hex')}@test.com`;
  const res = await api
    .post('/api/v1/auth/register')
    .send({ name: 'Test Customer', email, password: 'Secret123' });
  if (res.status !== 201) throw new Error(`register failed: ${JSON.stringify(res.body)}`);
  return { token: res.body.token, user: res.body.user, email };
}

// ---------------------------------------------------------------- the shipped sample set (data/sample)
const repoRoot = path.resolve(here, '..', '..', '..');
const sampleDir = path.join(repoRoot, 'data', 'sample');
const readCsvFile = (f) => parseCsv(fs.readFileSync(path.join(sampleDir, f), 'utf8'));
const sampleApps = new Map(readCsvFile('applications.csv').map((r) => [r.application_id, r]));
const sampleDocRows = readCsvFile('documents.csv');
const sampleText = new Map(
  fs.readFileSync(path.join(sampleDir, 'document_text.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)).map((j) => [j.doc_id, j.text]),
);

// Short names used by the tests -> the worked example (sample application) they stand for.
export const EXAMPLE = {
  clean: 'A2000001', // example 1  - APPROVE, AUTO_APPROVED
  mehta: 'A2000002', // example 2  - AGE_BELOW_18
  pan_mismatch: 'A2000003', // example 3
  ravi: 'A2000004', // example 4  - NAME_MISMATCH_MINOR, IN_REVIEW
  stale: 'A2000005', // example 5  - ADDRESS_PROOF_STALE
  orlov: 'A2000006', // example 6  - SANCTIONS_MATCH
  malhotra: 'A2000007', // example 7  - PEP_MATCH, HIGH
  wrongdoc: 'A2000008', // example 8
  iyer: 'A2000009', // example 9  - poor scan, LOW_EXTRACTION_CONFIDENCE
  nair: 'A2000010', // example 10 - HIGH-risk approval waits for the checker
};
const FORM_FIELDS = ['full_name', 'dob', 'gender', 'pan_number', 'aadhaar_last4', 'mobile', 'email', 'address', 'city', 'state', 'pincode', 'occupation_code', 'annual_income'];

/** Form values (API field names) of a sample application. */
export function sampleFields(applicationId, over = {}) {
  const row = sampleApps.get(applicationId);
  const fields = Object.fromEntries(FORM_FIELDS.map((f) => [f, row[f]]));
  return { ...fields, consent: 'true', ...over };
}

/** The sample application's documents as upload items { name, type, buffer }. */
export function sampleDocs(applicationId) {
  return sampleDocRows
    .filter((d) => d.application_id === applicationId)
    .map((d) => ({ name: `${d.doc_id}.txt`, type: d.declared_doc_type, buffer: Buffer.from(sampleText.get(d.doc_id), 'utf8') }));
}

export const validFields = (over = {}) => sampleFields(EXAMPLE.clean, over);
/** The 3 documents of worked example 1. */
export const validDocs = () => sampleDocs(EXAMPLE.clean);

/**
 * POST /applications as multipart. `docs` items: { name, type, buffer, contentType? }.
 * Pass `docIds` (array) to send explicit doc_ids; pass `rawTypes` to override the document_types sent.
 */
export function submitApplication(token, { fields = validFields(), docs = validDocs(), docIds, rawTypes } = {}) {
  let req = api.post('/api/v1/applications');
  if (token) req = req.set('Authorization', `Bearer ${token}`);
  for (const [k, v] of Object.entries(fields)) req = req.field(k, v);
  (rawTypes || docs.map((d) => d.type)).forEach((t) => (req = req.field('document_types', t)));
  if (docIds) docIds.forEach((id) => (req = req.field('doc_ids', id)));
  for (const d of docs) {
    req = req.attach('documents', d.buffer, { filename: d.name, contentType: d.contentType || 'text/plain' });
  }
  return req;
}

export const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

// ---------------------------------------------------------------- scenarios = worked examples
/** Submits one of the worked examples as the given applicant and returns the response. */
export function submitScenario(token, key, overrides = {}) {
  const id = EXAMPLE[key] || key;
  return submitApplication(token, { fields: sampleFields(id, overrides), docs: sampleDocs(id) });
}

const upload = (docId, type, text) => ({ name: `${docId}.txt`, type, buffer: Buffer.from(text, 'utf8') });
export const resubmitDocs = {
  // corrected PAN card and Aadhaar card for example 4 (their extraction rows are in fixtures/extra_extraction.csv)
  ravi: () => [
    upload('D9000001', 'PAN_CARD', 'SYNTHETIC SPECIMEN - NOT A VALID DOCUMENT\nPERMANENT ACCOUNT NUMBER CARD\nName: RAVI KUMAR SHARMA\nDate of Birth: 21/07/1988\nPAN: ZZRPS4521L\n'),
    upload('D9000002', 'AADHAAR_CARD', 'SYNTHETIC SPECIMEN - NOT A VALID DOCUMENT\nName: RAVI KUMAR SHARMA\nDOB: 21-Jul-1988\nAadhaar No: XXXX XXXX 3344\n'),
  ],
};

export function resubmit(token, applicationId, docs) {
  let req = api.post(`/api/v1/applications/${applicationId}/resubmit`);
  if (token) req = req.set('Authorization', `Bearer ${token}`);
  docs.forEach((d) => (req = req.field('document_types', d.type)));
  for (const d of docs) req = req.attach('documents', d.buffer, { filename: d.name, contentType: 'text/plain' });
  return req;
}

export const auth = (token) => ({ Authorization: `Bearer ${token}` });
export const get = (url, token) => api.get(url).set(auth(token));
export const send = (method, url, token, body) => api[method](url).set(auth(token)).send(body);

/** A fresh applicant who submits a scenario; returns { token, user, id, application }. */
export async function applicantWith(key, overrides = {}) {
  const a = await registerApplicant();
  const res = await submitScenario(a.token, key, overrides);
  if (res.status !== 201) throw new Error(`scenario ${key} failed: ${res.status} ${JSON.stringify(res.body)}`);
  return { ...a, id: res.body.application.id, application: res.body.application };
}
