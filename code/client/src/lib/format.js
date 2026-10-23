// Display helpers. Dates are shown in IST because the rules run on IST calendar dates.
const TZ = 'Asia/Kolkata';
const dateOnly = /^\d{4}-\d{2}-\d{2}$/;

export function fmtDate(v) {
  if (!v) return '-';
  if (typeof v === 'string' && dateOnly.test(v)) {
    const [y, m, d] = v.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
  }
  return new Date(v).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: TZ });
}

export function fmtDateTime(v) {
  if (!v) return '-';
  return new Date(v).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false, timeZone: TZ });
}

export const inr = (n) => (n === null || n === undefined || n === '' ? '-' : '₹' + Number(n).toLocaleString('en-IN'));
export const pct = (n, digits = 0) => (n === null || n === undefined ? '-' : (Number(n) * 100).toFixed(digits) + '%');
export const score = (n) => (n === null || n === undefined ? '-' : Number(n).toFixed(4));

export function waiting(hours) {
  if (hours === null || hours === undefined) return '-';
  if (hours < 1) return 'under 1 h';
  if (hours < 48) return `${Math.round(hours)} h`;
  return `${Math.round(hours / 24)} d`;
}

export function timeLeft(deadline) {
  const ms = new Date(deadline).getTime() - Date.now();
  if (ms <= 0) return { expired: true, days: 0, hours: 0, text: 'Expired' };
  const days = Math.floor(ms / 86400000);
  const hours = Math.floor((ms % 86400000) / 3600000);
  return { expired: false, days, hours, text: days ? `${days}d ${hours}h left` : `${hours}h left` };
}

export const DOC_TYPE_LABEL = {
  PAN_CARD: 'PAN card',
  AADHAAR_CARD: 'Aadhaar card',
  ELECTRICITY_BILL: 'Electricity bill',
  BANK_STATEMENT: 'Bank statement',
  DRIVING_LICENCE: 'Driving licence',
  OTHER: 'Unrecognised',
};

export const FIELD_LABEL = {
  pan_number: 'PAN number',
  name: 'Name',
  dob: 'Date of birth',
  gender: 'Gender',
  aadhaar_last4: 'Aadhaar last 4',
  address: 'Address',
  pincode: 'Pincode',
  document_date: 'Document date',
  valid_until: 'Valid until',
  doc_type: 'Document type',
};

// Staff-facing names for engine reason codes (applicants get separate, softer wording from the API).
export const REASON_LABEL = {
  DOCUMENT_MISSING: 'Document missing',
  DOCUMENT_TYPE_MISMATCH: 'Document type mismatch',
  LOW_EXTRACTION_CONFIDENCE: 'Low extraction confidence',
  AGE_BELOW_18: 'Under 18',
  PAN_INVALID: 'PAN invalid',
  PAN_MISMATCH: 'PAN mismatch',
  DOB_MISMATCH: 'Date of birth mismatch',
  AADHAAR_MISMATCH: 'Aadhaar mismatch',
  NAME_MISMATCH: 'Name mismatch',
  SANCTIONS_MATCH: 'Sanctions match',
  NAME_MISMATCH_MINOR: 'Name differs slightly',
  DOCUMENT_EXPIRED: 'Document expired',
  ADDRESS_PROOF_STALE: 'Address proof too old',
  ADDRESS_MISMATCH: 'Address mismatch',
  SANCTIONS_POSSIBLE_MATCH: 'Possible sanctions match',
  PEP_MATCH: 'PEP match',
  DUPLICATE_CUSTOMER: 'Existing customer',
};
export const reasonLabel = (c) => REASON_LABEL[c] || c;

export const EVENT_LABEL = {
  LOGIN_SUCCESS: 'Signed in',
  LOGIN_FAILED: 'Failed sign-in',
  USER_REGISTERED: 'Registered',
  APPLICATION_CREATED: 'Application created',
  WATCHLIST_HIT: 'Watchlist hit',
  DOCUMENT_UPLOADED: 'Documents uploaded',
  DOCUMENT_VIEWED: 'Document viewed',
  DOCUMENT_EXTRACTED: 'Document extracted',
  DOCUMENT_REPLACED: 'Document replaced',
  EVALUATED: 'Rules evaluated',
  STATUS_CHANGED: 'Status changed',
  FIELD_CORRECTED: 'Field corrected',
  MAKER_RECOMMENDED: 'Officer recommendation',
  CHECKER_DECIDED: 'Final decision',
  CORE_ACCOUNT_CREATED: 'Account opened',
  CORE_ACCOUNT_FAILED: 'Account opening failed',
  RESUBMITTED: 'Resubmitted',
  APPLICATION_EXPIRED: 'Window expired',
  CONFIG_UPDATED: 'Rule setting changed',
  WATCHLIST_UPDATED: 'Watchlist changed',
  RESCREEN_RUN: 'Re-screen run',
  AUDIT_EXPORTED: 'Audit exported',
};
export const eventLabel = (e) => EVENT_LABEL[e] || e.replace(/_/g, ' ').toLowerCase().replace(/^\w/, (c) => c.toUpperCase());
