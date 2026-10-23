// Pure rules-engine tests: no database, no HTTP. `npm run test:rules` runs only this file.
// Organised by the case document (Section 6.1): definitions, then R1 ... R17, precedence, risk / re-KYC, configuration.
import { describe, expect, it } from 'vitest';
import { evaluate, RULES, selectDocuments } from '../src/services/kyc/rules.js';
import { levenshtein, nameSimilarity, normalizeName, round4 } from '../src/services/kyc/names.js';
import { screenAgainst } from '../src/services/kyc/screening.js';
import { DEFAULT_RULE_CONFIG, buildConfig, mapConfigFile } from '../src/services/kyc/config.js';
import { addYears, ageOn, daysBetween, parseDate } from '../src/utils/dates.js';
import { maskPan, maskPanDeep } from '../src/utils/mask.js';

const TODAY = '2026-03-04';
const f = (value, confidence = 0.96) => ({ value, confidence });

const baseApp = (over = {}) => ({
  application_id: 'T1', full_name: 'Ravi Kumar Sharma', dob: '1990-05-15', pan_number: 'ZZKPS1234Q', aadhaar_last4: '4821',
  pincode: '400001', occupation_code: 'SALARIED_PRIVATE', annual_income: 900000, application_date: TODAY, ...over,
});
const doc = (doc_id, type, fields, top = {}) => ({
  doc_id, declared_type: type, classified_type: type, classification_confidence: 0.98, fields, ...top,
});
const pan = (over = {}, top = {}) => doc('D1', 'PAN_CARD', { name: f('RAVI KUMAR SHARMA'), dob: f('1990-05-15'), pan_number: f('ZZKPS1234Q'), ...over }, top);
const aadhaar = (over = {}, top = {}) => doc('D2', 'AADHAAR_CARD', { name: f('RAVI KUMAR SHARMA'), dob: f('1990-05-15'), gender: f('MALE'), aadhaar_last4: f('4821'), ...over }, top);
const bill = (over = {}, top = {}) => doc('D3', 'ELECTRICITY_BILL', { pincode: f('400001'), document_date: f('2026-02-12'), ...over }, top);
const statement = (over = {}, top = {}) => doc('D3', 'BANK_STATEMENT', { pincode: f('400001'), document_date: f('2026-02-12'), ...over }, top);
const licence = (over = {}, top = {}) => doc('D3', 'DRIVING_LICENCE', { pincode: f('400001'), valid_until: f('2030-01-01'), ...over }, top);

const refs = {
  sanctions: [
    { id: 1, list_id: 'SAN0002', name: 'Valko Quillon', aliases: ['V Quillon'], dob: '1986-02-23' },
    { id: 2, list_id: 'SAN0003', name: 'Teodor Marchek', aliases: [], dob: null },
  ],
  pep: [{ id: 1, pep_id: 'PEP0001', name: 'Zoya Menon', aliases: [], dob: '1982-10-15', position: 'MLA' }],
  existingPans: new Map([['ZZDPP5555D', { customer_id: 'C0000101' }]]),
  occupations: new Map([['jeweller_bullion_dealer', 'HIGH'], ['business_owner', 'MEDIUM'], ['salaried_private', 'LOW'], ['student', 'LOW']]),
};
const run = (app = {}, docs = [pan(), aadhaar(), bill()], cfg = {}) => evaluate(baseApp(app), docs, refs, cfg);
const codes = (r) => r.reason_codes;
const rule = (r, id) => r.rules.find((x) => x.rule === id);

describe('name normalisation and similarity (case Section 6.1)', () => {
  it('worked example 4: "Ravi Kumar Sharma" vs "Ravi K Sharma" = 0.7647', () => {
    expect(normalizeName('Ravi Kumar Sharma')).toBe('KUMAR RAVI SHARMA');
    expect(normalizeName('Ravi K Sharma')).toBe('K RAVI SHARMA');
    expect(levenshtein('KUMAR RAVI SHARMA', 'K RAVI SHARMA')).toBe(4);
    const s = nameSimilarity('Ravi Kumar Sharma', 'Ravi K Sharma');
    expect(round4(s)).toBe(0.7647);
    expect(s).toBe(1 - 4 / 17);
  });
  it('upper case; "." and "-" become spaces; other characters are removed; titles dropped; tokens sorted', () => {
    expect(normalizeName('Dr. R.K. Sharma')).toBe('K R SHARMA');
    expect(normalizeName('  mrs  Asha-Verma  ')).toBe('ASHA VERMA');
    expect(normalizeName("O'Neil 3rd")).toBe('ONEIL RD');
    expect(normalizeName('Shri Smt Kumari Miss Ms Mr Anita')).toBe('ANITA');
    expect(nameSimilarity('Verma, Asha', 'MRS. ASHA VERMA')).toBe(1);
  });
  it('accented letters are removed, not folded (only A-Z and space survive)', () => {
    expect(normalizeName('José')).toBe('JOS');
  });
  it('two empty normalised names are identical (1.0); one empty is 0', () => {
    expect(nameSimilarity('Mr.', 'Dr')).toBe(1);
    expect(nameSimilarity('Mr.', 'Asha')).toBe(0);
  });
  it('levenshtein basics', () => {
    expect(levenshtein('KITTEN', 'SITTING')).toBe(3);
    expect(levenshtein('', 'ABC')).toBe(3);
    expect(levenshtein('SAME', 'SAME')).toBe(0);
  });
});

