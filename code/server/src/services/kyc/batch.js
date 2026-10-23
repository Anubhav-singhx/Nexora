// FR-11: batch evaluation from files. Uses the SAME evaluate() as the web app - there is no second copy of the rules.
//
// Inputs (CSV, or JSONL for applications) - the file layouts of the HCL data pack:
//   applications   application_id, application_date, full_name, dob, gender, pan_number, aadhaar_last4, mobile, email,
//                  address, city, state, pincode, occupation_code, annual_income [, expected_decision, expected_reason_codes,
//                  expected_name_match_score, expected_risk_category, expected_rekyc_due_date]
//   documents      doc_id, application_id, file_name, declared_doc_type
//   extraction     doc_id, field_name, value, confidence      (field_name doc_type = classified type)
//   reference dir  sanctions / PEP / existing customers / occupations CSV + rules config JSON
//                  (our short names or the case_02_*_V1.0 names, see references.js)
// Output: decisions_output.csv with EXACTLY these columns, in this order:
//   application_id, decision, reason_codes, name_match_score, risk_category, rekyc_due_date
import fs from 'node:fs';
import path from 'node:path';
import { parseCsv, toCsv } from '../../utils/csv.js';
import { parseDate } from '../../utils/dates.js';
import { parseMockTable, UNKNOWN_DOCUMENT } from '../extraction/mockProvider.js';
import { buildConfig } from './config.js';
import { findReferenceFile, loadReferencesFromFiles, readConfigFileDetailed } from './references.js';
import { evaluate } from './rules.js';

export const OUTPUT_COLUMNS = ['application_id', 'decision', 'reason_codes', 'name_match_score', 'risk_category', 'rekyc_due_date'];
export const REASON_SEPARATOR = '|';

function readRecords(file) {
  const text = fs.readFileSync(file, 'utf8');
  if (/\.jsonl$/i.test(file)) {
    return text
      .split(/\r?\n/)
      .filter((l) => l.trim())
      .map((l, i) => {
        try {
          return JSON.parse(l);
        } catch {
          throw new Error(`${path.basename(file)} line ${i + 1} is not valid JSON`);
        }
      });
  }
  return parseCsv(text);
}

/** Output formatting: four decimals for the score, blank when there is none. */
export function toOutputRow(r) {
  return [
    r.application_id,
    r.decision,
    r.reason_codes.join(REASON_SEPARATOR),
    r.name_match_score === null || r.name_match_score === undefined ? '' : r.name_match_score.toFixed(4),
    r.risk_category || '',
    r.rekyc_due_date || '',
  ];
}

/**
 * @returns {{ results: Array, rows: Array<Array>, skipped: Array<{row, reason}>, ms: number }}
 */
export function runBatch({ applicationsFile, documentsFile, extractionFile, referenceDir, configFile }) {
  const started = performance.now();
  const apps = readRecords(applicationsFile);
  const docRows = documentsFile && fs.existsSync(documentsFile) ? readRecords(documentsFile) : [];
  const table = extractionFile && fs.existsSync(extractionFile) ? parseMockTable(fs.readFileSync(extractionFile, 'utf8')) : new Map();
  const refs = loadReferencesFromFiles(referenceDir);
  const configInfo = readConfigFileDetailed(configFile || findReferenceFile(referenceDir, 'config'));
  const config = buildConfig(configInfo.overrides);

  const docsByApp = new Map();
  for (const d of docRows) {
    const key = String(d.application_id ?? '').trim();
    if (!docsByApp.has(key)) docsByApp.set(key, []);
    docsByApp.get(key).push({ doc_id: String(d.doc_id ?? '').trim(), declared_type: String(d.declared_doc_type ?? d.declared_type ?? '').trim().toUpperCase() });
  }

  const results = [];
  const skipped = [];
  const seen = new Set();

  apps.forEach((a, index) => {
    const id = String(a.application_id ?? '').trim();
    if (!id) return skipped.push({ row: index + 1, reason: 'missing application_id' });
    if (seen.has(id)) return skipped.push({ row: index + 1, application_id: id, reason: 'duplicate application_id (first occurrence kept)' });
    seen.add(id);

    // JSONL rows may carry their documents inline
    const declared = Array.isArray(a.documents) ? a.documents.map((d) => ({ doc_id: String(d.doc_id), declared_type: String(d.declared_doc_type ?? d.declared_type).toUpperCase() })) : docsByApp.get(id) || [];
    // identical (doc_id) twice in one application: keep the first, like the upload endpoint does
    const uniq = [...new Map(declared.map((d) => [d.doc_id, d])).values()];

    const documents = uniq.map((d) => {
      const hit = table.get(d.doc_id) || { ...UNKNOWN_DOCUMENT, fields: {} };
      return { doc_id: d.doc_id, declared_type: d.declared_type, classified_type: hit.doc_type, classification_confidence: hit.confidence, fields: hit.fields };
    });

    const application = {
      application_id: id,
      full_name: String(a.full_name ?? ''),
      dob: parseDate(a.dob) || String(a.dob ?? ''),
      pan_number: String(a.pan_number ?? a.pan ?? ''),
      aadhaar_last4: String(a.aadhaar_last4 ?? ''),
      pincode: String(a.pincode ?? ''),
      occupation_code: String(a.occupation_code ?? a.occupation ?? ''),
      annual_income: Number(a.annual_income) || 0,
      application_date: parseDate(a.application_date),
    };
    if (!application.application_date) return skipped.push({ row: index + 1, application_id: id, reason: 'application_date is missing or not a valid date' });
    results.push(evaluate(application, documents, refs, config));
  });

  return { results, rows: results.map(toOutputRow), skipped, ms: performance.now() - started, config: configInfo, applications: apps };
}

export function writeDecisionsCsv(file, rows) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, toCsv(OUTPUT_COLUMNS, rows), 'utf8');
}

const EXPECTED_COLUMNS = {
  decision: 'expected_decision',
  reason_codes: 'expected_reason_codes',
  name_match_score: 'expected_name_match_score',
  risk_category: 'expected_risk_category',
  rekyc_due_date: 'expected_rekyc_due_date',
};

/** True when the applications file carries the sample file's expected_* columns. */
export const hasExpectedColumns = (apps) => apps.some((a) => Object.keys(a).includes('expected_decision'));

function compareRows(rows, expectedRows, pick) {
  const produced = new Map(rows.map((r) => [r[0], r]));
  const problems = [];
  for (const e of expectedRows) {
    const id = String(e.application_id ?? '').trim();
    const got = produced.get(id);
    if (!got) {
      problems.push({ application_id: id, column: '(row)', expected: 'present', got: 'missing' });
      continue;
    }
    OUTPUT_COLUMNS.slice(1).forEach((col, i) => {
      const want = pick(e, col);
      const have = String(got[i + 1] ?? '');
      if (want !== have) problems.push({ application_id: id, column: col, expected: want, got: have });
    });
  }
  return { total: expectedRows.length, problems };
}

/** Compares produced rows with the expected_* columns of the applications file itself (the HCL sample file). */
export function compareWithInline(rows, apps) {
  return compareRows(rows, apps, (e, col) => String(e[EXPECTED_COLUMNS[col]] ?? '').trim());
}

/** Compares produced rows with a separate expected_decisions.csv (columns named like the output). */
export function compareWithExpected(rows, expectedFile) {
  return compareRows(rows, parseCsv(fs.readFileSync(expectedFile, 'utf8')), (e, col) => String(e[col] ?? ''));
}
