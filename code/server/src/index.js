import fs from 'node:fs/promises';
import app from './app.js';
import { config } from './config.js';
import { pool } from './db/index.js';
import { startJobs } from './services/jobs.js';

async function main() {
  await fs.mkdir(config.uploadDir, { recursive: true });

  try {
    await pool.query('SELECT 1');
  } catch (err) {
    console.error(`\n[db] Cannot connect to PostgreSQL at ${config.databaseUrl.replace(/:[^:@/]*@/, ':***@')}`);
    console.error(`[db] ${err.message}`);
    console.error('[db] Start PostgreSQL (see README), then run:  npm run seed\n');
    process.exit(1);
  }

  const { rows } = await pool.query("SELECT to_regclass('public.users') AS users_table");
  if (!rows[0].users_table) {
    console.warn('[db] Tables not found. Run:  npm run seed   (from the repository root)');
  }

  const server = app.listen(config.port, () => {
    console.log(`[api] OnboardIQ API listening on http://localhost:${config.port}/api/v1  (${config.env})`);
  });

  startJobs();

  const shutdown = (signal) => {
    console.log(`\n[api] ${signal} received, shutting down...`);
    server.close(async () => {
      await pool.end().catch(() => {});
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 5000).unref();
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((err) => {
  console.error('[api] failed to start:', err);
  process.exit(1);
});