describe('document selection', () => {
  it('uses the CLASSIFIED type and the lowest doc_id; the address proof is the lowest among the three address types', () => {
    const docs = [
      doc('D9', 'PAN_CARD', {}),
      doc('D10', 'PAN_CARD', {}),
      doc('D4', 'BANK_STATEMENT', {}),
      doc('D20', 'DRIVING_LICENCE', {}),
      doc('D3', 'ELECTRICITY_BILL', {}),
      doc('D5', 'AADHAAR_CARD', {}),
    ];
    const s = selectDocuments(docs);
    expect(s.PAN.doc_id).toBe('D9'); // numeric-aware: D9 < D10
    expect(s.AADHAAR.doc_id).toBe('D5');
    expect(s.ADDRESS.doc_id).toBe('D3');
  });
  it('a file declared as Aadhaar but classified BANK_STATEMENT is an address proof, not an Aadhaar card', () => {
    const s = selectDocuments([pan(), doc('D2', 'AADHAAR_CARD', {}, { classified_type: 'BANK_STATEMENT' })]);
    expect(s.AADHAAR).toBeNull();
    expect(s.ADDRESS.doc_id).toBe('D2');
  });
  it('OTHER documents are never selected', () => {
    expect(selectDocuments([doc('D1', 'PAN_CARD', {}, { classified_type: 'OTHER' })]).PAN).toBeNull();
  });
});

describe('clean application (worked example 1)', () => {
  const r = run();
  it('APPROVE, no reason codes, score 1.0000, LOW, re-KYC in 10 years', () => {
    expect(r.decision).toBe('APPROVE');
    expect(codes(r)).toEqual([]);
    expect(r.name_match_score).toBe(1);
    expect(r.risk_category).toBe('LOW');
    expect(r.rekyc_due_date).toBe('2036-03-04');
  });
  it('returns a trace entry for every one of the 17 rules, in order', () => {
    expect(RULES.map((x) => x.rule)).toEqual(Array.from({ length: 17 }, (_, i) => `R${i + 1}`));
    expect(r.rules.map((x) => x.rule)).toEqual(RULES.map((x) => x.rule));
    expect(r.rules.every((x) => x.status === 'PASSED' || x.status === 'NOT_EVALUATED')).toBe(true);
  });
});

describe('R1 DOCUMENT_MISSING', () => {
  it('no Aadhaar card', () => expect(codes(run({}, [pan(), bill()]))).toEqual(['DOCUMENT_MISSING']));
  it('no PAN card', () => expect(codes(run({}, [aadhaar(), bill()]))).toEqual(['DOCUMENT_MISSING']));
  it('no address proof', () => expect(codes(run({}, [pan(), aadhaar()]))).toEqual(['DOCUMENT_MISSING']));
  it('a document whose doc_type confidence is below 0.80 is not usable (assumption A-R1) and also triggers R3', () => {
    expect(codes(run({}, [pan(), aadhaar(), bill({}, { classification_confidence: 0.75 })]))).toEqual(['DOCUMENT_MISSING', 'LOW_EXTRACTION_CONFIDENCE']);
  });
  it('worked example 8: the file declared AADHAAR_CARD is a bank statement -> DOCUMENT_MISSING|DOCUMENT_TYPE_MISMATCH, score from PAN only', () => {
    const wrong = doc('D2', 'AADHAAR_CARD', { name: f('RAVI KUMAR SHARMA'), pincode: f('400001'), document_date: f('2026-02-12') }, { classified_type: 'BANK_STATEMENT' });
    const r = run({}, [pan(), wrong, bill({}, { doc_id: 'D4' })]);
    expect(codes(r)).toEqual(['DOCUMENT_MISSING', 'DOCUMENT_TYPE_MISMATCH']);
    expect(r.decision).toBe('REVIEW');
    expect(r.name_match_score).toBe(1);
    expect(r.risk_category).toBe('LOW');
  });
});

describe('R2 DOCUMENT_TYPE_MISMATCH', () => {
  it('any document, selected or not, whose classified type differs from the declared type', () => {
    const extra = doc('D9', 'BANK_STATEMENT', {}, { classified_type: 'OTHER', classification_confidence: 0.9 });
    expect(codes(run({}, [pan(), aadhaar(), bill(), extra]))).toEqual(['DOCUMENT_TYPE_MISMATCH']);
  });
  it('a bill classified as a bank statement is still an address proof but is a mismatch', () => {
    expect(codes(run({}, [pan(), aadhaar(), bill({}, { classified_type: 'BANK_STATEMENT' })]))).toEqual(['DOCUMENT_TYPE_MISMATCH']);
  });
});

