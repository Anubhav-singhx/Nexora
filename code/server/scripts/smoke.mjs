// npm run smoke  ->  end-to-end check against a RUNNING server (default http://localhost:3001/api/v1).
// Needs: database seeded and the server running WITH APPLICATION_DATE=2026-03-04 (the date of the case document's
// worked examples; set it in the server .env), because the sample documents are dated for that day.
// Uses Node's built-in fetch/FormData and the shipped sample set (worked example 1 = A2000001).
import { readFileSync } from 'node:fs';
import { parse } from 'csv-parse/sync';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const BASE = process.env.API_BASE || 'http://localhost:3001/api/v1';
const PASSWORD = process.env.DEMO_PASSWORD || 'Demo@1234';
const sampleDir = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'data', 'sample');
const csvRows = (f) => parse(readFileSync(join(sampleDir, f), 'utf8'), { columns: true, skip_empty_lines: true });
const sampleApps = new Map(csvRows('applications.csv').map((r) => [r.application_id, r]));
const sampleDocs = csvRows('documents.csv');
const sampleText = new Map(readFileSync(join(sampleDir, 'document_text.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)).map((j) => [j.doc_id, j.text]));

let failed = 0;
const ok = (name) => console.log(`  ✓ ${name}`);
const bad = (name, extra = '') => {
  failed++;
  console.log(`  ✗ ${name} ${extra}`);
};
function check(name, cond, extra) {
  cond ? ok(name) : bad(name, extra);
}

async function call(method, path, { token, json, form } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  let body;
  if (json) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(json);
  }
  if (form) body = form;
  const res = await fetch(`${BASE}${path}`, { method, headers, body });
  let data = null;
  try {
    data = await res.json();
  } catch {
    /* no body */
  }
  return { status: res.status, data };
}

const FORM_FIELDS = ['full_name', 'dob', 'gender', 'pan_number', 'aadhaar_last4', 'mobile', 'email', 'address', 'city', 'state', 'pincode', 'occupation_code', 'annual_income'];

/** The multipart form of a sample application (default: worked example 1). `docs` can limit or repeat its documents. */
function applicationForm(overrides = {}, docs = null, example = 'A2000001') {
  const row = sampleApps.get(example);
  const fields = { ...Object.fromEntries(FORM_FIELDS.map((f) => [f, row[f]])), consent: 'true', ...overrides };
  const list = docs || sampleDocs.filter((d) => d.application_id === example);
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) form.append(k, v);
  for (const d of list) {
    form.append('document_types', d.declared_doc_type);
    form.append('documents', new Blob([d.text ?? sampleText.get(d.doc_id)], { type: 'text/plain' }), `${d.doc_id}.txt`);
  }
  return form;
}
const ex1Docs = sampleDocs.filter((d) => d.application_id === 'A2000001');

console.log(`Smoke test against ${BASE}\n`);

try {
  console.log('Phase 0 - foundation');
  const health = await call('GET', '/health');
  check('GET /health is 200 with db up', health.status === 200 && health.data?.db === 'up', JSON.stringify(health));

  const logins = {};
  for (const [key, email, role] of [
    ['applicant', 'applicant@demo.com', 'APPLICANT'],
    ['officer', 'officer@demo.com', 'KYC_OFFICER'],
    ['checker', 'checker@demo.com', 'COMPLIANCE_OFFICER'],
  ]) {
    const r = await call('POST', '/auth/login', { json: { email, password: PASSWORD } });
    logins[key] = r.data?.token;
    check(`seeded ${key} can log in as ${role}`, r.status === 200 && r.data?.user?.role === role, `status ${r.status}`);
  }

  console.log('\nPhase 1 - customer flow');
  const email = `smoke${Date.now()}@test.com`;
  const reg = await call('POST', '/auth/register', { json: { name: 'Smoke Tester', email, password: 'Secret123' } });
  check('register a new applicant (201)', reg.status === 201 && reg.data?.user?.role === 'APPLICANT', JSON.stringify(reg.data));
  const token = reg.data?.token;

  check('no token -> 401', (await call('GET', '/applications')).status === 401);
  check('officer cannot submit an application -> 403', (await call('POST', '/applications', { token: logins.officer, form: applicationForm() })).status === 403);

  const badPan = await call('POST', '/applications', { token, form: applicationForm({ pan_number: 'BADPAN' }) });
  check('invalid PAN -> 400 VALIDATION_ERROR', badPan.status === 400 && badPan.data?.error?.code === 'VALIDATION_ERROR');

  const twelve = await call('POST', '/applications', { token, form: applicationForm({ aadhaar_last4: '123456789012' }) });
  check('12-digit Aadhaar -> 400', twelve.status === 400);

  const tooFew = await call('POST', '/applications', { token, form: applicationForm({}, ex1Docs.slice(0, 2)) });
  check('only 2 documents -> 400 TOO_FEW_DOCUMENTS', tooFew.status === 400 && tooFew.data?.error?.code === 'TOO_FEW_DOCUMENTS');

  const created = await call('POST', '/applications', { token, form: applicationForm() });
  check('valid application + 3 documents -> 201', created.status === 201 && Boolean(created.data?.application?.id), JSON.stringify(created.data));
  const appId = created.data?.application?.id;
  console.log(`      application id: ${appId}`);

  const dup = await call('POST', '/applications', { token, form: applicationForm({}, [ex1Docs[0], ex1Docs[1], { ...ex1Docs[0], doc_id: 'D3999999', text: sampleText.get(ex1Docs[0].doc_id) }]) });
  check('same file twice -> 409 DUPLICATE_DOCUMENT', dup.status === 409 && dup.data?.error?.code === 'DUPLICATE_DOCUMENT', JSON.stringify(dup.data));

  console.log('\nPhase 2 - verification pipeline');
  let final = null;
  for (let i = 0; i < 25; i++) {
    const r = await call('GET', `/applications/${appId}`, { token });
    final = r.data?.application;
    if (final && !['SUBMITTED', 'EXTRACTING'].includes(final.status)) break;
    await new Promise((res) => setTimeout(res, 400));
  }
  check('worked example 1 is AUTO_APPROVED by the rules (server needs APPLICATION_DATE=2026-03-04)', final?.status === 'AUTO_APPROVED', final?.status);
  check('mock core banking returned an account number', /^5010\d{8}$/.test(final?.account_id || ''), String(final?.account_id));
  check('timeline shows the real history', (final?.timeline || []).length >= 3);

  const mine = await call('GET', '/applications', { token });
  check('my applications list contains it', mine.status === 200 && mine.data?.applications?.some((a) => a.id === appId));

  const detail = await call('GET', `/applications/${appId}`, { token });
  check('applicant detail hides internal fields', detail.status === 200 && !('risk_category' in detail.data.application) && !('name_match_score' in detail.data.application));

  const text = await call('GET', `/applications/${appId}/documents/D3000001/content`, { token });
  check('owner can read document text', text.status === 200 && text.data?.document?.content?.includes('ZZKPS1234Q'));

  const other = await call('POST', '/auth/register', { json: { name: 'Other Person', email: `other${Date.now()}@test.com`, password: 'Secret123' } });
  const otherToken = other.data?.token;
  check("another applicant cannot read it -> 403", (await call('GET', `/applications/${appId}`, { token: otherToken })).status === 403);
  check("another applicant cannot read its document -> 403", (await call('GET', `/applications/${appId}/documents/D3000001/content`, { token: otherToken })).status === 403);

  const asOfficer = await call('GET', `/applications/${appId}`, { token: logins.officer });
  check('officer can read the full record', asOfficer.status === 200 && 'reason_codes' in asOfficer.data.application);

  console.log('\nPhase 3 - staff APIs and role protection');
  check('applicant on /review -> 403', (await call('GET', '/review/queue', { token })).status === 403);
  const queue = await call('GET', '/review/queue', { token: logins.officer });
  check('officer review queue -> 200', queue.status === 200 && Array.isArray(queue.data?.applications));
  check('officer on /compliance -> 403', (await call('GET', '/compliance/pending', { token: logins.officer })).status === 403);
  const pending = await call('GET', '/compliance/pending', { token: logins.checker });
  check('checker pending queue -> 200', pending.status === 200 && Array.isArray(pending.data?.applications));
  const dash = await call('GET', '/compliance/dashboard', { token: logins.checker });
  check('dashboard counts at least this application', dash.status === 200 && dash.data?.total >= 1 && 'straight_through_rate' in dash.data, JSON.stringify(dash.data)?.slice(0, 120));
  const cfg = await call('GET', '/compliance/config', { token: logins.checker });
  check('rule configuration readable', cfg.status === 200 && cfg.data?.config?.length >= 10);
  const audit = await call('GET', `/applications/${appId}/audit`, { token: logins.officer });
  check('officer can read the application audit trail', audit.status === 200 && audit.data?.events?.some((e) => e.event_type === 'EVALUATED'));
  check('applicant cannot read the audit trail -> 403', (await call('GET', `/applications/${appId}/audit`, { token })).status === 403);
  const decisionByOfficer = await call('POST', `/compliance/${appId}/decision`, { token: logins.officer, json: { decision: 'APPROVE', version: 1 } });
  check('officer cannot give the final decision -> 403', decisionByOfficer.status === 403);
} catch (err) {
  console.error(`\nCould not reach the server at ${BASE}: ${err.cause?.code || err.message}`);
  console.error('Is it running?  (npm run dev   and   npm run seed)');
  process.exit(2);
}

console.log(failed ? `\n${failed} check(s) FAILED` : '\nAll smoke checks passed');
process.exit(failed ? 1 : 0);
