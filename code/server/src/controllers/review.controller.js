// KYC officer (maker) APIs: queue, field corrections (which re-run the rules) and the recommendation.
import { AUDIT, DATE_FIELDS, OPEN_STATUSES, STATUS } from '../constants.js';
import { query, withTransaction } from '../db/index.js';
import { recordAudit } from '../services/audit.js';
import { assertVersion, lockApplication, transition } from '../services/applicationState.js';
import { loadDocuments, loadFields, loadTimeline } from '../services/applicationAccess.js';
import { toListRow, toStaffView } from '../services/applicantView.js';
import { loadConfigFromDb } from '../services/kyc/references.js';
import { expireOverdue, reevaluate } from '../services/pipeline.js';
import { parseDate } from '../utils/dates.js';
import { badRequest, conflict, notFound } from '../utils/errors.js';
import { parseOrThrow } from '../validators/auth.js';
import { correctionSchema, recommendSchema } from '../validators/staff.js';

const QUEUE_STATUSES = [...OPEN_STATUSES, STATUS.RESUBMISSION_REQUESTED];
const FIELD_RE = /^[a-z][a-z0-9_]{1,39}$/;
const DATE_FIELD_SET = new Set(DATE_FIELDS);

/** GET /review/queue?status=IN_REVIEW - risk HIGH, MEDIUM, LOW, then oldest submission first. */
export async function reviewQueue(req, res) {
  await expireOverdue();
  const status = req.query.status ? String(req.query.status).toUpperCase() : STATUS.IN_REVIEW;
  if (!QUEUE_STATUSES.includes(status)) throw badRequest('VALIDATION_ERROR', `status must be one of ${QUEUE_STATUSES.join(', ')}`);
  const { rows } = await query(
    `SELECT * FROM applications WHERE status = $1
      ORDER BY CASE risk_category WHEN 'HIGH' THEN 0 WHEN 'MEDIUM' THEN 1 WHEN 'LOW' THEN 2 ELSE 3 END, submitted_at ASC, id ASC`,
    [status],
  );
  res.json({ status, count: rows.length, applications: rows.map(toListRow) });
}

async function staffResponse(applicationId) {
  const { rows } = await query('SELECT * FROM applications WHERE id = $1', [applicationId]);
  const app = rows[0];
  return toStaffView(app, await loadDocuments(app.id), { fields: await loadFields(app.id), timeline: await loadTimeline(app) });
}

/**
 * PATCH /review/:id/documents/:docId/fields/:field   body: { value, reason, version }
 * Stores the corrected value (confidence 1.00, source OFFICER), keeps the original, audits old -> new, then re-runs
 * every rule. A corrected case never skips the checker: if the re-run result is APPROVE the case moves to
 * PENDING_CHECKER (the correcting officer is the maker); any other result leaves it IN_REVIEW for the officer to
 * recommend on. The pseudo-field "document_type" (alias doc_type) corrects the extractor's classification.
 */
