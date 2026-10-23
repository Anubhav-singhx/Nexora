// All business dates are IST calendar dates ('YYYY-MM-DD'). Never compare raw timestamps for business rules.
const IST = 'Asia/Kolkata';
const istFormat = new Intl.DateTimeFormat('en-CA', { timeZone: IST, year: 'numeric', month: '2-digit', day: '2-digit' });

/** IST calendar date of an instant, as 'YYYY-MM-DD'. */
export function istDate(d = new Date()) {
  return istFormat.format(d instanceof Date ? d : new Date(d));
}

const MONTHS = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4, may: 5, jun: 6, june: 6,
  jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9, september: 9, oct: 10, october: 10,
  nov: 11, november: 11, dec: 12, december: 12,
};

const pad = (n) => String(n).padStart(2, '0');

function build(y, m, d) {
  if (!Number.isInteger(y) || y < 1900 || y > 2200 || m < 1 || m > 12 || d < 1) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null; // e.g. 31 Feb
  return `${y}-${pad(m)}-${pad(d)}`;
}

/**
 * Parses the date formats that appear in document text into 'YYYY-MM-DD', or null if it is not a real date.
 * Supported: 2026-03-05, 2026/03/05, 05/03/2026, 05-03-2026, 05.03.2026 (day first, India),
 *            5 Mar 2026, 05 March 2026, Mar 5, 2026, March 5 2026.
 */
export function parseDate(input) {
  if (input === null || input === undefined) return null;
  const s = String(input).trim().replace(/\s+/g, ' ');
  if (!s) return null;
  let m;
  if ((m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(s))) return build(+m[1], +m[2], +m[3]);
  if ((m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/.exec(s))) return build(+m[3], +m[2], +m[1]);
  if ((m = /^(\d{1,2})(?:st|nd|rd|th)?[ -]([A-Za-z]{3,9}),?[ -](\d{4})$/.exec(s))) {
    const mon = MONTHS[m[2].toLowerCase()];
    return mon ? build(+m[3], mon, +m[1]) : null;
  }
  if ((m = /^([A-Za-z]{3,9})\.? (\d{1,2})(?:st|nd|rd|th)?,? (\d{4})$/.exec(s))) {
    const mon = MONTHS[m[1].toLowerCase()];
    return mon ? build(+m[3], mon, +m[2]) : null;
  }
  return null;
}

const toUtc = (iso) => {
  const [y, m, d] = iso.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
};

/** Whole calendar days from a to b (b - a). Both 'YYYY-MM-DD'. */
export function daysBetween(a, b) {
  return Math.round((toUtc(b) - toUtc(a)) / 86400000);
}

/** Completed years between dob and onDate (both 'YYYY-MM-DD'). */
export function ageOn(dob, onDate) {
  const [by, bm, bd] = dob.split('-').map(Number);
  const [y, m, d] = onDate.split('-').map(Number);
  let age = y - by;
  if (m < bm || (m === bm && d < bd)) age -= 1;
  return age;
}

const isLeap = (y) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;

/** Adds whole years to a date. 29 Feb in a non-leap target year becomes 28 Feb. */
export function addYears(iso, years) {
  const [y, m, d] = iso.split('-').map(Number);
  const ty = y + years;
  const day = m === 2 && d === 29 && !isLeap(ty) ? 28 : d;
  return `${ty}-${pad(m)}-${pad(day)}`;
}

export function addDays(iso, days) {
  const dt = new Date(toUtc(iso) + days * 86400000);
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
}

/** Valid real date 'YYYY-MM-DD'? */
export const isIsoDate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && parseDate(s) === s;
