// Loads the lookup data the engine needs, from the database (live app) or from CSV/JSON files (batch + rule tests).
// Both return the same shape:  { sanctions, pep, existingPans: Map(pan -> {customer_id}), occupations: Map(name|code -> risk) }
import fs from 'node:fs';
import path from 'node:path';
import { parseCsv } from '../../utils/csv.js';
import { parseDate } from '../../utils/dates.js';
import { buildConfig, mapConfigFile } from './config.js';

const aliasList = (v) =>
  String(v ?? '')
    .split(/[|;]/)
    .map((x) => x.trim())
    .filter(Boolean);
const pick = (r, ...names) => {
  for (const n of names) if (r[n] !== undefined && String(r[n]).trim() !== '') return String(r[n]).trim();
  return '';
};

function occupationMap(rows) {
  const m = new Map();
  for (const r of rows) {
    const risk = String(r.risk_level).toUpperCase();
    if (r.name) m.set(String(r.name).trim().toLowerCase(), risk);
    if (r.code) m.set(String(r.code).trim().toLowerCase(), risk);
  }
  return m;
}

function existingMap(rows) {
  const m = new Map();
  for (const r of rows) if (r.pan) m.set(String(r.pan).trim().toUpperCase(), { customer_id: r.customer_id || null, name: r.name || null });
  return m;
}

export async function loadReferencesFromDb(db) {
  // sequential on purpose: `db` may be a single transaction client, which can run one query at a time
  const s = await db.query('SELECT id, list_id, name, aliases, dob, program FROM sanctions_entries ORDER BY id');
  const p = await db.query('SELECT id, pep_id, name, aliases, dob, position FROM pep_entries ORDER BY id');
  const e = await db.query('SELECT customer_id, name, pan FROM existing_customers');
  const o = await db.query('SELECT code, name, risk_level FROM occupations');
  return { sanctions: s.rows, pep: p.rows, existingPans: existingMap(e.rows), occupations: occupationMap(o.rows) };
}

export async function loadConfigFromDb(db) {
  const { rows } = await db.query('SELECT key, value FROM rule_config');
  return buildConfig(Object.fromEntries(rows.map((r) => [r.key, r.value])));
}

// File names: our own short names, or the HCL data-pack names (case_02_sanctions_list_V1.0.csv, ...). The first one
// that exists in the folder wins, so the HCL files can simply be dropped into data/reference/.
const FILES = {
  sanctions: [/^sanctions\.csv$/i, /^case_02_sanctions_list.*\.csv$/i],
  pep: [/^pep\.csv$/i, /^case_02_pep_list.*\.csv$/i],
  existing: [/^existing_customers\.csv$/i, /^case_02_existing_customers.*\.csv$/i],
  occupations: [/^occupations\.csv$/i, /^case_02_occupations.*\.csv$/i],
  config: [/^rules_config\.json$/i, /^case_02_rules_config.*\.json$/i],
};
export function findReferenceFile(dir, kind) {
  if (!fs.existsSync(dir)) return null;
  const names = fs.readdirSync(dir);
  for (const re of FILES[kind]) {
    const hit = names.find((n) => re.test(n));
    if (hit) return path.join(dir, hit);
  }
  return null;
}

const readCsv = (dir, kind) => {
  const p = findReferenceFile(dir, kind);
  return p ? parseCsv(fs.readFileSync(p, 'utf8')) : [];
};

/** Rows as parsed from data/reference/*.csv, normalised into the table shapes (used by the seed and by file mode). */
export function readReferenceRows(dir) {
  return {
    sanctions: readCsv(dir, 'sanctions').map((r) => ({
      list_id: pick(r, 'list_id', 'id') || null,
      name: pick(r, 'name', 'full_name'),
      aliases: aliasList(pick(r, 'alias', 'aliases')),
      dob: parseDate(pick(r, 'dob')),
      nationality: pick(r, 'nationality') || null,
      program: pick(r, 'program') || null,
    })),
    pep: readCsv(dir, 'pep').map((r) => ({
      pep_id: pick(r, 'pep_id', 'id') || null,
      name: pick(r, 'name', 'full_name'),
      aliases: aliasList(pick(r, 'alias', 'aliases')),
      dob: parseDate(pick(r, 'dob')),
      position: pick(r, 'position') || null,
      category: pick(r, 'category') || null,
    })),
    existing: readCsv(dir, 'existing').map((r) => ({
      customer_id: pick(r, 'customer_id') || null,
      name: pick(r, 'full_name', 'name') || null,
      pan: pick(r, 'pan_number', 'pan').toUpperCase(),
      dob: parseDate(pick(r, 'dob')),
    })),
    occupations: readCsv(dir, 'occupations').map((r) => {
      const code = pick(r, 'occupation_code', 'code');
      return { code: code || pick(r, 'description', 'name'), name: pick(r, 'description', 'name') || code, risk_level: pick(r, 'risk_level').toUpperCase() };
    }),
  };
}

export function loadReferencesFromFiles(dir) {
  const rows = readReferenceRows(dir);
  return {
    sanctions: rows.sanctions.map((r, i) => ({ id: i + 1, ...r })),
    pep: rows.pep.map((r, i) => ({ id: i + 1, ...r })),
    existingPans: existingMap(rows.existing),
    occupations: occupationMap(rows.occupations),
  };
}

/**
 * Reads the rules configuration JSON (our rules_config.json or the HCL case_02_rules_config_V1.0.json).
 * Returns { overrides, mapped, ignored, file }: overrides holds only values that passed validation.
 */
export function readConfigFileDetailed(fileOrDir) {
  let file = fileOrDir;
  if (file && fs.existsSync(file) && fs.statSync(file).isDirectory()) file = findReferenceFile(file, 'config');
  if (!file || !fs.existsSync(file)) return { overrides: {}, mapped: {}, ignored: [], file: null };
  return { ...mapConfigFile(JSON.parse(fs.readFileSync(file, 'utf8'))), file };
}

export const readConfigFile = (fileOrDir) => readConfigFileDetailed(fileOrDir).overrides;

export function loadConfigFromFile(file) {
  return buildConfig(readConfigFile(file));
}
