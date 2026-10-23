// Rule configuration: every threshold the engine reads (case document, Section 6.1 "Configuration parameter" table).
// Defaults live here; the database table rule_config (seeded from data/reference/rules_config.json) overrides them, so
// a Compliance Officer can change a threshold without a code change (FR-4).
import { z } from 'zod';

export const DEFAULT_RULE_CONFIG = Object.freeze({
  min_field_confidence: 0.8, // "usable field" and R3 threshold
  name_match_threshold: 0.9, // name_match_score from here up passes; below it (down to the reject threshold) is R11
  name_reject_threshold: 0.75, // name_match_score below this is R9 (REJECT)
  watchlist_match_threshold: 0.9, // similarity for a MATCH (dob empty/equal) or a POSSIBLE (different dob)
  watchlist_possible_threshold: 0.8, // similarity from here up to (not including) the match threshold is POSSIBLE
  min_age: 18, // R4
  pan_pattern: '^[A-Z]{5}[0-9]{4}[A-Z]$', // R5 format
  pan_holder_char: 'P', // R5 4th character (individual)
  address_proof_max_age_days: 90, // R13: more than this many days before application_date is stale
  name_title_tokens: ['MR', 'MRS', 'MS', 'MISS', 'DR', 'SHRI', 'SMT', 'KUMARI'],
  medium_income_threshold: 2500000, // Rs 25,00,000 per year
  rekyc_years: { HIGH: 2, MEDIUM: 8, LOW: 10 },
  unknown_occupation_risk: 'LOW', // occupation code not in the occupations table
  resubmission_window_days: 7,
  checker_sla_hours: 24, // PENDING_CHECKER items older than this are flagged overdue
  required_fields: {
    PAN_CARD: ['name', 'dob', 'pan_number'],
    AADHAAR_CARD: ['name', 'dob', 'aadhaar_last4'],
    ELECTRICITY_BILL: ['pincode', 'document_date'],
    BANK_STATEMENT: ['pincode', 'document_date'],
    DRIVING_LICENCE: ['pincode', 'valid_until'],
  },
});

const unit = z.number().min(0).max(1);
const years = z.number().int().min(1).max(50);
const fieldList = z.array(z.string().regex(/^[a-z][a-z0-9_]{1,39}$/)).min(1).max(12);
const regexSource = z.string().min(3).max(200).refine((v) => {
  try {
    new RegExp(v);
    return true;
  } catch {
    return false;
  }
}, 'must be a valid regular expression');

/** One zod validator per config key. PATCH /compliance/config and the file loader both use these. */
export const CONFIG_VALIDATORS = {
  min_field_confidence: unit,
  name_match_threshold: unit,
  name_reject_threshold: unit,
  watchlist_match_threshold: unit,
  watchlist_possible_threshold: unit,
  min_age: z.number().int().min(1).max(100),
  pan_pattern: regexSource,
  pan_holder_char: z.string().regex(/^[A-Z]$/),
  address_proof_max_age_days: z.number().int().min(1).max(3650),
  name_title_tokens: z.array(z.string().regex(/^[A-Za-z]{1,12}$/)).max(50),
  medium_income_threshold: z.number().min(0).max(1e12),
  rekyc_years: z.object({ HIGH: years, MEDIUM: years, LOW: years }).strict(),
  unknown_occupation_risk: z.enum(['LOW', 'MEDIUM', 'HIGH']),
  resubmission_window_days: z.number().int().min(1).max(60),
  checker_sla_hours: z.number().min(1).max(720),
  required_fields: z
    .object({
      PAN_CARD: fieldList,
      AADHAAR_CARD: fieldList,
      ELECTRICITY_BILL: fieldList,
      BANK_STATEMENT: fieldList,
      DRIVING_LICENCE: fieldList,
    })
    .strict(),
};

export const CONFIG_KEYS = Object.freeze(Object.keys(DEFAULT_RULE_CONFIG));