describe('R3 LOW_EXTRACTION_CONFIDENCE', () => {
  it('any document with doc_type confidence below 0.80 (even an unselected one)', () => {
    const extra = doc('D9', 'ELECTRICITY_BILL', {}, { classification_confidence: 0.5 });
    expect(codes(run({}, [pan(), aadhaar(), bill(), extra]))).toContain('LOW_EXTRACTION_CONFIDENCE');
  });
  it('0.80 exactly is fine', () => {
    expect(codes(run({}, [pan({}, { classification_confidence: 0.8 }), aadhaar(), bill()]))).toEqual([]);
  });
  it('a required field of a selected document that is missing, empty or below 0.80', () => {
    expect(codes(run({}, [pan({ pan_number: undefined }), aadhaar(), bill()]))).toEqual(['LOW_EXTRACTION_CONFIDENCE']);
    expect(codes(run({}, [pan({ name: f('') }), aadhaar(), bill()]))).toEqual(['LOW_EXTRACTION_CONFIDENCE']);
    expect(codes(run({}, [pan(), aadhaar({ aadhaar_last4: f('4821', 0.79) }), bill()]))).toEqual(['LOW_EXTRACTION_CONFIDENCE']);
    expect(codes(run({}, [pan(), aadhaar(), bill({ document_date: undefined })]))).toEqual(['LOW_EXTRACTION_CONFIDENCE']);
    expect(codes(run({}, [pan(), aadhaar(), licence({ valid_until: undefined })]))).toEqual(['LOW_EXTRACTION_CONFIDENCE']);
  });
  it('fields that are not required (gender, address) never trigger it', () => {
    expect(codes(run({}, [pan(), aadhaar({ gender: f('MALE', 0.1) }), bill()]))).toEqual([]);
  });
  it('worked example 9: pan_number read with confidence 0.62 -> R3 only; R6 is NOT evaluated', () => {
    const r = run({}, [pan({ pan_number: f('ZZTP59O12Y', 0.62) }), aadhaar(), bill()]);
    expect(codes(r)).toEqual(['LOW_EXTRACTION_CONFIDENCE']);
    expect(rule(r, 'R6').status).toBe('NOT_EVALUATED');
    expect(r.decision).toBe('REVIEW');
  });
  it('the same misread at confidence 0.80 or more is a usable value and gives PAN_MISMATCH (REJECT)', () => {
    const r = run({}, [pan({ pan_number: f('ZZTP59O12Y', 0.8) }), aadhaar(), bill()]);
    expect(codes(r)).toEqual(['PAN_MISMATCH']);
    expect(r.decision).toBe('REJECT');
  });
});

describe('R4 AGE_BELOW_18', () => {
  it('17 -> REJECT; risk and re-KYC empty; the score is still reported (example 2)', () => {
    const r = run({ dob: '2008-09-10' }, [pan({ dob: f('2008-09-10') }), aadhaar({ dob: f('2008-09-10') }), bill()]);
    expect(codes(r)).toEqual(['AGE_BELOW_18']);
    expect(r.decision).toBe('REJECT');
    expect(r.name_match_score).toBe(1);
    expect(r.risk_category).toBeNull();
    expect(r.rekyc_due_date).toBeNull();
  });
  it('exactly 18 today is fine; turning 18 tomorrow is not', () => {
    const d = (dob) => run({ dob }, [pan({ dob: f(dob) }), aadhaar({ dob: f(dob) }), bill()]);
    expect(codes(d('2008-03-04'))).toEqual([]);
    expect(codes(d('2008-03-05'))).toEqual(['AGE_BELOW_18']);
  });
});

describe('R5 PAN_INVALID', () => {
  const withPan = (p, docPan = p) => run({ pan_number: p }, [pan({ pan_number: f(docPan) }), aadhaar(), bill()]);
  it('4th character must be P', () => expect(codes(withPan('ZZKCS1234Q'))).toEqual(['PAN_INVALID']));
  it('format must be AAAAA9999A', () => {
    expect(codes(withPan('ZZKPS12345'))).toEqual(['PAN_INVALID']);
    expect(codes(withPan('zzkps1234q'))).toContain('PAN_INVALID'); // judged exactly as declared (the API upper-cases input first)
  });
  it('a malformed declared PAN that also differs from the card gives PAN_INVALID|PAN_MISMATCH in rule order', () => {
    expect(codes(withPan('ZZKPS12345', 'ZZKPS1234Q'))).toEqual(['PAN_INVALID', 'PAN_MISMATCH']);
  });
});

