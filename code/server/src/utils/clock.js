// The "business date" stamped on a new application (application_date). It is today's IST calendar date, unless the
// environment variable APPLICATION_DATE=YYYY-MM-DD is set. The override exists so the case document's worked examples
// (all dated 2026-03-04) give the documented results whenever they are run.
import { istDate, parseDate } from './dates.js';

export function businessDate() {
  const override = parseDate(process.env.APPLICATION_DATE);
  return override && /^\d{4}-\d{2}-\d{2}$/.test(String(process.env.APPLICATION_DATE).trim()) ? override : istDate();
}
