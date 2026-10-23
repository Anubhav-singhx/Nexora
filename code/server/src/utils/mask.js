// Privacy: PAN is masked in lists, logs and exports. Only the detail view for the owner / staff shows it in full.
export function maskPan(pan) {
  const s = String(pan ?? '');
  if (s.length < 6) return s ? 'XXXXXXXXXX' : s;
  return `${s.slice(0, 3)}${'X'.repeat(s.length - 5)}${s.slice(-2)}`; // ZZKPS1234Q -> ZZKXXXXX4Q
}

const PAN_RE = /\b[A-Z]{5}[0-9]{4}[A-Z]\b/g;
const PAN_KEYS = new Set(['pan', 'pan_number']);

/** Masks any PAN-looking text inside a string. */
export const maskPanInText = (text) => String(text ?? '').replace(PAN_RE, (m) => maskPan(m));

/** Deep copy of a JSON-like value with every PAN masked (by key name and by pattern). */
export function maskPanDeep(value, key = '') {
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') return PAN_KEYS.has(key) ? maskPan(value) : maskPanInText(value);
  if (Array.isArray(value)) return value.map((v) => maskPanDeep(v, key));
  if (typeof value === 'object') {
    const out = {};
    // a { field: 'pan_number', value: 'ABC...' } pair (audit rows for corrections) is masked as a whole
    const panPair = PAN_KEYS.has(value.field);
    for (const [k, v] of Object.entries(value)) {
      out[k] = panPair && (k === 'value' || k === 'old' || k === 'new') && typeof v === 'string' ? maskPan(v) : maskPanDeep(v, k);
    }
    return out;
  }
  return value;
}