describe('R6 PAN_MISMATCH, R7 DOB_MISMATCH, R8 AADHAAR_MISMATCH (usable fields only)', () => {
  it('worked example 3: card shows ZZMPN3465S, declared ZZMPN3456S', () => {
    const r = run({ pan_number: 'ZZMPN3456S' }, [pan({ pan_number: f('ZZMPN3465S') }), aadhaar(), bill()]);
    expect(codes(r)).toEqual(['PAN_MISMATCH']);
    expect(r.decision).toBe('REJECT');
    expect(r.risk_category).toBeNull();
  });
  it('R7 on the Aadhaar card, and on the PAN card', () => {
    expect(codes(run({}, [pan(), aadhaar({ dob: f('1991-01-01') }), bill()]))).toEqual(['DOB_MISMATCH']);
    expect(codes(run({}, [pan({ dob: f('1991-01-01') }), aadhaar(), bill()]))).toEqual(['DOB_MISMATCH']);
  });
  it('R7 / R8 are not evaluated for an unusable field, so a misread cannot reject', () => {
    const r = run({}, [pan({ dob: f('1999-09-09', 0.55) }), aadhaar({ aadhaar_last4: f('0000', 0.7) }), bill()]);
    expect(codes(r)).toEqual(['LOW_EXTRACTION_CONFIDENCE']);
    expect(rule(r, 'R8').status).toBe('NOT_EVALUATED');
    expect(rule(r, 'R7').status).toBe('PASSED'); // the Aadhaar dob was usable and equal
  });
  it('R8 last four digits', () => {
    expect(codes(run({}, [pan(), aadhaar({ aadhaar_last4: f('0000') }), bill()]))).toEqual(['AADHAAR_MISMATCH']);
  });
  it('all three together keep rule order', () => {
    const r = run({}, [pan({ pan_number: f('ZZQPQ0000Q') }), aadhaar({ dob: f('1960-01-01'), aadhaar_last4: f('0001') }), bill()]);
    expect(codes(r)).toEqual(['PAN_MISMATCH', 'DOB_MISMATCH', 'AADHAAR_MISMATCH']);
  });
});

describe('R9 NAME_MISMATCH / R11 NAME_MISMATCH_MINOR (exact thresholds)', () => {
  const named = (declared, onCard) => run({ full_name: declared }, [pan({ name: f(onCard) }), aadhaar({ name: f(onCard) }), bill()]);
  it('worked example 4: score 0.7647 -> REVIEW', () => {
    const r = run({}, [pan({ name: f('RAVI K SHARMA') }), aadhaar(), bill()]);
    expect(r.name_match_score).toBe(0.7647);
    expect(codes(r)).toEqual(['NAME_MISMATCH_MINOR']);
    expect(r.decision).toBe('REVIEW');
    expect(r.risk_category).toBe('LOW');
    expect(r.rekyc_due_date).toBe('2036-03-04');
  });
  it('exactly 0.75 is REVIEW, not REJECT', () => {
    const r = named('Anil Roy', 'ANIK ROX');
    expect(r.name_match_score).toBe(0.75);
    expect(codes(r)).toEqual(['NAME_MISMATCH_MINOR']);
  });
  it('below 0.75 is REJECT', () => {
    const r = named('Ravi Kumar Sharma', 'SURESH VERMA');
    expect(r.name_match_score).toBeLessThan(0.75);
    expect(codes(r)).toEqual(['NAME_MISMATCH']);
    expect(r.decision).toBe('REJECT');
  });
  it('exactly 0.90 passes', () => {
    const r = named('Sunil Bose', 'SUNIL BOSA');
    expect(r.name_match_score).toBe(0.9);
    expect(codes(r)).toEqual([]);
  });
  it('the score is the LOWEST of the PAN card and the Aadhaar card', () => {
    const r = run({}, [pan(), aadhaar({ name: f('RAVI K SHARMA') }), bill()]);
    expect(r.name_match_score).toBe(0.7647);
    expect(r.name_scores.map((n) => n.source)).toEqual(['PAN_CARD', 'AADHAAR_CARD']);
  });
  it('a low-confidence name is not used; with neither usable the score is empty and R9/R11 are not evaluated', () => {
    const one = run({}, [pan({ name: f('SOMEONE ELSE', 0.5) }), aadhaar(), bill()]);
    expect(one.name_match_score).toBe(1);
    expect(codes(one)).toEqual(['LOW_EXTRACTION_CONFIDENCE']);
    const none = run({}, [pan({ name: f('X', 0.5) }), aadhaar({ name: f('Y', 0.5) }), bill()]);
    expect(none.name_match_score).toBeNull();
    expect(rule(none, 'R9').status).toBe('NOT_EVALUATED');
    expect(rule(none, 'R11').status).toBe('NOT_EVALUATED');
  });
});

