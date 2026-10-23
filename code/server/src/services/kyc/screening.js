// Sanctions / PEP screening (case document, Section 6.1; FR-5).
// The declared full_name is compared with each list entry's name and each alias (same normalisation as name matching).
//   MATCH     : similarity >= watchlist_match_threshold (0.90) AND the entry's dob is empty or equals the declared dob
//   POSSIBLE  : similarity >= 0.90 with a DIFFERENT dob, or similarity from watchlist_possible_threshold (0.80) to below 0.90
// A list's result is MATCH if any entry matches, else POSSIBLE if any entry is possible, else CLEAR.
import { nameSimilarity, round4 } from './names.js';

/**
 * @param {string} name applicant name
 * @param {string|null} dob applicant DOB 'YYYY-MM-DD'
 * @param {Array} entries  [{ id, list_id|pep_id, name, aliases[], dob }]
 * @returns {{ status: 'MATCH'|'POSSIBLE'|'CLEAR', hits: Array }}
 */
export function screenAgainst(name, dob, entries, cfg, idKey = 'list_id') {
  const hits = [];
  for (const e of entries || []) {
    let best = null;
    for (const candidate of [e.name, ...(e.aliases || [])]) {
      if (!String(candidate ?? '').trim()) continue;
      const score = nameSimilarity(name, candidate, cfg.name_title_tokens);
      if (score >= cfg.watchlist_possible_threshold && (!best || score > best.score)) best = { score, matched_on: candidate };
    }
    if (!best) continue;
    const dobKnown = Boolean(e.dob);
    const dobEqual = dobKnown && Boolean(dob) && e.dob === dob;
    const strong = best.score >= cfg.watchlist_match_threshold;
    const status = strong && (!dobKnown || dobEqual) ? 'MATCH' : 'POSSIBLE';
    hits.push({
      entry_id: e[idKey] || String(e.id),
      name: e.name,
      matched_on: best.matched_on,
      score: round4(best.score),
      list_dob: e.dob || null,
      dob_status: !dobKnown ? 'EMPTY' : dobEqual ? 'EQUAL' : 'DIFFERENT',
      status,
      ...(e.position ? { position: e.position } : {}),
      ...(e.program ? { program: e.program } : {}),
    });
  }
  const status = hits.some((h) => h.status === 'MATCH') ? 'MATCH' : hits.length ? 'POSSIBLE' : 'CLEAR';
  hits.sort((a, b) => (a.status === b.status ? b.score - a.score : a.status === 'MATCH' ? -1 : 1));
  return { status, hits };
}
