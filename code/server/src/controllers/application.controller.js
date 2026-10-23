import { AUDIT, ROLES, STATUS } from '../constants.js';
import { query, withTransaction } from '../db/index.js';
import { recordAudit } from '../services/audit.js';
import { lockApplication, transition } from '../services/applicationState.js';
import { loadApplicationForUser, loadDocuments, loadFields, loadTimeline } from '../services/applicationAccess.js';
import { toApplicantDecision, toApplicantView, toDecisionView, toDocumentMeta, toStaffView } from '../services/applicantView.js';
import { extractAndStore } from '../services/extraction/store.js';
import { extractDocument } from '../services/extraction/index.js';
import { expireOverdue, processApplication } from '../services/pipeline.js';
import { prepareDocuments, readStoredText, removeFiles, storeFiles } from '../services/uploads.js';
import { businessDate } from '../utils/clock.js';
import { AppError, badRequest, conflict, forbidden, notFound, validationError } from '../utils/errors.js';
import { parseApplicationFields } from '../validators/application.js';
import { ADDRESS_PROOF_TYPES } from '../constants.js';

async function applicantResponse(applicationId) {
  const { rows } = await query('SELECT * FROM applications WHERE id = $1', [applicationId]);
  const app = rows[0];
  return toApplicantView(app, await loadDocuments(app.id), { timeline: await loadTimeline(app) });
}

/** Runs the pipeline; if it fails for any unexpected reason the application stays SUBMITTED and the stuck-job retries. */
async function runPipeline(applicationId, opts) {
  try {
    await processApplication(applicationId, opts);
  } catch (err) {
    console.error(`[pipeline] ${applicationId} could not be processed yet:`, err.code || err.message);
  }
}

/**
 * POST /applications  (APPLICANT only, multipart/form-data)
 * Text fields + 3..10 .txt files, validated together. The application, documents, files and audit rows are saved
 * atomically; then extraction -> rules -> status run immediately and the response already carries the outcome.
 */
