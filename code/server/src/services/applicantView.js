// Builds what each role is allowed to see.
//   APPLICANT  : toApplicantView - status, readable reasons, timeline. NEVER watchlist details, confidence or scores.
//   Staff      : toStaffView     - everything, including extracted fields and the full rule trace.
//   Lists      : toListRow       - PAN masked.
import { STATUS } from '../constants.js';
import { maskPan } from '../utils/mask.js';

export const STATUS_MESSAGE = {
  [STATUS.SUBMITTED]: 'We have received your application. Verification will start shortly.',
  [STATUS.EXTRACTING]: 'We are reading and verifying your documents.',
  [STATUS.AUTO_APPROVED]: 'Your application is approved. Your account is being set up.',
  [STATUS.IN_REVIEW]: 'A KYC officer is reviewing your application. You do not need to do anything.',
  [STATUS.PENDING_CHECKER]: 'Your application is waiting for final compliance approval.',
  [STATUS.AUTO_REJECTED]: 'We could not approve your application based on the information and documents provided.',
  [STATUS.RESUBMISSION_REQUESTED]: 'Please upload corrected documents before the deadline shown below.',
  [STATUS.APPROVED]: 'Your application is approved and your account has been opened.',
  [STATUS.REJECTED]: 'We could not approve your application based on the information and documents provided.',
  [STATUS.CLOSED_EXPIRED]: 'The resubmission window expired, so this application was closed.',
};

export const STATUS_LABEL = {
  [STATUS.SUBMITTED]: 'Application submitted',
  [STATUS.EXTRACTING]: 'Documents being verified',
  [STATUS.AUTO_APPROVED]: 'Approved',
  [STATUS.IN_REVIEW]: 'Under review',
  [STATUS.PENDING_CHECKER]: 'Final approval pending',
  [STATUS.AUTO_REJECTED]: 'Not approved',
  [STATUS.RESUBMISSION_REQUESTED]: 'New documents requested',
  [STATUS.APPROVED]: 'Approved, account opened',
  [STATUS.REJECTED]: 'Not approved',
  [STATUS.CLOSED_EXPIRED]: 'Closed (window expired)',
};

// Reason code -> customer-safe text. Every one of the 17 codes has a readable message (FR-8). Watchlist and duplicate
// reasons deliberately map to a generic line, and no text ever contains a score, a confidence value or a list name.
const GENERIC_REASON = 'Some of your details or documents need additional verification.';
export const REASON_MESSAGE = {
  DOCUMENT_MISSING: 'A required document (PAN card, Aadhaar card or address proof) was missing or could not be used.',
  DOCUMENT_TYPE_MISMATCH: 'One of your documents does not look like the type you selected.',
  LOW_EXTRACTION_CONFIDENCE: 'Some details in your documents were hard to read clearly.',
  AGE_BELOW_18: 'Applicants must be at least 18 years old to open an account.',
  PAN_INVALID: 'The PAN you entered is not a valid PAN for an individual.',
  PAN_MISMATCH: 'The PAN on your PAN card does not match the PAN you entered.',
  DOB_MISMATCH: 'The date of birth on your documents does not match the date you entered.',
  AADHAAR_MISMATCH: 'The Aadhaar digits on your Aadhaar card do not match the digits you entered.',
  NAME_MISMATCH: 'The name on your documents does not match the name you entered.',
  SANCTIONS_MATCH: GENERIC_REASON,
  NAME_MISMATCH_MINOR: 'The name on your documents is slightly different from the name you entered.',
  DOCUMENT_EXPIRED: 'Your driving licence appears to have expired.',
  ADDRESS_PROOF_STALE: 'Your address proof is more than 90 days old, or its date is in the future.',
  ADDRESS_MISMATCH: 'The pincode on your address proof does not match the pincode you entered.',
  SANCTIONS_POSSIBLE_MATCH: GENERIC_REASON,
  PEP_MATCH: GENERIC_REASON,
  DUPLICATE_CUSTOMER: GENERIC_REASON,
};

// Statuses where the applicant is told why: everything except approvals (nothing to explain).
const EXPLAINED = [STATUS.IN_REVIEW, STATUS.PENDING_CHECKER, STATUS.RESUBMISSION_REQUESTED, STATUS.AUTO_REJECTED, STATUS.REJECTED];

export function applicantReasons(status, reasonCodes = []) {
  if (!EXPLAINED.includes(status)) return [];
  return [...new Set(reasonCodes.map((c) => REASON_MESSAGE[c] || GENERIC_REASON))];
}

/** [{status, label, at}] - from the audit trail, so it always matches what really happened. */
export function buildTimeline(app, statusEvents = []) {
  const out = [{ status: STATUS.SUBMITTED, label: STATUS_LABEL[STATUS.SUBMITTED], at: app.submitted_at }];
  for (const e of statusEvents) {
    if (out[out.length - 1].status === e.status && e.status !== STATUS.SUBMITTED) continue;
    out.push({ status: e.status, label: STATUS_LABEL[e.status] || e.status, at: e.at });
  }
  return out;
}

