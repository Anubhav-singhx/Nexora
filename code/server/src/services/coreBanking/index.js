// Client used by the application to open an account once an application is finally approved.
// By default it calls the built-in mock in-process; set CORE_BANKING_URL to call it (or a real service) over HTTP.
// Either way the API key is sent and checked.
import { config } from '../../config.js';
import { AppError } from '../../utils/errors.js';
import { handleOpenAccount } from './mockService.js';

export async function openAccount(application) {
  const payload = { application_id: application.id, full_name: application.full_name };
  let status;
  let body;
  if (config.coreBanking.url) {
    try {
      const res = await fetch(`${config.coreBanking.url.replace(/\/$/, '')}/accounts`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-api-key': config.coreBanking.apiKey },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(10000),
      });
      status = res.status;
      body = await res.json().catch(() => ({}));
    } catch (err) {
      throw new AppError(502, 'CORE_BANKING_UNAVAILABLE', `Core banking could not be reached: ${err.message}`);
    }
  } else {
    ({ status, body } = handleOpenAccount({ apiKey: config.coreBanking.apiKey, body: payload }));
  }
  if (status !== 201 || !body.customer_id || !body.account_id) {
    throw new AppError(502, 'CORE_BANKING_UNAVAILABLE', body?.error?.message || 'Core banking did not create the account');
  }
  return { customerId: body.customer_id, accountId: body.account_id };
}
