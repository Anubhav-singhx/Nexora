import pg from 'pg';
import { config } from '../config.js';

const { Pool, types } = pg;

// DATE columns come back as 'YYYY-MM-DD' strings (not JS Dates) so there are no timezone shifts.
types.setTypeParser(1082, (v) => v);
// NUMERIC columns come back as JS numbers (income, name_match_score).
types.setTypeParser(1700, (v) => (v === null ? null : parseFloat(v)));

export const pool = new Pool({ connectionString: config.databaseUrl });

// Idle clients erroring (e.g. DB restart) must not crash the process.
pool.on('error', (err) => console.error('[db] idle client error:', err.message));

export const query = (text, params) => pool.query(text, params);

/** Runs fn(client) inside BEGIN/COMMIT; rolls back and rethrows on any error. */
export async function withTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}
