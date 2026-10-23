// Copies .env.example to .env if .env does not exist yet. Safe to run repeatedly.
import { copyFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const target = join(root, '.env');

if (existsSync(target)) {
  console.log('.env already exists - leaving it untouched.');
} else {
  copyFileSync(join(root, '.env.example'), target);
  console.log('Created .env from .env.example');
}