export async function createApplication(req, res) {
  const fields = parseApplicationFields(req.body);
  const { rows: occ } = await query('SELECT code FROM occupations WHERE lower(code) = lower($1)', [fields.occupation_code]);
  if (!occ[0]) throw validationError([{ field: 'occupation_code', message: 'Choose one of the listed occupations' }]);
  fields.occupation_code = occ[0].code;
  const prepared = prepareDocuments(req); // throws 400/409 listing every problem
  const stored = await storeFiles(prepared);

  let application;
  try {
    ({ application } = await withTransaction(async (client) => {
      const { rows } = await client.query(
        `INSERT INTO applications
           (user_id, full_name, dob, gender, pan, aadhaar_last4, email, address, city, state, pincode, mobile, occupation,
            annual_income, consent, status, application_date)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,TRUE,$15,$16)
         RETURNING *`,
        [
          req.user.id, fields.full_name, fields.dob, fields.gender, fields.pan_number, fields.aadhaar_last4, fields.email,
          fields.address, fields.city, fields.state, fields.pincode, fields.mobile, fields.occupation_code,
          fields.annual_income, STATUS.SUBMITTED, businessDate(),
        ],
      );
      const app = rows[0];

      const docRows = [];
      for (const d of stored) {
        const r = await client.query(
          `INSERT INTO documents (application_id, doc_id, declared_type, original_filename, sha256, size_bytes, storage_path)
           VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
          [app.id, d.docId, d.declaredType, d.originalName, d.sha256, d.size, d.storagePath],
        );
        docRows.push(r.rows[0]);
      }

      await recordAudit(client, {
        actor: req.user,
        eventType: AUDIT.APPLICATION_CREATED,
        entityType: 'application',
        entityId: app.id,
        newValue: { status: app.status },
        details: { consent: true },
      });
      await recordAudit(client, {
        actor: req.user,
        eventType: AUDIT.DOCUMENT_UPLOADED,
        entityType: 'application',
        entityId: app.id,
        details: { documents: docRows.map((d) => ({ doc_id: d.doc_id, declared_type: d.declared_type, sha256: d.sha256 })) },
      });
      return { application: app };
    }));
  } catch (err) {
    await removeFiles(stored); // don't leave orphan files behind when the DB write fails
    throw err;
  }

  await runPipeline(application.id);
  res.status(201).json({ application: await applicantResponse(application.id) });
}

/**
 * POST /applications/:id/resubmit  (APPLICANT, owner only, multipart: documents + document_types [+ doc_ids])
 * Allowed only while the status is RESUBMISSION_REQUESTED and the 7-day deadline has not passed. The replaced
 * documents are kept (superseded) for the audit trail; the new set is extracted and evaluated again.
 */
export async function resubmitApplication(req, res) {
  const app = await loadApplicationForUser(req.params.id, req.user);
  if (app.status === STATUS.CLOSED_EXPIRED) {
    throw conflict('RESUBMISSION_WINDOW_EXPIRED', 'The 7-day resubmission window has passed and this application is closed.');
  }
  if (app.status !== STATUS.RESUBMISSION_REQUESTED) {
    throw conflict('INVALID_STATE', 'This application is not waiting for new documents.');
  }
  const prepared = prepareDocuments(req, { minDocuments: 1 });
  const existing = await loadDocuments(app.id);
  const clash = prepared.find((p) => existing.some((e) => e.sha256 === p.sha256));
  if (clash) throw conflict('DUPLICATE_DOCUMENT', `"${clash.originalName}" has already been uploaded for this application. Upload the corrected file.`);
  const idClash = prepared.find((p) => existing.some((e) => !e.superseded && e.doc_id === p.docId && e.declared_type !== p.declaredType));
  if (idClash) throw conflict('DUPLICATE_DOCUMENT_ID', `Document id "${idClash.docId}" is already used by a different kind of document.`);

  const stored = await storeFiles(prepared);
  try {
    await withTransaction(async (client) => {
      let locked = await lockApplication(client, app.id);
      if (locked.status !== STATUS.RESUBMISSION_REQUESTED) throw conflict('INVALID_STATE', 'This application is not waiting for new documents.');
      if (!locked.resubmission_deadline || new Date(locked.resubmission_deadline) < new Date()) {
        throw conflict('RESUBMISSION_WINDOW_EXPIRED', 'The 7-day resubmission window has passed.');
      }
      const round = locked.resubmission_count + 2; // original upload is version 1

      for (const d of stored) {
        const replaced = ADDRESS_PROOF_TYPES.includes(d.declaredType) ? ADDRESS_PROOF_TYPES : [d.declaredType];
        const { rows: old } = await client.query(
          `UPDATE documents SET superseded = TRUE
            WHERE application_id = $1 AND superseded = FALSE AND declared_type = ANY($2::text[]) RETURNING doc_id`,
          [app.id, replaced],
        );
        await client.query(
          `INSERT INTO documents (application_id, doc_id, declared_type, original_filename, sha256, size_bytes, storage_path, version)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [app.id, d.docId, d.declaredType, d.originalName, d.sha256, d.size, d.storagePath, round],
        );
        for (const o of old) {
          await recordAudit(client, {
            actor: req.user, eventType: AUDIT.DOCUMENT_REPLACED, entityType: 'document', entityId: `${app.id}/${o.doc_id}`,
            applicationId: app.id, documentId: o.doc_id, details: { replaced_by: d.docId, declared_type: d.declaredType },
          });
        }
      }
      await recordAudit(client, {
        actor: req.user, eventType: AUDIT.DOCUMENT_UPLOADED, entityType: 'application', entityId: app.id,
        details: { resubmission: true, documents: stored.map((d) => ({ doc_id: d.docId, declared_type: d.declaredType, sha256: d.sha256 })) },
      });
      await recordAudit(client, {
        actor: req.user, eventType: AUDIT.RESUBMITTED, entityType: 'application', entityId: app.id,
        details: { round: locked.resubmission_count + 1, previous_application_date: locked.application_date },
      });
      locked = await transition(client, locked, STATUS.SUBMITTED, {
        actor: req.user,
        set: { application_date: businessDate(), maker_id: null, maker_recommendation: null, maker_comment: null, maker_at: null, resubmission_deadline: null },
        details: { resubmission: true },
      });
      await client.query('UPDATE applications SET resubmission_count = resubmission_count + 1 WHERE id = $1', [app.id]);
    });
  } catch (err) {
    await removeFiles(stored);
    throw err;
  }

  await runPipeline(app.id, { reviewed: true }); // a human was involved, so an APPROVE still goes to the checker
  res.json({ application: await applicantResponse(app.id) });
}

/** GET /applications - the logged-in applicant's own applications, newest first. */
export async function listMyApplications(req, res) {
  await expireOverdue();
  const { rows } = await query('SELECT * FROM applications WHERE user_id = $1 ORDER BY submitted_at DESC, id DESC', [req.user.id]);
  res.json({ applications: rows.map((a) => toApplicantView(a)) });
}

/** GET /applications/:id - applicant sees a safe view of their own; officers see the full record. */
export async function getApplication(req, res) {
  const app = await loadApplicationForUser(req.params.id, req.user);
  const documents = await loadDocuments(app.id);
  const timeline = await loadTimeline(app);
  const view =
    req.user.role === ROLES.APPLICANT
      ? toApplicantView(app, documents, { timeline })
      : toStaffView(app, documents, { fields: await loadFields(app.id), timeline });
  res.json({ application: view });
}

/** GET /applications/:id/decision - the decision API response (staff: full; owner: status + plain-language reasons). */
export async function getDecision(req, res) {
  const app = await loadApplicationForUser(req.params.id, req.user);
  if (req.user.role === ROLES.APPLICANT) return res.json({ decision: toApplicantDecision(app) });
  res.json({ decision: toDecisionView(app, await loadDocuments(app.id)) });
}

/** GET /applications/:id/documents - metadata only. */
export async function listDocuments(req, res) {
  const app = await loadApplicationForUser(req.params.id, req.user);
  const documents = await loadDocuments(app.id);
  res.json({ documents: documents.map(toDocumentMeta) });
}

/** GET /applications/:id/documents/:docId/content - returns the text and writes a DOCUMENT_VIEWED audit row. */
export async function getDocumentContent(req, res) {
  const app = await loadApplicationForUser(req.params.id, req.user);
  const { rows } = await query(
    `SELECT * FROM documents WHERE application_id = $1 AND doc_id = $2 ORDER BY superseded ASC, uploaded_at DESC, id DESC LIMIT 1`,
    [app.id, req.params.docId],
  );
  const doc = rows[0];
  if (!doc) throw notFound('Document not found');

  const content = await readStoredText(doc.storage_path, doc.sha256);

  await recordAudit({ query }, {
    actor: req.user,
    eventType: AUDIT.DOCUMENT_VIEWED,
    entityType: 'document',
    entityId: `${app.id}/${doc.doc_id}`,
    applicationId: app.id,
    documentId: doc.doc_id,
    details: { application_id: app.id, doc_id: doc.doc_id, declared_type: doc.declared_type },
  });

  res.json({ document: { ...toDocumentMeta(doc), content } });
}

/**
 * POST /documents/:docId/extract   body: { application_id? }
 *  - with application_id : extracts that stored document (owner or staff). An officer working an IN_REVIEW case also
 *                          refreshes the stored fields (officer corrections are never overwritten).
 *  - without             : staff only; a stateless look-up of the configured provider (unknown id -> OTHER / 0).
 * The provider (mock | ai) is chosen by EXTRACTION_PROVIDER; nothing else changes. The backend itself calls it with the
 * service key (header x-service-key = EXTRACTION_SERVICE_KEY), which only allows the stateless look-up.
 */
export async function extractEndpoint(req, res) {
  const docId = req.params.docId;
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(docId)) throw badRequest('VALIDATION_ERROR', 'Invalid document id');
  const applicationId = req.body?.application_id ? String(req.body.application_id) : null;
  let stored = false;
  let result;
  const providerFailed = (err) => new AppError(502, 'EXTRACTION_PROVIDER_ERROR', `The extraction provider failed: ${err.message}`);

  if (!applicationId || req.serviceCall) {
    if (req.user.role === ROLES.APPLICANT) throw forbidden('Send application_id for one of your own documents');
    result = await extractDocument({ docId, text: '' }).catch((e) => {
      throw providerFailed(e);
    });
  } else {
    const app = await loadApplicationForUser(applicationId, req.user);
    const { rows } = await query('SELECT * FROM documents WHERE application_id = $1 AND doc_id = $2 AND superseded = FALSE', [app.id, docId]);
    const doc = rows[0];
    if (!doc) throw notFound('Document not found');
    const text = await readStoredText(doc.storage_path, doc.sha256);
    if ([ROLES.KYC_OFFICER, ROLES.COMPLIANCE_OFFICER].includes(req.user.role) && app.status === STATUS.IN_REVIEW) {
      result = await withTransaction((client) => extractAndStore(client, { application: app, document: doc, text, actor: req.user }));
      stored = true;
    } else {
      result = await extractDocument({ docId, text }).catch((e) => {
        throw providerFailed(e);
      });
    }
  }
  const fields = Object.entries(result.fields || {}).map(([field_name, f]) => ({ field_name, value: f.value, confidence: f.confidence }));
  // long format of the case document: one doc_type row plus one row per field (doc_id, field_name, value, confidence)
  const rows = [
    { doc_id: docId, field_name: 'doc_type', value: result.doc_type, confidence: result.confidence },
    ...fields.map((f) => ({ doc_id: docId, ...f })),
  ];
  res.json({
    doc_id: docId,
    provider: result.provider,
    doc_type: result.doc_type,
    confidence: result.confidence,
    fields,
    rows,
    stored,
  });
}


