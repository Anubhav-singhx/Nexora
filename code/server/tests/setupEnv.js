// Runs inside every test worker BEFORE any app code is imported, so config.js picks these values up.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TEST_DATABASE_URL } from './testEnv.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..', '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'onboardiq-test-'));

// The mock extraction file for tests = the shipped sample extraction + a few extra documents used by resubmission tests.
const extraction = path.join(tmp, 'extraction_mock.csv');
fs.writeFileSync(
  extraction,
  fs.readFileSync(path.join(repoRoot, 'data', 'sample', 'extraction_mock.csv'), 'utf8').replace(/\n*$/, '\n') +
    fs.readFileSync(path.join(here, 'fixtures', 'extra_extraction.csv'), 'utf8').split('\n').slice(1).join('\n'),
);

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = TEST_DATABASE_URL;
process.env.JWT_SECRET = 'test-secret-that-is-long-enough-123456';
process.env.UPLOAD_DIR = fs.mkdtempSync(path.join(tmp, 'uploads-'));
process.env.MOCK_EXTRACTION_FILE = extraction;
process.env.EXTRACTION_PROVIDER = 'mock';
process.env.APPLICATION_DATE = '2026-03-04'; // every worked example in the case document is dated 2026-03-04
process.env.EXTRACTION_SERVICE_KEY = 'test-extraction-service-key';
