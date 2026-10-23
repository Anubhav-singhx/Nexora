// Tiny periodic housekeeping (no scheduler infrastructure): expire resubmission windows and retry stuck submissions.
// Expiry also runs lazily whenever applications are read, so correctness never depends on this timer.
import { expireOverdue, processStuckSubmissions } from './pipeline.js';

export function startJobs(intervalMs = 5 * 60 * 1000) {
  const tick = async () => {
    try {
      await expireOverdue();
      await processStuckSubmissions();
    } catch (err) {
      console.error('[jobs]', err.message);
    }
  };
  const timer = setInterval(tick, intervalMs);
  timer.unref(); // never keeps the process alive
  setTimeout(tick, 2000).unref();
  return () => clearInterval(timer);
}
