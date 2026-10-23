// Runs once before the whole suite: creates the *_test database if needed, then wipes and re-seeds it.
// It refuses to touch any database whose name does not end in "_test", so the dev database is never wiped.
import pg from 'pg';
import { resetDatabase } from '../src/db/setup.js';
import { TEST_DATABASE_URL, TEST_PASSWORD } from './testEnv.js';

export default async function setup() {
  const url = new URL(TEST_DATABASE_URL);
  const dbName = decodeURIComponent(url.pathname.slice(1));
  if (!dbName.endsWith('_test')) {
    throw new Error(`TEST_DATABASE_URL must point at a database whose name ends with "_test" (got "${dbName}")`);
  }

  const adminUrl = new URL(TEST_DATABASE_URL);
  adminUrl.pathname = '/postgres';
  const admin = new pg.Client({ connectionString: adminUrl.toString() });
  try {
    await admin.connect();
  } catch (err) {
    throw new Error(
      `Cannot reach PostgreSQL for tests (${err.message}). Start it with "docker compose up -d db" first.`,
    );
  }
  const exists = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [dbName]);
  if (!exists.rowCount) await admin.query(`CREATE DATABASE "${dbName.replace(/"/g, '""')}"`);
  await admin.end();

  const client = new pg.Client({ connectionString: TEST_DATABASE_URL });
  await client.connect();
  await resetDatabase(client, { password: TEST_PASSWORD, rounds: 4 });
  await client.end();
}
