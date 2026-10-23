// The 17 KYC rules (R1-R17), as one PURE function: same input -> same output, no database, no clock, no randomness.
// The API pipeline, the officer re-evaluation, the re-screen job and the batch command all call evaluate().
// Semantics follow the case document, Section 6.1, word for word:
//   classified type   : the doc_type returned by the extraction service (OTHER when unknown).
//   selected document : for PAN_CARD and AADHAAR_CARD the document of that CLASSIFIED type with the lowest doc_id;
//                       the address proof is the lowest doc_id among ELECTRICITY_BILL, BANK_STATEMENT, DRIVING_LICENCE.
//   usable document   : (R1 only) a selected document whose doc_type confidence is at least min_field_confidence.
//   usable field      : present, not empty and confidence >= min_field_confidence.
//   R6-R14 use usable fields only; a rule whose field is not usable is NOT evaluated, so a misread can never reject.
import { ADDRESS_PROOF_TYPES, DATE_FIELDS, DECISION, DOC_TYPES, REASON, RISK } from '../../constants.js';
import { addDays, addYears, ageOn, daysBetween, parseDate } from '../../utils/dates.js';
import { buildConfig } from './config.js';
import { nameSimilarity, round4 } from './names.js';
import { screenAgainst } from './screening.js';

export const ENGINE_VERSION = '2.0.0';
const DATE_FIELD_SET = new Set(DATE_FIELDS);

export const RULES = [
  ['R1', REASON.DOCUMENT_MISSING, DECISION.REVIEW, 'No usable document of type PAN_CARD, AADHAAR_CARD or any address-proof type'],
  ['R2', REASON.DOCUMENT_TYPE_MISMATCH, DECISION.REVIEW, 'A document\'s classified doc_type differs from its declared_doc_type'],
  ['R3', REASON.LOW_EXTRACTION_CONFIDENCE, DECISION.REVIEW, 'A doc_type confidence is below 0.80, or a required field of a selected document is missing or below 0.80'],
  ['R4', REASON.AGE_BELOW_18, DECISION.REJECT, 'Age below 18'],
  ['R5', REASON.PAN_INVALID, DECISION.REJECT, 'Declared pan_number is not AAAAA9999A or its 4th character is not P'],
  ['R6', REASON.PAN_MISMATCH, DECISION.REJECT, 'Usable pan_number on the PAN card differs from the declared pan_number'],
  ['R7', REASON.DOB_MISMATCH, DECISION.REJECT, 'Usable dob on the PAN card or the Aadhaar card differs from the declared dob'],
  ['R8', REASON.AADHAAR_MISMATCH, DECISION.REJECT, 'Usable aadhaar_last4 differs from the declared aadhaar_last4'],
  ['R9', REASON.NAME_MISMATCH, DECISION.REJECT, 'name_match_score below 0.75'],
  ['R10', REASON.SANCTIONS_MATCH, DECISION.REJECT, 'Sanctions screening result is MATCH'],
  ['R11', REASON.NAME_MISMATCH_MINOR, DECISION.REVIEW, 'name_match_score from 0.75 to below 0.90'],
  ['R12', REASON.DOCUMENT_EXPIRED, DECISION.REVIEW, 'Address proof is a DRIVING_LICENCE and valid_until is earlier than application_date'],
  ['R13', REASON.ADDRESS_PROOF_STALE, DECISION.REVIEW, 'Address proof is an ELECTRICITY_BILL or BANK_STATEMENT and document_date is more than 90 days before application_date, or after it'],
  ['R14', REASON.ADDRESS_MISMATCH, DECISION.REVIEW, 'Usable pincode on the address proof differs from the declared pincode'],
  ['R15', REASON.SANCTIONS_POSSIBLE_MATCH, DECISION.REVIEW, 'Sanctions screening result is POSSIBLE'],
  ['R16', REASON.PEP_MATCH, DECISION.REVIEW, 'PEP screening result is MATCH'],
  ['R17', REASON.DUPLICATE_CUSTOMER, DECISION.REVIEW, 'Declared pan_number exists in existing_customers'],
].map(([rule, code, outcome, title]) => Object.freeze({ rule, code, outcome, title }));

