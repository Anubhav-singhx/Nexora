import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url)); // code/server/src
export const repoRoot = path.resolve(here, '..', '..', '..');

// dotenv never overrides variables that are already set (tests rely on this).
dotenv.config({ path: path.join(repoRoot, '.env'), quiet: true });

const env = process.env;

export const config = {
  env: env.NODE_ENV || 'development',
  port: Number(env.PORT) || 3001,
  databaseUrl: env.DATABASE_URL || 'postgres://onboardiq:onboardiq@localhost:5432/onboardiq',
  jwtSecret: env.JWT_SECRET || 'change_me_dev_only_secret_value',
  jwtExpiresIn: env.JWT_EXPIRES_IN || '8h',
  uploadDir: path.resolve(repoRoot, env.UPLOAD_DIR || 'uploads'),
  corsOrigins: (env.CORS_ORIGINS || 'http://localhost:5173,http://127.0.0.1:5173')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
  dataDir: path.resolve(repoRoot, env.DATA_DIR || 'data'),
  extraction: {
    provider: (env.EXTRACTION_PROVIDER || 'mock').toLowerCase(), // 'mock' | 'ai'  (no code change needed to switch)
    mockFile: path.resolve(repoRoot, env.MOCK_EXTRACTION_FILE || 'data/sample/extraction_mock.csv'),
    aiUrl: env.AI_EXTRACTION_URL || '',
    aiApiKey: env.AI_EXTRACTION_API_KEY || '',
    serviceKey: env.EXTRACTION_SERVICE_KEY || 'dev-extraction-service-key-change-me', // header x-service-key
  },
  coreBanking: {
    apiKey: env.CORE_BANKING_API_KEY || 'dev-core-banking-key-change-me',
    url: env.CORE_BANKING_URL || '', // empty = call the built-in mock in-process (still enforces the API key)
  },
  bcryptRounds: env.NODE_ENV === 'test' ? 4 : 10,
  upload: {
    maxFileBytes: 1024 * 1024, // 1 MB per file
    minDocuments: 3,
    maxDocuments: 10,
  },
};

const weakSecret = config.jwtSecret.startsWith('change_me') || config.jwtSecret.length < 16;
if (weakSecret) {
  if (config.env === 'production') {
    throw new Error('JWT_SECRET is missing or weak. Set a long random value before running in production.');
  }
  if (config.env !== 'test') {
    console.warn('[config] Using a development JWT secret. Set JWT_SECRET in .env for anything beyond local use.');
  }
}