describe('screening bands (case Section 6.1)', () => {
  const cfg = buildConfig();
  const entries = [{ id: 1, list_id: 'X1', name: 'Valko Quillon', aliases: ['V Quillon'], dob: '1986-02-23' }, { id: 2, list_id: 'X2', name: 'Teodor Marchek', aliases: [], dob: null }];
  const status = (name, dob) => screenAgainst(name, dob, entries, cfg).status;
  it('MATCH: similarity >= 0.90 and the entry dob is equal or empty', () => {
    expect(status('Valko Quillon', '1986-02-23')).toBe('MATCH');
    expect(status('Teodor Marchek', '2001-01-01')).toBe('MATCH');
  });
  it('matches on an alias', () => expect(status('V Quillon', '1986-02-23')).toBe('MATCH'));
  it('POSSIBLE: similarity >= 0.90 with a different dob', () => expect(status('Valko Quillon', '1990-01-01')).toBe('POSSIBLE'));
  it('POSSIBLE: similarity from 0.80 to below 0.90, whatever the dob', () => {
    expect(status('Valka Quillen', '1986-02-23')).toBe('POSSIBLE');
    expect(status('Valka Quillen', '1999-09-09')).toBe('POSSIBLE');
  });
  it('CLEAR below 0.80', () => expect(status('Anita Rao', '1986-02-23')).toBe('CLEAR'));
  it('hits carry the entry, similarity and the dob comparison (FR-5)', () => {
    const h = screenAgainst('Valko Quillon', '1990-01-01', entries, cfg).hits[0];
    expect(h).toMatchObject({ entry_id: 'X1', score: 1, list_dob: '1986-02-23', dob_status: 'DIFFERENT', status: 'POSSIBLE' });
  });
});

describe('R10 SANCTIONS_MATCH / R15 SANCTIONS_POSSIBLE_MATCH / R16 PEP_MATCH', () => {
  const asApplicant = (full_name, dob, extra = {}) => run({ full_name, dob, ...extra }, [pan({ name: f(full_name.toUpperCase()), dob: f(dob) }), aadhaar({ name: f(full_name.toUpperCase()), dob: f(dob) }), bill()]);
  it('worked example 6: Valko Quillon 1986-02-23 equals SAN0002 -> REJECT', () => {
    const r = asApplicant('Valko Quillon', '1986-02-23');
    expect(codes(r)).toEqual(['SANCTIONS_MATCH']);
    expect(r.decision).toBe('REJECT');
    expect(r.watchlist.sanctions.hits[0].entry_id).toBe('SAN0002');
  });
  it('an entry without a dob matches on the name alone', () => expect(codes(asApplicant('Teodor Marchek', '1980-06-06'))).toEqual(['SANCTIONS_MATCH']));
  it('same name, different dob -> REVIEW with HIGH risk and re-KYC in 2 years', () => {
    const r = asApplicant('Valko Quillon', '1990-01-01');
    expect(codes(r)).toEqual(['SANCTIONS_POSSIBLE_MATCH']);
    expect(r.decision).toBe('REVIEW');
    expect(r.risk_category).toBe('HIGH');
    expect(r.rekyc_due_date).toBe('2028-03-04');
  });
  it('worked example 7: Zoya Menon 1982-10-15 equals PEP0001 -> REVIEW, HIGH, 2028-03-04', () => {
    const r = asApplicant('Zoya Menon', '1982-10-15');
    expect(codes(r)).toEqual(['PEP_MATCH']);
    expect(r.decision).toBe('REVIEW');
    expect(r.risk_category).toBe('HIGH');
    expect(r.rekyc_due_date).toBe('2028-03-04');
    expect(r.watchlist.pep.hits[0].entry_id).toBe('PEP0001');
  });
  it('a POSSIBLE PEP result is evidence only: no rule fires', () => {
    const r = asApplicant('Zoya Menon', '1999-01-01');
    expect(codes(r)).toEqual([]);
    expect(r.watchlist.pep.status).toBe('POSSIBLE');
    expect(r.risk_category).toBe('LOW');
  });
  it('under 18 AND a PEP match: REJECT wins, both codes are listed in rule order, risk and re-KYC are empty', () => {
    const r = run({ full_name: 'Zoya Menon', dob: '2009-10-15' }, [pan({ name: f('ZOYA MENON'), dob: f('2009-10-15') }), aadhaar({ name: f('ZOYA MENON'), dob: f('2009-10-15') }), bill()], {});
    expect(codes(r)).toEqual(['AGE_BELOW_18']); // the dob differs from PEP0001, so the PEP result is only POSSIBLE
    const mixed = run({ full_name: 'Teodor Marchek', dob: '2009-10-15' }, [pan({ name: f('TEODOR MARCHEK'), dob: f('2009-10-15') }), aadhaar({ name: f('TEODOR MARCHEK'), dob: f('2009-10-15') }), bill()]);
    expect(codes(mixed)).toEqual(['AGE_BELOW_18', 'SANCTIONS_MATCH']);
    expect([mixed.decision, mixed.risk_category, mixed.rekyc_due_date]).toEqual(['REJECT', null, null]);
  });
});