export function toApplicantView(app, documents = [], { timeline } = {}) {
  const deadline = app.resubmission_deadline ? new Date(app.resubmission_deadline) : null;
  return {
    id: app.id,
    application_id: app.id,
    status: app.status,
    status_label: STATUS_LABEL[app.status] || app.status,
    status_message: STATUS_MESSAGE[app.status] || '',
    reasons: applicantReasons(app.status, app.reason_codes),
    submitted_at: app.submitted_at,
    updated_at: app.updated_at,
    declared: {
      full_name: app.full_name,
      dob: app.dob,
      gender: app.gender,
      pan_number: app.pan,
      aadhaar_last4: app.aadhaar_last4,
      mobile: app.mobile,
      email: app.email,
      address: app.address,
      city: app.city,
      state: app.state,
      pincode: app.pincode,
      occupation_code: app.occupation,
      annual_income: app.annual_income,
    },
    resubmission_deadline: app.status === STATUS.RESUBMISSION_REQUESTED ? app.resubmission_deadline : null,
    can_resubmit: app.status === STATUS.RESUBMISSION_REQUESTED && deadline !== null && deadline > new Date(),
    account_id: [STATUS.APPROVED, STATUS.AUTO_APPROVED].includes(app.status) ? app.core_account_id : null,
    ...(timeline ? { timeline } : {}),
    documents: documents.filter((d) => !d.superseded).map(toDocumentMeta),
    replaced_documents: documents.filter((d) => d.superseded).map(toDocumentMeta),
  };
}

/** Compact row for queues and lists: PAN is masked, no personal contact data. */
export function toListRow(app) {
  const waitingMs = Date.now() - new Date(app.updated_at).getTime();
  return {
    id: app.id,
    application_id: app.id,
    full_name: app.full_name,
    pan_masked: maskPan(app.pan),
    status: app.status,
    decision: app.decision,
    reason_codes: app.reason_codes,
    risk_category: app.risk_category,
    name_match_score: app.name_match_score,
    maker_recommendation: app.maker_recommendation,
    submitted_at: app.submitted_at,
    updated_at: app.updated_at,
    version: app.version,
    waiting_hours: Math.round((waitingMs / 3600000) * 10) / 10,
  };
}

/** Full record for KYC / compliance officers: rule trace, extracted fields per document, timeline. */
export function toStaffView(app, documents = [], { fields = [], timeline } = {}) {
  const byDoc = new Map();
  for (const f of fields) {
    if (!byDoc.has(f.document_id)) byDoc.set(f.document_id, []);
    byDoc.get(f.document_id).push({
      field: f.field,
      value: f.value,
      confidence: Number(f.confidence),
      source: f.source,
      original_value: f.original_value,
      original_confidence: f.original_confidence === null ? null : Number(f.original_confidence),
    });
  }
  const { password_hash, ...rest } = app; // defensive: never leak anything unexpected
  void password_hash;
  return {
    ...rest,
    application_id: app.id,
    pan_number: app.pan,
    occupation_code: app.occupation,
    status_label: STATUS_LABEL[app.status] || app.status,
    status_message: STATUS_MESSAGE[app.status] || '',
    ...(timeline ? { timeline } : {}),
    documents: documents.map((d) => ({
      ...toDocumentMeta(d),
      classified_type: d.classified_type,
      classification_confidence: d.classification_confidence === null ? null : Number(d.classification_confidence),
      doc_type: d.classified_type,
      confidence: d.classification_confidence === null ? null : Number(d.classification_confidence),
      fields: byDoc.get(d.id) || [],
    })),
  };
}

export function toDocumentMeta(d) {
  return {
    doc_id: d.doc_id,
    declared_type: d.declared_type,
    original_filename: d.original_filename,
    size_bytes: d.size_bytes,
    sha256: d.sha256,
    version: d.version,
    superseded: d.superseded,
    uploaded_at: d.uploaded_at,
  };
}

/**
 * The "Decision API response" of the case document (Section 6.3): application_id, decision, reason_codes,
 * name_match_score, risk_category, rekyc_due_date, status and, per document, the doc_type and confidence.
 * Staff only - an applicant gets toApplicantDecision() instead.
 */
export function toDecisionView(app, documents = []) {
  return {
    application_id: app.id,
    decision: app.decision,
    reason_codes: app.reason_codes || [],
    name_match_score: app.name_match_score === null || app.name_match_score === undefined ? null : Number(app.name_match_score),
    risk_category: app.risk_category,
    rekyc_due_date: app.rekyc_due_date,
    status: app.status,
    documents: documents
      .filter((d) => !d.superseded)
      .map((d) => ({
        doc_id: d.doc_id,
        declared_doc_type: d.declared_type,
        doc_type: d.classified_type,
        confidence: d.classification_confidence === null ? null : Number(d.classification_confidence),
      })),
  };
}

/** What the owner may see of a decision: status and plain-language reasons only (no scores, confidence or lists). */
export function toApplicantDecision(app) {
  return {
    application_id: app.id,
    status: app.status,
    status_label: STATUS_LABEL[app.status] || app.status,
    reasons: applicantReasons(app.status, app.reason_codes),
  };
}
