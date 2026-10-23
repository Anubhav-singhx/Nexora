// Batch evaluation (FR-11): "Running it on the sample files with the mock extraction reproduces the expected columns".
// The sample set has 60 applications; A2000001-A2000010 reproduce worked examples 1-10. The expected_* columns were
// produced by an independent implementation of the rules (data/tools/generate_sample_data.py), and examples 1-10 were
// additionally checked there against the results printed in the case document.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { OUTPUT_COLUMNS, compareWithInline, hasExpectedColumns, runBatch, writeDecisionsCsv } from '../src/services/kyc/batch.js';
import { parseCsv } from '../src/utils/csv.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..', '..');
const sample = (f) => path.join(root, 'data', 'sample', f);
const opts = {
  applicationsFile: sample('applications.csv'),
  documentsFile: sample('documents.csv'),
  extractionFile: sample('extraction_mock.csv'),
  referenceDir: path.join(root, 'data', 'reference'),
};
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'onboardiq-batch-'));

describe('sample set (60 applications with expected_* columns)', () => {
  it('every application matches on all five output columns', () => {
    const out = runBatch(opts);
    expect(hasExpectedColumns(out.applications)).toBe(true);
    const { total, problems } = compareWithInline(out.rows, out.applications);
    expect(total).toBe(60);
    expect(problems).toEqual([]);
  });

  it('the first ten applications are the ten worked examples of the case document', () => {
    const { results } = runBatch(opts);
    const want = {
      A2000001: ['APPROVE', [], 1, 'LOW', '2036-03-04'],
      A2000002: ['REJECT', ['AGE_BELOW_18'], 1, null, null],
      A2000003: ['REJECT', ['PAN_MISMATCH'], 1, null, null],
      A2000004: ['REVIEW', ['NAME_MISMATCH_MINOR'], 0.7647, 'LOW', '2036-03-04'],
      A2000005: ['REVIEW', ['ADDRESS_PROOF_STALE'], 1, 'LOW', '2036-03-04'],
      A2000006: ['REJECT', ['SANCTIONS_MATCH'], 1, null, null],
      A2000007: ['REVIEW', ['PEP_MATCH'], 1, 'HIGH', '2028-03-04'],
      A2000008: ['REVIEW', ['DOCUMENT_MISSING', 'DOCUMENT_TYPE_MISMATCH'], 1, 'LOW', '2036-03-04'],
      A2000009: ['REVIEW', ['LOW_EXTRACTION_CONFIDENCE'], 1, 'LOW', '2036-03-04'],
      A2000010: ['APPROVE', [], 1, 'HIGH', '2028-03-04'],
    };
    for (const [id, [decision, codes, score, risk, rekyc]] of Object.entries(want)) {
      const r = results.find((x) => x.application_id === id);
      expect([id, r.decision, r.reason_codes, r.name_match_score, r.risk_category, r.rekyc_due_date]).toEqual([id, decision, codes, score, risk, rekyc]);
    }
  });

  it('every one of the 17 reason codes occurs at least once in the sample', () => {
    const seen = new Set(runBatch(opts).results.flatMap((r) => r.reason_codes));
    for (const code of ['DOCUMENT_MISSING', 'DOCUMENT_TYPE_MISMATCH', 'LOW_EXTRACTION_CONFIDENCE', 'AGE_BELOW_18', 'PAN_INVALID', 'PAN_MISMATCH', 'DOB_MISMATCH', 'AADHAAR_MISMATCH', 'NAME_MISMATCH', 'SANCTIONS_MATCH', 'NAME_MISMATCH_MINOR', 'DOCUMENT_EXPIRED', 'ADDRESS_PROOF_STALE', 'ADDRESS_MISMATCH', 'SANCTIONS_POSSIBLE_MATCH', 'PEP_MATCH', 'DUPLICATE_CUSTOMER']) {
      expect(seen.has(code), code).toBe(true);
    }
  });

  it('writes decisions_output.csv with exactly the six required columns, in order, four-decimal scores, empty cells for REJECT', () => {
    const dir = tmp();
    const { rows } = runBatch(opts);
    writeDecisionsCsv(path.join(dir, 'decisions_output.csv'), rows);
    const text = fs.readFileSync(path.join(dir, 'decisions_output.csv'), 'utf8');
    expect(text.split('\n')[0]).toBe('application_id,decision,reason_codes,name_match_score,risk_category,rekyc_due_date');
    expect(OUTPUT_COLUMNS).toEqual(['application_id', 'decision', 'reason_codes', 'name_match_score', 'risk_category', 'rekyc_due_date']);
    const parsed = parseCsv(text);
    expect(parsed).toHaveLength(60);
    for (const r of parsed) {
      if (r.name_match_score) expect(r.name_match_score).toMatch(/^\d\.\d{4}$/);
      if (r.decision === 'REJECT') expect([r.risk_category, r.rekyc_due_date]).toEqual(['', '']);
      else expect(r.rekyc_due_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it('the comparison is not vacuous: a changed threshold produces differences', () => {
    const dir = tmp();
    fs.writeFileSync(path.join(dir, 'cfg.json'), JSON.stringify({ name_match_threshold: 0.7647, name_reject_threshold: 0.5 }));
    const out = runBatch({ ...opts, configFile: path.join(dir, 'cfg.json') });
    expect(compareWithInline(out.rows, out.applications).problems.length).toBeGreaterThan(0);
  });

  it('a rules_config file with other key spellings is understood', () => {
    const dir = tmp();
    fs.writeFileSync(path.join(dir, 'cfg.json'), JSON.stringify({ name_match: { pass: 0.76, reject_below: 0.75 } }));
    const out = runBatch({ ...opts, configFile: path.join(dir, 'cfg.json') });
    expect(out.config.overrides).toMatchObject({ name_match_threshold: 0.76, name_reject_threshold: 0.75 });
    const ex4 = out.results.find((r) => r.application_id === 'A2000004');
    expect(ex4.reason_codes).toEqual([]); // 0.7647 now passes
  });

  it('skips duplicate application ids (first kept) and rows without a valid application date', () => {
    const dir = tmp();
    const lines = fs.readFileSync(opts.applicationsFile, 'utf8').trim().split('\n');
    const noDate = lines[2].replace('A2000002', 'A9999999').replace('2026-03-04', '');
    const f = path.join(dir, 'apps.csv');
    fs.writeFileSync(f, [...lines, lines[1], noDate].join('\n') + '\n');
    const out = runBatch({ ...opts, applicationsFile: f });
    expect(out.rows).toHaveLength(60);
    expect(out.skipped.map((s) => s.reason)).toEqual(expect.arrayContaining([expect.stringMatching(/duplicate/), expect.stringMatching(/application_date/)]));
  });

  it('accepts JSONL applications with inline documents', () => {
    const dir = tmp();
    const f = path.join(dir, 'apps.jsonl');
    fs.writeFileSync(f, JSON.stringify({
      application_id: 'J1', full_name: 'Ravi Kumar Sharma', dob: '1990-05-15', pan_number: 'ZZKPS1234Q', aadhaar_last4: '4821', pincode: '400001',
      occupation_code: 'SALARIED_PRIVATE', annual_income: 900000, application_date: '2026-03-04',
      documents: [{ doc_id: 'D3000001', declared_doc_type: 'PAN_CARD' }, { doc_id: 'D3000002', declared_doc_type: 'AADHAAR_CARD' }, { doc_id: 'D3000003', declared_doc_type: 'ELECTRICITY_BILL' }],
    }) + '\n');
    const out = runBatch({ ...opts, applicationsFile: f });
    expect(out.rows).toEqual([['J1', 'APPROVE', '', '1.0000', 'LOW', '2036-03-04']]);
  });

  it('100+ applications evaluate far inside the 60 second limit', () => {
    const dir = tmp();
    const apps = parseCsv(fs.readFileSync(opts.applicationsFile, 'utf8'));
    const docs = parseCsv(fs.readFileSync(opts.documentsFile, 'utf8'));
    const cols = ['application_id', 'application_date', 'full_name', 'dob', 'gender', 'pan_number', 'aadhaar_last4', 'pincode', 'occupation_code', 'annual_income'];
    const aRows = [];
    const dRows = ['doc_id,application_id,file_name,declared_doc_type'];
    for (let copy = 0; copy < 3; copy++) {
      for (const a of apps) {
        const id = `${a.application_id}-${copy}`;
        aRows.push(cols.map((c) => (c === 'application_id' ? id : `"${a[c]}"`)).join(','));
        for (const d of docs.filter((x) => x.application_id === a.application_id)) dRows.push([d.doc_id, id, d.file_name, d.declared_doc_type].join(','));
      }
    }
    fs.writeFileSync(path.join(dir, 'apps.csv'), cols.join(',') + '\n' + aRows.join('\n') + '\n');
    fs.writeFileSync(path.join(dir, 'docs.csv'), dRows.join('\n') + '\n');
    const t0 = Date.now();
    const out = runBatch({ ...opts, applicationsFile: path.join(dir, 'apps.csv'), documentsFile: path.join(dir, 'docs.csv') });
    expect(out.rows.length).toBe(180);
    expect(Date.now() - t0).toBeLessThan(60000);
    expect(out.ms).toBeLessThan(5000);
  });

  it('is deterministic: two runs give identical output', () => {
    expect(runBatch(opts).rows).toEqual(runBatch(opts).rows);
  });
});
