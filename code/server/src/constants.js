// Shared constants. These strings are part of contract.md - change them only after all 3 teammates agree.
// Owner: Person 1 (integration lead).

export const ROLES = Object.freeze({
  APPLICANT: 'APPLICANT',
  KYC_OFFICER: 'KYC_OFFICER', // maker
  COMPLIANCE_OFFICER: 'COMPLIANCE_OFFICER', // checker
});

export const STATUS = Object.freeze({
  SUBMITTED: 'SUBMITTED',
  EXTRACTING: 'EXTRACTING',
  AUTO_APPROVED: 'AUTO_APPROVED',
  IN_REVIEW: 'IN_REVIEW',
  PENDING_CHECKER: 'PENDING_CHECKER',
  AUTO_REJECTED: 'AUTO_REJECTED',
  RESUBMISSION_REQUESTED: 'RESUBMISSION_REQUESTED',
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED',
  CLOSED_EXPIRED: 'CLOSED_EXPIRED',
});

export const DECISION = Object.freeze({
  APPROVE: 'APPROVE',
  REVIEW: 'REVIEW',
  REJECT: 'REJECT',
});

export const RISK = Object.freeze({ LOW: 'LOW', MEDIUM: 'MEDIUM', HIGH: 'HIGH' });

export const MAKER_RECOMMENDATION = Object.freeze({
  APPROVE: 'APPROVE',
  REJECT: 'REJECT',
  REQUEST_RESUBMISSION: 'REQUEST_RESUBMISSION',
});

export const CHECKER_DECISION = Object.freeze({
  APPROVE: 'APPROVE',
  REJECT: 'REJECT',
  SEND_BACK: 'SEND_BACK',
});

// Allowed status transitions (from the playbook). Terminal statuses never reopen.
export const TRANSITIONS = Object.freeze({
  SUBMITTED: ['EXTRACTING'],
  EXTRACTING: ['AUTO_APPROVED', 'IN_REVIEW', 'PENDING_CHECKER', 'AUTO_REJECTED'],
  IN_REVIEW: ['PENDING_CHECKER', 'RESUBMISSION_REQUESTED'],
  RESUBMISSION_REQUESTED: ['SUBMITTED', 'CLOSED_EXPIRED'],
  PENDING_CHECKER: ['APPROVED', 'REJECTED', 'IN_REVIEW'],
  AUTO_APPROVED: [],
  AUTO_REJECTED: [],
  APPROVED: [],
  REJECTED: [],
  CLOSED_EXPIRED: [],
});

export const TERMINAL_STATUSES = Object.freeze(
  Object.keys(TRANSITIONS).filter((s) => TRANSITIONS[s].length === 0),
);

export function canTransition(from, to) {
  return Boolean(TRANSITIONS[from] && TRANSITIONS[from].includes(to));
}

// Document types (case document, Section 4): the type a customer selects (declared_doc_type) and the type the
// extraction service returns (doc_type) use the same vocabulary. OTHER only ever comes from the extractor.
export const DOC_TYPES = Object.freeze({
  PAN_CARD: 'PAN_CARD',
  AADHAAR_CARD: 'AADHAAR_CARD',
  ELECTRICITY_BILL: 'ELECTRICITY_BILL',
  BANK_STATEMENT: 'BANK_STATEMENT',
  DRIVING_LICENCE: 'DRIVING_LICENCE',
  OTHER: 'OTHER',
});
// What an applicant may choose per uploaded file.
export const DECLARABLE_DOC_TYPES = Object.freeze(Object.values(DOC_TYPES).filter((t) => t !== DOC_TYPES.OTHER));
export const DOC_TYPE_LIST = DECLARABLE_DOC_TYPES;
export const ADDRESS_PROOF_TYPES = Object.freeze([
  DOC_TYPES.ELECTRICITY_BILL,
  DOC_TYPES.BANK_STATEMENT,
  DOC_TYPES.DRIVING_LICENCE,
]);
// Fields the extraction service can return (case document, Section 4 truth-file columns).
export const EXTRACTED_FIELDS = Object.freeze([
  'name', 'dob', 'gender', 'pan_number', 'aadhaar_last4', 'address', 'pincode', 'document_date', 'valid_until',
]);
export const DATE_FIELDS = Object.freeze(['dob', 'document_date', 'valid_until']);

