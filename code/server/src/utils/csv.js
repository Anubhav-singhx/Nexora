import { parse } from 'csv-parse/sync';

/** Parses CSV text into an array of row objects keyed by the header row (BOM, blank lines and spaces tolerated). */
export function parseCsv(text) {
  return parse(text, {
    columns: (header) => header.map((h) => String(h).trim().replace(/^﻿/, '')),
    skip_empty_lines: true,
    trim: true,
    relax_column_count: true,
    bom: true,
  });
}

const needsQuote = /[",\r\n]/;
export function csvEscape(v) {
  const s = v === null || v === undefined ? '' : String(v);
  return needsQuote.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** rows: array of arrays. Uses \n line endings and a trailing newline. */
export function toCsv(headers, rows) {
  return [headers, ...rows].map((r) => r.map(csvEscape).join(',')).join('\n') + '\n';
}