const collator = new Intl.Collator('en', { numeric: true });
const byDocId = (a, b) => collator.compare(String(a.doc_id), String(b.doc_id)) || (a.doc_id < b.doc_id ? -1 : a.doc_id > b.doc_id ? 1 : 0);

const norm = (v) => String(v ?? '').trim();
const present = (f) => f && norm(f.value) !== '';
const classifiedOf = (d) => d.classified_type || DOC_TYPES.OTHER;

/** Picks PAN_CARD, AADHAAR_CARD and address-proof documents by CLASSIFIED type, lowest doc_id first. */
export function selectDocuments(documents) {
  const sorted = [...documents].sort(byDocId);
  return {
    PAN: sorted.find((d) => classifiedOf(d) === DOC_TYPES.PAN_CARD) || null,
    AADHAAR: sorted.find((d) => classifiedOf(d) === DOC_TYPES.AADHAAR_CARD) || null,
    ADDRESS: sorted.find((d) => ADDRESS_PROOF_TYPES.includes(classifiedOf(d))) || null,
  };
}

/**
 * @param {object} app   { application_id, full_name, dob, pan_number, aadhaar_last4, pincode, occupation_code, annual_income, application_date }
 * @param {Array}  documents [{ doc_id, declared_type, classified_type, classification_confidence, fields: { name: { value, confidence } } }]
 * @param {object} refs  { sanctions: [], pep: [], existingPans: Set|Map, occupations: Map(lowercased code|description -> risk) }
 * @param {object} rawConfig overrides for DEFAULT_RULE_CONFIG
 */
