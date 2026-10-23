import { ROLES } from '../constants.js';
import { query } from '../db/index.js';
import { forbidden, notFound } from '../utils/errors.js';
import { buildTimeline } from './applicantView.js';
import { expireOverdue } from './pipeline.js';

/**
 * Loads an application and enforces object-level access:
 *  - an APPLICANT can only touch their own applications (403 otherwise, so swapping the id in the URL leaks nothing)
 *  - KYC_OFFICER and COMPLIANCE_OFFICER can read any application
 * Every endpoint that returns application data or document bytes must go through this function.
 * It also closes any resubmission window that has elapsed, so nobody ever reads a stale RESUBMISSION_REQUESTED.
 */
export async function loadApplicationForUser(applicationId, user) {
  let { rows } = await query('SELECT * FROM applications WHERE id = $1', [applicationId]);
  if (!rows[0]) throw notFound('Application not found');
  if (user.role === ROLES.APPLICANT && rows[0].user_id !== user.id) {
    throw forbidden('You do not have access to this application');
  }
  if (rows[0].status === 'RESUBMISSION_REQUESTED' && rows[0].resubmission_deadline && new Date(rows[0].resubmission_deadline) < new Date()) {
    await expireOverdue();
    ({ rows } = await query('SELECT * FROM applications WHERE id = $1', [applicationId]));
  }
  return rows[0];
}

/** All document rows (superseded ones too, flagged), oldest first. */
export async function loadDocuments(applicationId) {
  const { rows } = await query('SELECT * FROM documents WHERE application_id = $1 ORDER BY uploaded_at, id', [applicationId]);
  return rows;
}

export async function loadFields(applicationId) {
  const { rows } = await query('SELECT * FROM extracted_fields WHERE application_id = $1 ORDER BY document_id, id', [applicationId]);
  return rows;
}

export async function loadTimeline(app) {
  const { rows } = await query(
    `SELECT new_value->>'status' AS status, created_at AS at FROM audit_events
      WHERE application_id = $1 AND event_type = 'STATUS_CHANGED' ORDER BY id`,
    [app.id],
  );
  return buildTimeline(app, rows);
}