/** Cross-key sanity check (a reject threshold above the pass threshold would make R11 impossible). */
export function crossCheck(cfg) {
  const problems = [];
  if (cfg.name_reject_threshold > cfg.name_match_threshold) problems.push('name_reject_threshold must not be greater than name_match_threshold');
  if (cfg.watchlist_possible_threshold > cfg.watchlist_match_threshold) problems.push('watchlist_possible_threshold must not be greater than watchlist_match_threshold');
  return problems;
}

/** Merges overrides onto the defaults. Unknown keys are ignored; invalid values fall back to the default. */
export function buildConfig(overrides = {}) {
  const cfg = { ...DEFAULT_RULE_CONFIG };
  for (const key of CONFIG_KEYS) {
    if (overrides[key] === undefined) continue;
    const parsed = CONFIG_VALIDATORS[key].safeParse(overrides[key]);
    if (parsed.success) cfg[key] = parsed.data;
  }
  if (crossCheck(cfg).length) {
    cfg.name_reject_threshold = DEFAULT_RULE_CONFIG.name_reject_threshold;
    cfg.name_match_threshold = DEFAULT_RULE_CONFIG.name_match_threshold;
    cfg.watchlist_possible_threshold = DEFAULT_RULE_CONFIG.watchlist_possible_threshold;
    cfg.watchlist_match_threshold = DEFAULT_RULE_CONFIG.watchlist_match_threshold;
  }
  return cfg;
}

// ---------------------------------------------------------------------------------------------------------------
// Reading case_02_rules_config_V1.0.json. The exact key names in that file are not known to us, so the loader
// flattens the JSON into "path -> value" pairs (path lower-cased, only letters and digits kept) and maps well-known
// spellings onto our canonical keys. Anything it cannot map is reported, never silently dropped.
const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9]/g, '');

const ALIASES = {
  min_field_confidence: ['minfieldconfidence', 'minimumfieldconfidence', 'minconfidence', 'minimumusablefieldconfidence', 'minusablefieldconfidence', 'fieldconfidencemin', 'minfieldconf', 'confidencethreshold'],
  name_match_threshold: ['namematchthreshold', 'namematchpass', 'namepass', 'namepassthreshold', 'namematchpassthreshold', 'namematchpassscore', 'namematchmin', 'namematchreview', 'namereviewbelow', 'namematchpassreject.pass', 'namematchpass'],
  name_reject_threshold: ['namerejectthreshold', 'namematchreject', 'namematchrejectbelow', 'namerejectbelow', 'namereject', 'namematchrejectthreshold', 'namematchrejectscore'],
  watchlist_match_threshold: ['watchlistmatchthreshold', 'watchlistmatch', 'watchlistmatchscore', 'watchlistmatchmin', 'watchlistmatchsimilarity'],
  watchlist_possible_threshold: ['watchlistpossiblethreshold', 'watchlistpossible', 'watchlistpossiblematch', 'watchlistpossiblescore', 'watchlistpossiblemin', 'watchlistpossiblesimilarity'],
  min_age: ['minage', 'minimumage', 'adultage', 'minageyears'],
  pan_pattern: ['panpattern', 'panregex', 'panformat', 'panpatternregex'],
  pan_holder_char: ['panholderchar', 'panholdertype', 'panholdercharacter', 'panfourthchar', 'panholder', 'panholdertypechar'],
  address_proof_max_age_days: ['addressproofmaxagedays', 'addressproofmaxage', 'addressproofmaxdays', 'maxaddressproofage', 'addressproofagedays', 'addressproofmaxagedays'],
  name_title_tokens: ['nametitletokens', 'titletokens', 'nametitles', 'titles', 'nametitle', 'nametokensremoved', 'nametitletokensremoved'],
  medium_income_threshold: ['mediumincomethreshold', 'mediumriskincome', 'mediumriskincomethreshold', 'incomemediumthreshold', 'mediumincome', 'mediumriskincomeinr'],
  resubmission_window_days: ['resubmissionwindowdays', 'resubmissionwindow', 'resubmissiondays'],
  checker_sla_hours: ['checkerslahours', 'checkersla', 'slahours', 'checkerslahrs'],
  unknown_occupation_risk: ['unknownoccupationrisk', 'defaultoccupationrisk'],
};
const REKYC = { HIGH: ['rekychigh', 'rekyc.high', 'rekycperiodhigh', 'rekycyearshigh', 'rekycperiodbyriskhigh', 'rekycyears.high', 'rekycperioyearshigh'], MEDIUM: ['rekycmedium', 'rekycperiodmedium', 'rekycyearsmedium', 'rekycperiodbyriskmedium'], LOW: ['rekyclow', 'rekycperiodlow', 'rekycyearslow', 'rekycperiodbyrisklow'] };