describe('R12 DOCUMENT_EXPIRED, R13 ADDRESS_PROOF_STALE, R14 ADDRESS_MISMATCH', () => {
  it('R12: driving licence valid_until before the application date', () => {
    expect(codes(run({}, [pan(), aadhaar(), licence({ valid_until: f('2026-03-03') })]))).toEqual(['DOCUMENT_EXPIRED']);
    expect(codes(run({}, [pan(), aadhaar(), licence({ valid_until: f('2026-03-04') })]))).toEqual([]);
  });
  it('R12 does not apply to a bill; R13 does not apply to a licence', () => {
    const r = run({}, [pan(), aadhaar(), licence()]);
    expect(rule(r, 'R13').status).toBe('NOT_EVALUATED');
    expect(rule(run(), 'R12').status).toBe('NOT_EVALUATED');
  });
  it('R13: 90 days is fine, 91 is stale, a future date is stale; also for bank statements', () => {
    expect(codes(run({}, [pan(), aadhaar(), bill({ document_date: f('2025-12-04') })]))).toEqual([]); // exactly 90 days
    expect(codes(run({}, [pan(), aadhaar(), bill({ document_date: f('2025-12-03') })]))).toEqual(['ADDRESS_PROOF_STALE']);
    expect(codes(run({}, [pan(), aadhaar(), statement({ document_date: f('2026-03-05') })]))).toEqual(['ADDRESS_PROOF_STALE']);
    expect(codes(run({}, [pan(), aadhaar(), statement({ document_date: f('2026-03-04') })]))).toEqual([]);
  });
  it('worked example 5: bill dated 2025-11-04 (120 days) -> ADDRESS_PROOF_STALE, score 1.0000, LOW', () => {
    const r = run({}, [pan(), aadhaar(), bill({ document_date: f('2025-11-04') })]);
    expect(codes(r)).toEqual(['ADDRESS_PROOF_STALE']);
    expect(r.name_match_score).toBe(1);
    expect(r.risk_category).toBe('LOW');
  });
  it('R14: pincode differs; an unusable pincode is not evaluated (R3 instead)', () => {
    expect(codes(run({}, [pan(), aadhaar(), bill({ pincode: f('560001') })]))).toEqual(['ADDRESS_MISMATCH']);
    const r = run({}, [pan(), aadhaar(), bill({ pincode: f('560001', 0.6) })]);
    expect(codes(r)).toEqual(['LOW_EXTRACTION_CONFIDENCE']);
    expect(rule(r, 'R14').status).toBe('NOT_EVALUATED');
  });
  it('the address proof used is the lowest doc_id among the three types', () => {
    const early = doc('D0', 'BANK_STATEMENT', { pincode: f('560001'), document_date: f('2026-02-12') });
    expect(codes(run({}, [pan(), aadhaar(), bill(), early]))).toEqual(['ADDRESS_MISMATCH']);
  });
});

describe('R17 DUPLICATE_CUSTOMER', () => {
  it('the declared PAN exists in existing_customers', () => {
    const r = run({ pan_number: 'ZZDPP5555D' }, [pan({ pan_number: f('ZZDPP5555D') }), aadhaar(), bill()]);
    expect(codes(r)).toEqual(['DUPLICATE_CUSTOMER']);
    expect(r.decision).toBe('REVIEW');
  });
});

describe('decision precedence, order of codes, determinism', () => {
  it('REJECT beats REVIEW and every triggered code is returned in rule order', () => {
    const mixed = run({}, [pan({ pan_number: f('ZZQPQ0000Q') }), aadhaar(), bill({ document_date: f('2025-11-04') })]);
    expect(codes(mixed)).toEqual(['PAN_MISMATCH', 'ADDRESS_PROOF_STALE']);
    expect(mixed.decision).toBe('REJECT');
    expect(mixed.risk_category).toBeNull();
  });
  it('no short-circuit: all of R1 to R3 plus later rules are evaluated together', () => {
    const r = run({}, [], {});
    expect(codes(r)).toEqual(['DOCUMENT_MISSING']);
    expect(r.name_match_score).toBeNull();
  });
  it('nothing extracted at all (unknown documents): R1, R2 and R3 together', () => {
    const unknown = (id, type) => doc(id, type, {}, { classified_type: 'OTHER', classification_confidence: 0 });
    const r = run({}, [unknown('D1', 'PAN_CARD'), unknown('D2', 'AADHAAR_CARD'), unknown('D3', 'ELECTRICITY_BILL')]);
    expect(codes(r)).toEqual(['DOCUMENT_MISSING', 'DOCUMENT_TYPE_MISMATCH', 'LOW_EXTRACTION_CONFIDENCE']);
    expect(r.name_match_score).toBeNull();
    expect(r.risk_category).toBe('LOW');
  });
  it('same input, same output', () => {
    const docs = [pan({ name: f('RAVI K SHARMA') }), aadhaar(), bill()];
    expect(JSON.stringify(run({}, docs))).toBe(JSON.stringify(run({}, docs)));
  });
  it('two PAN cards: the lowest doc_id wins and the later one is ignored', () => {
    const second = doc('D8', 'PAN_CARD', { name: f('SOMEONE ELSE'), dob: f('1970-01-01'), pan_number: f('ZZXPE0001X') });
    expect(codes(run({}, [second, pan(), aadhaar(), bill()]))).toEqual([]);
  });
});