export const AUDIT = Object.freeze({
  USER_REGISTERED: 'USER_REGISTERED',
  LOGIN_SUCCESS: 'LOGIN_SUCCESS',
  LOGIN_FAILED: 'LOGIN_FAILED',
  APPLICATION_CREATED: 'APPLICATION_CREATED',
  DOCUMENT_UPLOADED: 'DOCUMENT_UPLOADED',
  DOCUMENT_VIEWED: 'DOCUMENT_VIEWED',
  // Reserved for later phases (names locked now so nobody invents variants):
  STATUS_CHANGED: 'STATUS_CHANGED',
  FIELD_CORRECTED: 'FIELD_CORRECTED',
  MAKER_RECOMMENDED: 'MAKER_RECOMMENDED',
  CHECKER_DECIDED: 'CHECKER_DECIDED',
  RESUBMITTED: 'RESUBMITTED',
  CONFIG_UPDATED: 'CONFIG_UPDATED',
  WATCHLIST_UPDATED: 'WATCHLIST_UPDATED',
  WATCHLIST_HIT: 'WATCHLIST_HIT',
  CORE_ACCOUNT_CREATED: 'CORE_ACCOUNT_CREATED',
  // Phase 2 / 3
  EVALUATED: 'EVALUATED',
  DOCUMENT_EXTRACTED: 'DOCUMENT_EXTRACTED',
  DOCUMENT_REPLACED: 'DOCUMENT_REPLACED',
  CORE_ACCOUNT_FAILED: 'CORE_ACCOUNT_FAILED',
  APPLICATION_EXPIRED: 'APPLICATION_EXPIRED',
  RESCREEN_RUN: 'RESCREEN_RUN',
  AUDIT_EXPORTED: 'AUDIT_EXPORTED',
});

export const REASON = Object.freeze({
  DOCUMENT_MISSING: 'DOCUMENT_MISSING',
  DOCUMENT_TYPE_MISMATCH: 'DOCUMENT_TYPE_MISMATCH',
  LOW_EXTRACTION_CONFIDENCE: 'LOW_EXTRACTION_CONFIDENCE',
  AGE_BELOW_18: 'AGE_BELOW_18',
  PAN_INVALID: 'PAN_INVALID',
  PAN_MISMATCH: 'PAN_MISMATCH',
  DOB_MISMATCH: 'DOB_MISMATCH',
  AADHAAR_MISMATCH: 'AADHAAR_MISMATCH',
  NAME_MISMATCH: 'NAME_MISMATCH',
  SANCTIONS_MATCH: 'SANCTIONS_MATCH',
  NAME_MISMATCH_MINOR: 'NAME_MISMATCH_MINOR',
  DOCUMENT_EXPIRED: 'DOCUMENT_EXPIRED',
  ADDRESS_PROOF_STALE: 'ADDRESS_PROOF_STALE',
  ADDRESS_MISMATCH: 'ADDRESS_MISMATCH',
  SANCTIONS_POSSIBLE_MATCH: 'SANCTIONS_POSSIBLE_MATCH',
  PEP_MATCH: 'PEP_MATCH',
  DUPLICATE_CUSTOMER: 'DUPLICATE_CUSTOMER',
});

// Reason codes that come from watchlist screening (hidden from applicants).
export const WATCHLIST_REASONS = Object.freeze([REASON.SANCTIONS_MATCH, REASON.SANCTIONS_POSSIBLE_MATCH, REASON.PEP_MATCH]);

// Statuses in which a human is still working on the case (re-screening and queues use these).
export const OPEN_STATUSES = Object.freeze([STATUS.IN_REVIEW, STATUS.PENDING_CHECKER]);

// Engine decision -> application status. Reviewed cases and HIGH-risk approvals always wait for the checker.
export function routeStatus(decision, risk, reviewed = false) {
  if (decision === DECISION.REJECT) return STATUS.AUTO_REJECTED;
  if (decision === DECISION.REVIEW) return STATUS.IN_REVIEW;
  if (reviewed || risk === RISK.HIGH) return STATUS.PENDING_CHECKER;
  return STATUS.AUTO_APPROVED;
}
