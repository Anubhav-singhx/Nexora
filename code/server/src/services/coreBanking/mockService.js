// MOCK core-banking service ("the bank's system"). It is protected by a service API key from the environment
// (CORE_BANKING_API_KEY) and creates deterministic identifiers, so retrying for the same application is safe.
import crypto from 'node:crypto';
import { config } from '../../config.js';

function safeEqual(a, b) {
  const x = Buffer.from(String(a ?? ''));
  const y = Buffer.from(String(b ?? ''));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

/** @returns {{ status: number, body: object }} - the same shape whether it is reached over HTTP or in-process */
export function handleOpenAccount({ apiKey, body }) {
  if (!safeEqual(apiKey, config.coreBanking.apiKey)) {
    return { status: 401, body: { error: { code: 'INVALID_API_KEY', message: 'Missing or invalid service API key' } } };
  }
  if (process.env.CORE_BANKING_FAIL === '1') {
    return { status: 503, body: { error: { code: 'CORE_BANKING_UNAVAILABLE', message: 'Core banking is temporarily unavailable' } } };
  }
  const applicationId = String(body?.application_id ?? '');
  const n = Number(applicationId.replace(/\D/g, ''));
  if (!applicationId || !Number.isFinite(n) || n <= 0) {
    return { status: 400, body: { error: { code: 'VALIDATION_ERROR', message: 'application_id is required' } } };
  }
  return {
    status: 201,
    body: {
      customer_id: `CUST${String(n).padStart(8, '0')}`,
      account_id: `5010${String(n).padStart(8, '0')}`,
      account_type: 'SAVINGS',
      opened_on: new Date().toISOString(),
    },
  };
}