describe('risk category and re-KYC date (Additional Rules)', () => {
  const risk = (app, docs) => run(app, docs || [pan(), aadhaar(), bill()]);
  it('HIGH occupation -> HIGH, 2 years (example 10 with a driving licence)', () => {
    const r = risk({ occupation_code: 'JEWELLER_BULLION_DEALER' }, [pan(), aadhaar(), licence()]);
    expect(r.decision).toBe('APPROVE');
    expect(r.risk_category).toBe('HIGH');
    expect(r.rekyc_due_date).toBe('2028-03-04');
  });
  it('MEDIUM occupation -> MEDIUM, 8 years', () => {
    const r = risk({ occupation_code: 'BUSINESS_OWNER' });
    expect([r.risk_category, r.rekyc_due_date]).toEqual(['MEDIUM', '2034-03-04']);
  });
  it('income exactly Rs 25,00,000 is MEDIUM; one rupee less is LOW', () => {
    expect(risk({ annual_income: 2500000 }).risk_category).toBe('MEDIUM');
    expect(risk({ annual_income: 2499999 }).risk_category).toBe('LOW');
  });
  it('HIGH wins over MEDIUM; PEP and possible sanctions force HIGH', () => {
    expect(risk({ occupation_code: 'JEWELLER_BULLION_DEALER', annual_income: 9000000 }).risk_category).toBe('HIGH');
  });
  it('29 February moves to 28 February', () => {
    expect(addYears('2028-02-29', 10)).toBe('2038-02-28');
    expect(addYears('2028-02-29', 2)).toBe('2030-02-28');
    expect(addYears('2028-02-29', 4)).toBe('2032-02-29');
    const r = risk({ application_date: '2028-02-29' }, [pan(), aadhaar(), bill({ document_date: f('2028-02-09') })]);
    expect(r.rekyc_due_date).toBe('2038-02-28');
  });
  it('an occupation code that is not in the table gets unknown_occupation_risk (LOW)', () => {
    expect(risk({ occupation_code: 'NOT_LISTED' }).risk_category).toBe('LOW');
  });
  it('REVIEW cases also get a risk category and a re-KYC date; REJECT cases do not', () => {
    const review = risk({}, [pan({ name: f('RAVI K SHARMA') }), aadhaar(), bill()]);
    expect([review.decision, review.risk_category, review.rekyc_due_date]).toEqual(['REVIEW', 'LOW', '2036-03-04']);
    const reject = risk({ dob: '2010-01-01' });
    expect([reject.decision, reject.risk_category, reject.rekyc_due_date]).toEqual(['REJECT', null, null]);
  });
});

