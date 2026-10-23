// Schema + demo-user helpers shared by `npm run seed` and the test setup.
// Takes a connected pg client; does NOT import config, so tests can point it at the test database.
import bcrypt from 'bcryptjs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CONFIG_KEYS } from '../services/kyc/config.js';
import { readConfigFile, readReferenceRows } from '../services/kyc/references.js';

const here = path.dirname(fileURLToPath(import.meta.url));
export const REFERENCE_DIR = path.resolve(here, '..', '..', '..', '..', 'data', 'reference');

export const DEMO_USERS = [
  { name: 'Demo Applicant', email: 'applicant@demo.com', role: 'APPLICANT' },
  { name: 'Demo KYC Officer', email: 'officer@demo.com', role: 'KYC_OFFICER' },
  { name: 'Demo Compliance Officer', email: 'checker@demo.com', role: 'COMPLIANCE_OFFICER' },
  { name: 'Second Compliance Officer', email: 'checker2@demo.com', role: 'COMPLIANCE_OFFICER' }, // worked example 11: maker and checker must differ
];

/** DROPS and recreates every table. */
export async function applySchema(client) {
  const sql = await fs.readFile(path.join(here, 'schema.sql'), 'utf8');
  await client.query(sql);
}

export async function seedDemoUsers(client, password = process.env.DEMO_PASSWORD || 'Demo@1234', rounds = 10) {
  const hash = await bcrypt.hash(password, rounds);
  for (const u of DEMO_USERS) {
    await client.query(
      'INSERT INTO users (name, email, password_hash, role) VALUES ($1, $2, $3, $4)',
      [u.name, u.email, hash, u.role],
    );
  }
}

/** Loads the synthetic watchlists, existing customers, occupations and rule thresholds from data/reference/. */
export async function loadReferenceData(client, dir = REFERENCE_DIR) {
  const rows = readReferenceRows(dir);
  for (const r of rows.sanctions) {
    await client.query(
      'INSERT INTO sanctions_entries (list_id, name, aliases, dob, nationality, program) VALUES ($1,$2,$3,$4,$5,$6)',
      [r.list_id, r.name, r.aliases, r.dob, r.nationality, r.program],
    );
  }
  for (const r of rows.pep) {
    await client.query(
      'INSERT INTO pep_entries (pep_id, name, aliases, dob, position, category) VALUES ($1,$2,$3,$4,$5,$6)',
      [r.pep_id, r.name, r.aliases, r.dob, r.position, r.category],
    );
  }
  for (const r of rows.existing) {
    await client.query('INSERT INTO existing_customers (customer_id, name, pan, dob) VALUES ($1,$2,$3,$4)', [r.customer_id, r.name, r.pan, r.dob]);
  }
  for (const r of rows.occupations) {
    await client.query('INSERT INTO occupations (code, name, risk_level) VALUES ($1,$2,$3)', [r.code, r.name, r.risk_level]);
  }
  const cfg = readConfigFile(dir);
  for (const key of CONFIG_KEYS) {
    if (cfg[key] !== undefined) await client.query('INSERT INTO rule_config (key, value) VALUES ($1, $2::jsonb)', [key, JSON.stringify(cfg[key])]);
  }
  return { sanctions: rows.sanctions.length, pep: rows.pep.length, existing: rows.existing.length, occupations: rows.occupations.length, config: Object.keys(cfg).length };
}

export async function resetDatabase(client, opts = {}) {
  await applySchema(client);
  await seedDemoUsers(client, opts.password, opts.rounds);
  return loadReferenceData(client);
}
