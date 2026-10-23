// Mock extraction service (FR-3): looks results up BY doc_id in the extraction_mock file. It never reads the text.
// A doc_id that is not in the file is an unknown document: doc_type OTHER, confidence 0.00, no fields.
//
// File format (case document, Section 4) - long format, one row per field:   doc_id,field_name,value,confidence
//   field_name "doc_type" carries the classified type in `value` and the doc_type confidence in `confidence`;
//   every other field_name is a document field (name, dob, gender, pan_number, aadhaar_last4, address, pincode,
//   document_date, valid_until) with its value (already normalised) and confidence (0 to 1).
import fs from 'node:fs';
import { parseCsv } from '../../utils/csv.js';

export const UNKNOWN_DOCUMENT = Object.freeze({ doc_type: 'OTHER', confidence: 0, fields: {} });
export const DOC_TYPE_FIELD = 'doc_type';

function clamp01(n) {
  const x = Number(n);
  return Number.isFinite(x) ? Math.min(1, Math.max(0, x)) : 0;
}

export function parseMockTable(csvText) {
  const table = new Map();
  for (const row of parseCsv(csvText)) {
    const id = String(row.doc_id ?? '').trim();
    const name = String(row.field_name ?? row.field ?? '').trim();
    if (!id || !name) continue;
    if (!table.has(id)) table.set(id, { doc_type: 'OTHER', confidence: 0, fields: {} });
    const entry = table.get(id);
    if (name === DOC_TYPE_FIELD) {
      entry.doc_type = String(row.value ?? '').trim().toUpperCase() || 'OTHER';
      entry.confidence = clamp01(row.confidence);
    } else {
      entry.fields[name] = { value: String(row.value ?? ''), confidence: clamp01(row.confidence) };
    }
  }
  return table;
}

export function createMockProvider(file) {
  let table = new Map();
  let loadedMtime = -1;
  const load = () => {
    let mtime = 0;
    try {
      mtime = fs.statSync(file).mtimeMs;
    } catch {
      table = new Map();
      loadedMtime = -1;
      return;
    }
    if (mtime !== loadedMtime) {
      table = parseMockTable(fs.readFileSync(file, 'utf8'));
      loadedMtime = mtime;
    }
  };
  return {
    name: 'mock',
    async extract({ docId }) {
      load(); // cheap stat; the file is re-read only when it changes, so edits need no restart
      const hit = table.get(String(docId));
      if (!hit) return { ...UNKNOWN_DOCUMENT, fields: {}, provider: 'mock', known: false };
      return { doc_type: hit.doc_type, confidence: hit.confidence, fields: structuredClone(hit.fields), provider: 'mock', known: true };
    },
  };
}
