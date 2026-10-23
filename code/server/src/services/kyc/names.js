// Name normalisation and similarity (case document, Section 6.1; FR-5).
//   1. upper case          2. "." and "-" become a space      3. every character other than A-Z and space is removed
//   4. title tokens dropped (MR, MRS, MS, MISS, DR, SHRI, SMT, KUMARI)   5. spaces collapsed
//   6. tokens sorted alphabetically and joined with one space
//   similarity = 1 - Levenshtein / length of the longer normalised string (1.0 when both are empty)
// The similarity is computed unrounded; round4() is for output only.
import { DEFAULT_RULE_CONFIG } from './config.js';

export function normalizeName(raw, titles = DEFAULT_RULE_CONFIG.name_title_tokens) {
  const titleSet = new Set(titles.map((t) => String(t).toUpperCase()));
  const tokens = String(raw ?? '')
    .toUpperCase()
    .replace(/[.-]/g, ' ')
    .replace(/[^A-Z ]/g, '')
    .split(/ +/)
    .filter((t) => t && !titleSet.has(t));
  return tokens.sort().join(' ');
}

export function levenshtein(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length];
}

/** Similarity of two already-normalised strings, 0..1, NOT rounded. Two empty strings are identical (1). */
export function similarityNormalized(a, b) {
  const max = Math.max(a.length, b.length);
  if (max === 0) return 1;
  return 1 - levenshtein(a, b) / max; // written exactly as in the case document, so boundary values round the same way
}

/** Similarity of two raw names after normalisation. */
export function nameSimilarity(rawA, rawB, titles) {
  return similarityNormalized(normalizeName(rawA, titles), normalizeName(rawB, titles));
}

export const round4 = (n) => (n === null || n === undefined ? null : Number(n.toFixed(4)));
