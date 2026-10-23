import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
dotenv.config({ path: path.join(root, '.env'), quiet: true });

export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL || 'postgres://onboardiq:onboardiq@localhost:5432/onboardiq_test';

export const TEST_PASSWORD = 'Demo@1234';
