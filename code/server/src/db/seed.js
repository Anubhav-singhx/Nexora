// npm run seed  ->  drops and recreates all tables, then inserts the 3 demo users. Safe to run repeatedly.
import { config } from '../config.js';
import { pool } from './index.js';
import { DEMO_USERS, resetDatabase } from './setup.js';

async function main() {
  if (config.env === 'production' && !process.argv.includes('--force')) {
    console.error('Refusing to wipe the database while NODE_ENV=production. Re-run with --force if you really mean it.');
    process.exit(1);
  }

  const client = await pool.connect();
  try {
    const ref = await resetDatabase(client);
    const { rows } = await client.query('SELECT id, email, role FROM users ORDER BY id');
    console.log('Database reset. Seeded users:');
    for (const u of rows) console.log(`  #${u.id}  ${u.email.padEnd(22)} ${u.role}`);
    console.log(`Reference data loaded: ${ref.sanctions} sanctions, ${ref.pep} PEP, ${ref.existing} existing customers, ${ref.occupations} occupations, ${ref.config} rule settings`);
    console.log(`Password for all demo users: ${process.env.DEMO_PASSWORD || 'Demo@1234'}`);
    if (rows.length !== DEMO_USERS.length) throw new Error('Unexpected number of seeded users');
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error('Seed failed:', err.message);
  if (err.code === 'ECONNREFUSED') console.error('PostgreSQL is not reachable. Start PostgreSQL (or run: npm run db:up if you use Docker)');
  process.exit(1);
});