export async function correctField(req, res) {
  const { id, docId } = req.params;
  let field = String(req.params.field).toLowerCase();
  if (field === 'doc_type') field = 'document_type'; // the extraction vocabulary and the older name both work
  if (!FIELD_RE.test(field)) throw badRequest('VALIDATION_ERROR', 'Invalid field name');
  const body = parseOrThrow(correctionSchema, req.body);

  let value = body.value;
  if (DATE_FIELD_SET.has(field)) {
    value = parseDate(value);
    if (!value) throw badRequest('VALIDATION_ERROR', `${field} must be a real date`);
  }
  if (field === 'pan_number') value = value.toUpperCase().replace(/\s/g, '');
  if (field === 'document_type') value = value.toUpperCase();

  const out = await withTransaction(async (client) => {
    let app = await lockApplication(client, id);
    assertVersion(app, body.version);
    if (app.status !== STATUS.IN_REVIEW) throw conflict('INVALID_STATE', `Fields can only be corrected while the application is IN_REVIEW (it is ${app.status})`);

    const { rows: docs } = await client.query('SELECT * FROM documents WHERE application_id = $1 AND doc_id = $2 AND superseded = FALSE', [id, docId]);
    const doc = docs[0];
    if (!doc) throw notFound('Document not found');

    let before;
    if (field === 'document_type') {
      before = { field, value: doc.classified_type, confidence: doc.classification_confidence === null ? null : Number(doc.classification_confidence), source: 'EXTRACTOR' };
      await client.query('UPDATE documents SET classified_type = $2, classification_confidence = 1.00 WHERE id = $1', [doc.id, value]);
    } else {
      const { rows: cur } = await client.query('SELECT * FROM extracted_fields WHERE document_id = $1 AND field = $2 FOR UPDATE', [doc.id, field]);
      const row = cur[0];
      before = { field, value: row ? row.value : null, confidence: row ? Number(row.confidence) : null, source: row ? row.source : null };
      await client.query(
        `INSERT INTO extracted_fields (application_id, document_id, doc_id, doc_type, field, value, confidence, source, original_value, original_confidence, corrected_by)
         VALUES ($1,$2,$3,$4,$5,$6,1.00,'OFFICER',$7,$8,$9)
         ON CONFLICT (document_id, field) DO UPDATE
           SET value = EXCLUDED.value, confidence = 1.00, source = 'OFFICER', corrected_by = EXCLUDED.corrected_by, updated_at = now(),
               original_value = COALESCE(extracted_fields.original_value, EXCLUDED.original_value),
               original_confidence = COALESCE(extracted_fields.original_confidence, EXCLUDED.original_confidence)`,
        [id, doc.id, doc.doc_id, doc.classified_type, field, value, before.value, before.confidence, req.user.id],
      );
    }

    await recordAudit(client, {
      actor: req.user,
      eventType: AUDIT.FIELD_CORRECTED,
      entityType: 'document',
      entityId: `${id}/${doc.doc_id}`,
      applicationId: id,
      documentId: doc.doc_id,
      oldValue: before,
      newValue: { field, value, confidence: 1, source: 'OFFICER' },
      details: { reason: body.reason },
    });
    let { application, result, before: prev } = await reevaluate(client, app, { actor: req.user, reason: `correction of ${field}` });
    if (result.decision === 'APPROVE') {
      application = await transition(client, application, STATUS.PENDING_CHECKER, {
        actor: req.user,
        set: { maker_id: req.user.id, maker_at: new Date(), maker_comment: `Corrected ${field}: ${body.reason}` },
        details: { reason: 'correction produced APPROVE; a reviewed case needs the checker', field },
      });
    }
    return {
      version: application.version,
      status: application.status,
      before: prev,
      after: { decision: result.decision, reason_codes: result.reason_codes, risk_category: result.risk_category, name_match_score: result.name_match_score, rekyc_due_date: result.rekyc_due_date },
    };
  });

  res.json({ ...out, application: await staffResponse(id) });
}

/**
 * POST /review/:id/recommend   body: { recommendation, comment (>= 10 chars), version }
 *   APPROVE / REJECT        -> PENDING_CHECKER (the checker makes the final call)
 *   REQUEST_RESUBMISSION    -> RESUBMISSION_REQUESTED with a 7-day deadline
 */
export async function recommend(req, res) {
  const body = parseOrThrow(recommendSchema, req.body);
  await withTransaction(async (client) => {
    const app = await lockApplication(client, req.params.id);
    assertVersion(app, body.version);
    // The maker of a case that is already waiting for the checker (e.g. after a correction) may still record APPROVE or REJECT.
    const updateOnly = app.status === STATUS.PENDING_CHECKER && app.maker_id === req.user.id && body.recommendation !== 'REQUEST_RESUBMISSION';
    if (app.status !== STATUS.IN_REVIEW && !updateOnly) throw conflict('INVALID_STATE', `Only applications IN_REVIEW can receive a recommendation (this one is ${app.status})`);

    const resubmit = body.recommendation === 'REQUEST_RESUBMISSION';
    const days = (await loadConfigFromDb(client)).resubmission_window_days;
    const deadline = resubmit ? new Date(Date.now() + days * 86400000) : null;

    await recordAudit(client, {
      actor: req.user,
      eventType: AUDIT.MAKER_RECOMMENDED,
      entityType: 'application',
      entityId: app.id,
      newValue: { recommendation: body.recommendation },
      details: { comment: body.comment, ...(deadline ? { resubmission_deadline: deadline.toISOString() } : {}) },
    });
    if (updateOnly) {
      await client.query(
        `UPDATE applications SET maker_recommendation = $2, maker_comment = $3, maker_at = now(), version = version + 1, updated_at = now() WHERE id = $1`,
        [app.id, body.recommendation, body.comment],
      );
      return;
    }
    await transition(client, app, resubmit ? STATUS.RESUBMISSION_REQUESTED : STATUS.PENDING_CHECKER, {
      actor: req.user,
      set: {
        maker_id: req.user.id,
        maker_recommendation: body.recommendation,
        maker_comment: body.comment,
        maker_at: new Date(),
        ...(resubmit ? { resubmission_deadline: deadline } : {}),
      },
      details: { recommendation: body.recommendation },
    });
  });
  res.json({ application: await staffResponse(req.params.id) });
}