function flatten(value, path = '', out = []) {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    for (const [k, v] of Object.entries(value)) flatten(v, path ? `${path}.${k}` : k, out);
  } else out.push([path, value]);
  return out;
}

/**
 * Maps a parsed rules_config JSON object onto { overrides, mapped, ignored }.
 * - canonical keys (our own names) are taken as they are;
 * - other spellings are matched on the flattened, normalised key path (or on its last segment).
 */
export function mapConfigFile(raw) {
  const overrides = {};
  const mapped = {};
  const ignored = [];
  for (const key of CONFIG_KEYS) {
    if (raw && raw[key] !== undefined && CONFIG_VALIDATORS[key].safeParse(raw[key]).success) {
      overrides[key] = raw[key];
      mapped[key] = key;
    }
  }
  const aliasToKey = new Map();
  for (const [key, list] of Object.entries(ALIASES)) for (const a of list) aliasToKey.set(norm(a), key);
  const rekycAlias = new Map();
  for (const [risk, list] of Object.entries(REKYC)) for (const a of list) rekycAlias.set(norm(a), risk);

  const coerce = (key, v) => {
    if (key === 'name_title_tokens' && typeof v === 'string') return v.split(/[,|\s]+/).filter(Boolean);
    if (typeof v === 'string' && v.trim() !== '' && !Number.isNaN(Number(v)) && !['pan_pattern', 'pan_holder_char'].includes(key)) return Number(v);
    return v;
  };

  for (const [path, value] of flatten(raw || {})) {
    if (CONFIG_KEYS.includes(path.split('.')[0])) continue; // already handled as a canonical key
    const full = norm(path);
    const last = norm(path.split('.').pop());
    const parent = norm(path.split('.').slice(-2, -1)[0] || '');
    const risk = rekycAlias.get(full) || rekycAlias.get(last) || (parent.includes('rekyc') ? rekycAlias.get(`rekyc${last}`) : undefined);
    if (risk) {
      const n = Number(value);
      if (Number.isFinite(n) && n > 0) {
        overrides.rekyc_years = { ...(overrides.rekyc_years || {}), [risk]: Math.round(n) };
        mapped[path] = `rekyc_years.${risk}`;
      } else ignored.push(path);
      continue;
    }
    // nested "name_match": { "pass": 0.9, "reject_below": 0.75 } and similar
    let key = aliasToKey.get(full) || aliasToKey.get(last);
    if (!key && /name/.test(parent) && /(pass|threshold|match)$/.test(last) && !/reject/.test(last)) key = 'name_match_threshold';
    if (!key && /name/.test(parent) && /reject/.test(last)) key = 'name_reject_threshold';
    if (!key && /watchlist/.test(parent) && /possible/.test(last)) key = 'watchlist_possible_threshold';
    if (!key && /watchlist/.test(parent) && /match/.test(last)) key = 'watchlist_match_threshold';
    if (!key) {
      ignored.push(path);
      continue;
    }
    const v = coerce(key, value);
    if (CONFIG_VALIDATORS[key].safeParse(v).success) {
      overrides[key] = v;
      mapped[path] = key;
    } else ignored.push(path);
  }
  return { overrides, mapped, ignored };
}
