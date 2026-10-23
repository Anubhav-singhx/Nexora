// Brute-force guard for POST /auth/login: after MAX failed attempts for the same email from the same address inside
// the window, further attempts get 429 until the window ends. A successful login clears the counter.
// In memory on purpose: it is per server process, which is enough for this deployment; use Redis for several instances.
const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILURES = Number(process.env.LOGIN_MAX_FAILURES) || 8;
const failures = new Map(); // key -> { count, first }

const keyOf = (ip, email) => `${ip}|${email}`;

function current(key, now) {
  const entry = failures.get(key);
  if (!entry || now - entry.first > WINDOW_MS) {
    failures.delete(key);
    return null;
  }
  return entry;
}

/** Returns the seconds to wait when the caller is blocked, otherwise 0. */
export function retryAfterSeconds(ip, email, now = Date.now()) {
  const entry = current(keyOf(ip, email), now);
  if (!entry || entry.count < MAX_FAILURES) return 0;
  return Math.max(1, Math.ceil((entry.first + WINDOW_MS - now) / 1000));
}

export function recordFailure(ip, email, now = Date.now()) {
  const key = keyOf(ip, email);
  const entry = current(key, now);
  if (entry) entry.count += 1;
  else failures.set(key, { count: 1, first: now });
  if (failures.size > 5000) for (const [k, v] of failures) if (now - v.first > WINDOW_MS) failures.delete(k);
}

export function clearFailures(ip, email) {
  failures.delete(keyOf(ip, email));
}

export const resetLoginLimiter = () => failures.clear();