describe('configuration, not code constants (FR-4)', () => {
  const docs = () => [pan({ name: f('RAVI K SHARMA') }), aadhaar({ name: f('RAVI K SHARMA') }), bill()];
  it('changing name_match_threshold changes the decision with no code change', () => {
    expect(run({}, docs()).decision).toBe('REVIEW');
    expect(run({}, docs(), { name_match_threshold: 0.76 }).decision).toBe('APPROVE');
    expect(run({}, docs(), { name_reject_threshold: 0.8, name_match_threshold: 0.9 }).decision).toBe('REJECT');
  });
  it('min_field_confidence, min_age, address_proof_max_age_days, rekyc_years, medium_income_threshold, title tokens, PAN pattern', () => {
    expect(codes(run({}, [pan({ name: f('RAVI KUMAR SHARMA', 0.85) }), aadhaar(), bill()], { min_field_confidence: 0.9 }))).toContain('LOW_EXTRACTION_CONFIDENCE');
    expect(codes(run({ dob: '2010-01-01' }, [pan({ dob: f('2010-01-01') }), aadhaar({ dob: f('2010-01-01') }), bill()], { min_age: 15 }))).toEqual([]);
    expect(codes(run({}, [pan(), aadhaar(), bill({ document_date: f('2025-12-03') })], { address_proof_max_age_days: 91 }))).toEqual([]);
    expect(run({}, undefined, { rekyc_years: { HIGH: 1, MEDIUM: 5, LOW: 6 } }).rekyc_due_date).toBe('2032-03-04');
    expect(run({ annual_income: 1000000 }, undefined, { medium_income_threshold: 1000000 }).risk_category).toBe('MEDIUM');
    expect(run({ full_name: 'Sri Ravi Kumar Sharma' }).name_match_score).toBeLessThan(1);
    expect(run({ full_name: 'Sri Ravi Kumar Sharma' }, undefined, { name_title_tokens: [...DEFAULT_RULE_CONFIG.name_title_tokens, 'SRI'] }).name_match_score).toBe(1);
    expect(codes(run({ pan_number: 'ZZKCS1234Q' }, [pan({ pan_number: f('ZZKCS1234Q') }), aadhaar(), bill()], { pan_holder_char: 'C' }))).toEqual([]);
  });
  it('watchlist thresholds are configurable', () => {
    const base = () => run({ full_name: 'Valka Quillen', dob: '1986-02-23' }, [pan({ name: f('VALKA QUILLEN'), dob: f('1986-02-23') }), aadhaar({ name: f('VALKA QUILLEN'), dob: f('1986-02-23') }), bill()]);
    expect(codes(base())).toEqual(['SANCTIONS_POSSIBLE_MATCH']);
    expect(codes(run({ full_name: 'Valka Quillen', dob: '1986-02-23' }, [pan({ name: f('VALKA QUILLEN'), dob: f('1986-02-23') }), aadhaar({ name: f('VALKA QUILLEN'), dob: f('1986-02-23') }), bill()], { watchlist_possible_threshold: 0.9 }))).toEqual([]);
  });
  it('invalid values and unknown keys fall back to the defaults', () => {
    const cfg = buildConfig({ min_field_confidence: 7, nonsense: 1, name_reject_threshold: 0.95 });
    expect(cfg.min_field_confidence).toBe(0.8);
    expect(cfg.name_reject_threshold).toBe(0.75); // a reject threshold above the pass threshold is refused as a pair
    expect('nonsense' in cfg).toBe(false);
  });
  it('defaults are exactly the case document table', () => {
    expect(DEFAULT_RULE_CONFIG).toMatchObject({
      min_field_confidence: 0.8, name_match_threshold: 0.9, name_reject_threshold: 0.75, watchlist_match_threshold: 0.9,
      watchlist_possible_threshold: 0.8, min_age: 18, address_proof_max_age_days: 90, medium_income_threshold: 2500000,
      rekyc_years: { HIGH: 2, MEDIUM: 8, LOW: 10 }, resubmission_window_days: 7, checker_sla_hours: 24, pan_holder_char: 'P',
      name_title_tokens: ['MR', 'MRS', 'MS', 'MISS', 'DR', 'SHRI', 'SMT', 'KUMARI'],
    });
  });
});

describe('reading a rules_config JSON with unknown key spellings', () => {
  it('maps common spellings, nested objects and rekyc periods; reports what it could not read', () => {
    const { overrides, ignored } = mapConfigFile({
      min_field_confidence: 0.85,
      name_match: { pass_threshold: 0.92, reject_below: 0.7 },
      watchlist: { match_threshold: 0.95, possible_match_threshold: 0.85 },
      minimum_age: 21,
      address_proof_max_age_days: 60,
      title_tokens: ['MR', 'DR'],
      medium_risk_income_threshold: 3000000,
      rekyc_years: { HIGH: 3, MEDIUM: 6, LOW: 9 },
      checker_sla_hours: 12,
      something_new: 1,
    });
    expect(overrides).toMatchObject({
      min_field_confidence: 0.85, name_match_threshold: 0.92, name_reject_threshold: 0.7, watchlist_match_threshold: 0.95,
      watchlist_possible_threshold: 0.85, min_age: 21, address_proof_max_age_days: 60, name_title_tokens: ['MR', 'DR'],
      medium_income_threshold: 3000000, rekyc_years: { HIGH: 3, MEDIUM: 6, LOW: 9 }, checker_sla_hours: 12,
    });
    expect(ignored).toContain('something_new');
  });
});

describe('dates and masking', () => {
  it('calendar-date helpers', () => {
    expect(parseDate('05/03/2026')).toBe('2026-03-05');
    expect(parseDate('05-Mar-2026')).toBe('2026-03-05');
    expect(parseDate('31/02/2026')).toBeNull();
    expect(ageOn('2008-03-05', '2026-03-04')).toBe(17);
    expect(ageOn('2008-03-04', '2026-03-04')).toBe(18);
    expect(daysBetween('2025-12-04', '2026-03-04')).toBe(90);
  });
  it('PAN is masked as ZZKXXXXX4Q in lists, logs and exports', () => {
    expect(maskPan('ZZKPS1234Q')).toBe('ZZKXXXXX4Q');
    expect(maskPanDeep({ pan_number: 'ZZKPS1234Q', note: 'PAN ZZKPS1234Q here', field: 'x' })).toEqual({ pan_number: 'ZZKXXXXX4Q', note: 'PAN ZZKXXXXX4Q here', field: 'x' });
    expect(maskPanDeep({ field: 'pan_number', value: 'ZZKPS1234Q' }).value).toBe('ZZKXXXXX4Q');
  });
});