export function evaluate(app, documents = [], refs = {}, rawConfig = {}) {
  const cfg = buildConfig(rawConfig);
  const min = cfg.min_field_confidence;
  const today = app.application_date;
  const enteredPan = norm(app.pan_number ?? app.pan); // as declared: the PAN pattern is checked literally by R5
  const occupation = norm(app.occupation_code ?? app.occupation);
  const selected = selectDocuments(documents);

  const triggered = new Map(); // rule id -> { detail, evidence }
  const notes = new Map(); // rule id -> why it was not evaluated
  const fire = (rule, detail, evidence = {}) => triggered.set(rule, { detail, evidence });
  const skip = (rule, why) => notes.set(rule, why);

  const typeConf = (d) => Number(d?.classification_confidence ?? 0);
  const field = (d, name) => (d && d.fields ? d.fields[name] : undefined);
  const usableField = (d, name) => {
    const f = field(d, name);
    if (!d || !present(f) || Number(f.confidence ?? 0) < min) return null;
    if (DATE_FIELD_SET.has(name) && !parseDate(f.value)) return null;
    return f;
  };

  const slots = [
    ['PAN_CARD', 'PAN card', selected.PAN],
    ['AADHAAR_CARD', 'Aadhaar card', selected.AADHAAR],
    ['ADDRESS_PROOF', 'address proof', selected.ADDRESS],
  ];

  // R1 - no usable document of type PAN_CARD, AADHAAR_CARD or any address-proof type
  const missing = slots.filter(([, , d]) => !d || typeConf(d) < min).map(([, label]) => label);
  if (missing.length) fire('R1', `No usable document for: ${missing.join(', ')}`, { missing });

  // R2 - any document's classified doc_type differs from its declared_doc_type
  const typeMismatches = documents
    .filter((d) => classifiedOf(d) !== d.declared_type)
    .sort(byDocId)
    .map((d) => ({ doc_id: d.doc_id, declared: d.declared_type, classified: classifiedOf(d) }));
  if (typeMismatches.length) {
    fire('R2', typeMismatches.map((m) => `${m.doc_id}: declared ${m.declared}, classified ${m.classified}`).join('; '), { documents: typeMismatches });
  }

  // R3 - any document's doc_type confidence below the minimum, or a required field of a selected document is missing / low
  const lowConf = [];
  for (const d of [...documents].sort(byDocId)) {
    if (typeConf(d) < min) lowConf.push({ doc_id: d.doc_id, field: 'doc_type', confidence: typeConf(d), problem: 'low confidence' });
  }
  for (const [, , d] of slots) {
    if (!d) continue;
    for (const name of cfg.required_fields[classifiedOf(d)] || []) {
      const f = field(d, name);
      const conf = Number(f?.confidence ?? 0);
      if (!present(f)) lowConf.push({ doc_id: d.doc_id, field: name, confidence: conf, problem: 'missing' });
      else if (conf < min) lowConf.push({ doc_id: d.doc_id, field: name, confidence: conf, problem: 'low confidence' });
      else if (DATE_FIELD_SET.has(name) && !parseDate(f.value)) lowConf.push({ doc_id: d.doc_id, field: name, confidence: conf, problem: 'not a valid date' });
    }
  }
  if (lowConf.length) {
    fire('R3', lowConf.map((l) => `${l.doc_id}.${l.field} ${l.problem} (${l.confidence.toFixed(2)})`).join('; '), { fields: lowConf });
  }

  // R4 - age
  const dob = parseDate(app.dob);
  if (!dob || !today) skip('R4', 'Date of birth is not a valid date');
  else {
    const age = ageOn(dob, today);
    if (age < cfg.min_age) fire('R4', `Applicant is ${age} on ${today}`, { age, dob, on: today });
  }

  // R5 - declared PAN: pattern, then holder type (4th character)
  if (!new RegExp(cfg.pan_pattern).test(enteredPan)) fire('R5', 'PAN does not match the pattern AAAAA9999A', { entered: enteredPan });
  else if (enteredPan[3] !== cfg.pan_holder_char) fire('R5', `Fourth character is "${enteredPan[3]}", expected "${cfg.pan_holder_char}" (individual)`, { entered: enteredPan });

  // R6 - PAN on the PAN card
  const docPan = usableField(selected.PAN, 'pan_number');
  if (!docPan) skip('R6', 'No usable pan_number on the PAN card');
  else if (norm(docPan.value).toUpperCase().replace(/\s/g, '') !== enteredPan) {
    fire('R6', `PAN card shows ${norm(docPan.value).toUpperCase()}, declared ${enteredPan}`, { document: norm(docPan.value).toUpperCase(), entered: enteredPan, doc_id: selected.PAN.doc_id });
  }

  // R7 - DOB on the PAN card or the Aadhaar card
  const dobChecks = [];
  for (const [label, d] of [['PAN_CARD', selected.PAN], ['AADHAAR_CARD', selected.AADHAAR]]) {
    const f = usableField(d, 'dob');
    if (f) dobChecks.push({ source: label, doc_id: d.doc_id, value: parseDate(f.value) });
  }
  if (!dobChecks.length || !dob) skip('R7', 'No usable dob on the PAN card or the Aadhaar card');
  else {
    const bad = dobChecks.filter((c) => c.value !== dob);
    if (bad.length) fire('R7', bad.map((b) => `${b.source} dob ${b.value}, declared ${dob}`).join('; '), { entered: dob, documents: bad });
  }

  // R8 - Aadhaar last four
  const docAadhaar = usableField(selected.AADHAAR, 'aadhaar_last4');
  if (!docAadhaar) skip('R8', 'No usable aadhaar_last4 on the Aadhaar card');
  else {
    const digits = norm(docAadhaar.value).replace(/\D/g, '');
    const last4 = digits.slice(-4);
    if (digits.length < 4 || last4 !== norm(app.aadhaar_last4)) {
      fire('R8', `Aadhaar card ends ${last4 || '?'}, declared ends ${norm(app.aadhaar_last4)}`, { document: last4, entered: norm(app.aadhaar_last4), doc_id: selected.AADHAAR.doc_id });
    }
  }

  // R9 / R11 - name_match_score = lowest similarity between the declared name and the usable names on PAN and Aadhaar
  const nameScores = [];
  for (const [label, d] of [['PAN_CARD', selected.PAN], ['AADHAAR_CARD', selected.AADHAAR]]) {
    const f = usableField(d, 'name');
    if (!f) continue;
    nameScores.push({ source: label, doc_id: d.doc_id, name: norm(f.value), score: nameSimilarity(app.full_name, f.value, cfg.name_title_tokens) });
  }
  const nameScore = nameScores.length ? Math.min(...nameScores.map((n) => n.score)) : null;
  const scoreEvidence = () => ({ score: round4(nameScore), entered: app.full_name, documents: nameScores.map((n) => ({ ...n, score: round4(n.score) })) });
  if (nameScore === null) {
    skip('R9', 'No usable name on the PAN card or the Aadhaar card, so there is no name score');
    skip('R11', 'No usable name on the PAN card or the Aadhaar card, so there is no name score');
  } else if (nameScore < cfg.name_reject_threshold) {
    fire('R9', `name_match_score ${round4(nameScore).toFixed(4)} is below ${cfg.name_reject_threshold}`, scoreEvidence());
  } else if (nameScore < cfg.name_match_threshold) {
    fire('R11', `name_match_score ${round4(nameScore).toFixed(4)} is from ${cfg.name_reject_threshold} to below ${cfg.name_match_threshold}`, scoreEvidence());
  }

  // R10 / R15 - sanctions
  const sanctions = screenAgainst(app.full_name, dob, refs.sanctions, cfg, 'list_id');
  if (sanctions.status === 'MATCH') fire('R10', `Sanctions MATCH: ${sanctions.hits.filter((h) => h.status === 'MATCH').map((h) => h.entry_id).join(', ')}`, { hits: sanctions.hits });
  else if (sanctions.status === 'POSSIBLE') fire('R15', `Sanctions POSSIBLE match: ${sanctions.hits.map((h) => h.entry_id).join(', ')}`, { hits: sanctions.hits });

  // R16 - PEP (only a MATCH is a rule; a POSSIBLE PEP hit is kept as evidence but triggers nothing)
  const pep = screenAgainst(app.full_name, dob, refs.pep, cfg, 'pep_id');
  if (pep.status === 'MATCH') fire('R16', `PEP MATCH: ${pep.hits.filter((h) => h.status === 'MATCH').map((h) => h.entry_id).join(', ')}`, { hits: pep.hits });

  // R12 / R13 / R14 - the selected address proof
  const addr = selected.ADDRESS;
  const addrType = addr ? classifiedOf(addr) : null;
  if (addrType === DOC_TYPES.DRIVING_LICENCE) {
    const f = usableField(addr, 'valid_until');
    if (!f) skip('R12', 'No usable valid_until on the driving licence');
    else if (parseDate(f.value) < today) fire('R12', `Driving licence valid until ${parseDate(f.value)}, before ${today}`, { valid_until: parseDate(f.value), on: today, doc_id: addr.doc_id });
  } else skip('R12', 'The address proof is not a driving licence');

  if (addrType === DOC_TYPES.ELECTRICITY_BILL || addrType === DOC_TYPES.BANK_STATEMENT) {
    const f = usableField(addr, 'document_date');
    if (!f) skip('R13', 'No usable document_date on the address proof');
    else {
      const docDate = parseDate(f.value);
      const age = daysBetween(docDate, today);
      if (age < 0) fire('R13', `Document is dated ${docDate}, after the application date ${today}`, { document_date: docDate, age_days: age, doc_id: addr.doc_id });
      else if (age > cfg.address_proof_max_age_days) fire('R13', `Document is ${age} days old (limit ${cfg.address_proof_max_age_days})`, { document_date: docDate, age_days: age, doc_id: addr.doc_id });
    }
  } else skip('R13', 'The address proof is not an electricity bill or bank statement');

  const docPincode = usableField(addr, 'pincode');
  if (!docPincode) skip('R14', 'No usable pincode on the address proof');
  else if (norm(docPincode.value).replace(/\D/g, '') !== norm(app.pincode)) {
    fire('R14', `Address proof pincode ${norm(docPincode.value)}, declared ${norm(app.pincode)}`, { document: norm(docPincode.value), entered: norm(app.pincode), doc_id: addr.doc_id });
  }

  // R17 - declared PAN already belongs to an existing customer
  const existing = refs.existingPans instanceof Map ? refs.existingPans.get(enteredPan) : refs.existingPans?.has?.(enteredPan) ? {} : undefined;
  if (existing) fire('R17', `PAN is already registered${existing.customer_id ? ` to customer ${existing.customer_id}` : ''}`, { customer_id: existing.customer_id || null });

  // ---- decision: REJECT beats REVIEW beats APPROVE; every triggered reason is returned in rule order
  const trace = RULES.map((r) => {
    const t = triggered.get(r.rule);
    return {
      rule: r.rule,
      code: r.code,
      title: r.title,
      outcome: r.outcome,
      status: t ? 'TRIGGERED' : notes.has(r.rule) ? 'NOT_EVALUATED' : 'PASSED',
      detail: t ? t.detail : notes.get(r.rule) || '',
      evidence: t ? t.evidence : {},
    };
  });
  const hits = trace.filter((t) => t.status === 'TRIGGERED');
  const reason_codes = hits.map((t) => t.code);
  const decision = hits.some((t) => t.outcome === DECISION.REJECT)
    ? DECISION.REJECT
    : hits.length
      ? DECISION.REVIEW
      : DECISION.APPROVE;

  // ---- risk and next KYC date (blank for REJECT)
  let risk_category = null;
  let rekyc_due_date = null;
  let risk_basis = [];
  if (decision !== DECISION.REJECT) {
    const key = occupation.toLowerCase();
    const occRisk = refs.occupations?.get?.(key) || cfg.unknown_occupation_risk;
    const income = Number(app.annual_income) || 0;
    if (pep.status === 'MATCH') risk_basis.push('PEP match');
    if (sanctions.status === 'POSSIBLE') risk_basis.push('Possible sanctions match');
    if (occRisk === RISK.HIGH) risk_basis.push(`HIGH-risk occupation (${occupation})`);
    if (risk_basis.length) risk_category = RISK.HIGH;
    else {
      if (occRisk === RISK.MEDIUM) risk_basis.push(`MEDIUM-risk occupation (${occupation})`);
      if (income >= cfg.medium_income_threshold) risk_basis.push(`Annual income ${income} is at least ${cfg.medium_income_threshold}`);
      risk_category = risk_basis.length ? RISK.MEDIUM : RISK.LOW;
    }
    if (today) rekyc_due_date = addYears(today, cfg.rekyc_years[risk_category]);
  }

  return {
    engine_version: ENGINE_VERSION,
    application_id: app.application_id ?? null,
    application_date: today ?? null,
    decision,
    reason_codes,
    name_match_score: round4(nameScore),
    risk_category,
    risk_basis,
    rekyc_due_date,
    rules: trace,
    name_scores: nameScores.map((n) => ({ ...n, score: round4(n.score) })),
    selected_documents: {
      PAN: selected.PAN?.doc_id ?? null,
      AADHAAR: selected.AADHAAR?.doc_id ?? null,
      ADDRESS_PROOF: selected.ADDRESS?.doc_id ?? null,
    },
    watchlist: { sanctions, pep },
  };
}

// re-exported for tests
export { addDays };
