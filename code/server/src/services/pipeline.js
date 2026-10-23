// Submit -> extract -> evaluate -> route, as one atomic step (A4), plus the follow-ups around it:
// re-evaluation after an officer correction, account opening, and the 7-day resubmission expiry.
import { AUDIT, STATUS, routeStatus } from '../constants.js';
import { query, withTransaction } from '../db/index.js';
import { conflict } from '../utils/errors.js';
import { recordAudit } from './audit.js';
import { SYSTEM, lockApplication, saveEvaluation, transition } from './applicationState.js';
import { openAccount } from './coreBanking/index.js';
import { extractAndStore } from './extraction/store.js';
import { evaluateStored } from './kyc/index.js';
import { readStoredText } from './uploads.js';

/** Writes EVALUATED + one WATCHLIST_HIT row per hit (staff-only evidence). */
async function auditEvaluation(client, app, result, extra = {}) {
  await recordAudit(client, {
    actor: SYSTEM,
    eventType: AUDIT.EVALUATED,
    entityType: 'application',
    entityId: app.id,
    newValue: {
      decision: result.decision,
      reason_codes: result.reason_codes,
      risk_category: result.risk_category,
      name_match_score: result.name_match_score,
      rekyc_due_date: result.rekyc_due_date,
    },
    details: { engine_version: result.engine_version, application_date: result.application_date, ...extra },
  });
  for (const [list, screen] of [['SANCTIONS', result.watchlist.sanctions], ['PEP', result.watchlist.pep]]) {
    if (screen.status === 'CLEAR') continue;
    await recordAudit(client, {
      actor: SYSTEM,
      eventType: AUDIT.WATCHLIST_HIT,
      entityType: 'application',
      entityId: app.id,
      details: { list, status: screen.status, hits: screen.hits.map((h) => ({ entry_id: h.entry_id, score: h.score, status: h.status, dob_status: h.dob_status })) },
    });
  }
}

/**
 * Runs extraction and the rules for an application in status SUBMITTED, then routes it.
 * @param {string} applicationId
 * @param {{ reviewed?: boolean }} opts  reviewed=true after a human has been involved: an APPROVE then waits for the checker
 */
export async function processApplication(applicationId, { reviewed = false } = {}) {
  const final = await withTransaction(async (client) => {
    let app = await lockApplication(client, applicationId);
    app = await transition(client, app, STATUS.EXTRACTING, { details: { reviewed } });

    const { rows: docs } = await client.query(
      'SELECT * FROM documents WHERE application_id = $1 AND superseded = FALSE ORDER BY id',
      [app.id],
    );
    for (const doc of docs) {
      const text = await readStoredText(doc.storage_path, doc.sha256);
      await extractAndStore(client, { application: app, document: doc, text, actor: SYSTEM });
    }

    const result = await evaluateStored(client, app.id);
    app = await saveEvaluation(client, app, result);
    await auditEvaluation(client, app, result);
    const to = routeStatus(result.decision, result.risk_category, reviewed);
    return transition(client, app, to, {
      details: { decision: result.decision, reason_codes: result.reason_codes, risk_category: result.risk_category },
    });
  });

  if (final.status === STATUS.AUTO_APPROVED) {
    try {
      return await completeAccountOpening(final.id);
    } catch {
      // Approval stands; the account can be opened later via POST /compliance/:id/open-account (failure is audited).
      const { rows } = await query('SELECT * FROM applications WHERE id = $1', [final.id]);
      return rows[0];
    }
  }
  return final;
}

/**
 * Re-runs the rules for a stored application WITHOUT touching its status (used after an officer correction and by
 * the re-screen job). Returns { application, result, before }.
 */
export async function reevaluate(client, app, { actor = SYSTEM, reason, onlyIfChanged = false } = {}) {
  const before = { decision: app.decision, reason_codes: app.reason_codes, risk_category: app.risk_category, name_match_score: app.name_match_score };
  const result = await evaluateStored(client, app.id);
  const changed =
    before.decision !== result.decision ||
    before.risk_category !== result.risk_category ||
    before.name_match_score !== result.name_match_score ||
    JSON.stringify(before.reason_codes) !== JSON.stringify(result.reason_codes);
  // re-screens leave untouched cases alone, so they don't invalidate what an officer is looking at
  if (onlyIfChanged && !changed) return { application: app, result, before, changed: false };
  const saved = await saveEvaluation(client, app, result);
  await recordAudit(client, {
    actor,
    eventType: AUDIT.EVALUATED,
    entityType: 'application',
    entityId: app.id,
    oldValue: before,
    newValue: {
      decision: result.decision,
      reason_codes: result.reason_codes,
      risk_category: result.risk_category,
      name_match_score: result.name_match_score,
      rekyc_due_date: result.rekyc_due_date,
    },
    details: { engine_version: result.engine_version, re_evaluation: true, reason },
  });
  return { application: saved, result, before, changed: true };
}

/**
 * Opens the mock core-banking account for an approved application (idempotent). Used for AUTO_APPROVED cases.
 * On failure it writes CORE_ACCOUNT_FAILED and throws; the approval itself is not undone.
 */
export async function completeAccountOpening(applicationId, actor = SYSTEM) {
  const { rows } = await query('SELECT * FROM applications WHERE id = $1', [applicationId]);
  const app = rows[0];
  if (!app) throw conflict('NOT_FOUND', 'Application not found');
  if (app.core_account_id) return app;
  if (![STATUS.AUTO_APPROVED, STATUS.APPROVED].includes(app.status)) {
    throw conflict('INVALID_STATE', 'Only approved applications get an account');
  }
  let ids;
  try {
    ids = await openAccount(app);
  } catch (err) {
    await recordAudit({ query }, {
      actor,
      eventType: AUDIT.CORE_ACCOUNT_FAILED,
      entityType: 'application',
      entityId: app.id,
      details: { error: err.message },
    });
    throw err;
  }
  return withTransaction(async (client) => {
    const locked = await lockApplication(client, app.id);
    if (locked.core_account_id) return locked;
    const { rows: updated } = await client.query(
      `UPDATE applications SET core_customer_id = $2, core_account_id = $3, version = version + 1, updated_at = now()
        WHERE id = $1 RETURNING *`,
      [app.id, ids.customerId, ids.accountId],
    );
    await recordAudit(client, {
      actor,
      eventType: AUDIT.CORE_ACCOUNT_CREATED,
      entityType: 'application',
      entityId: app.id,
      newValue: { customer_id: ids.customerId, account_id: ids.accountId },
    });
    return updated[0];
  });
}

/** Closes RESUBMISSION_REQUESTED applications whose 7-day window has passed. Safe to call as often as you like. */
export async function expireOverdue(db = null) {
  const { rows } = await query(
    `SELECT id FROM applications WHERE status = $1 AND resubmission_deadline IS NOT NULL AND resubmission_deadline < now()`,
    [STATUS.RESUBMISSION_REQUESTED],
  );
  const closed = [];
  for (const { id } of rows) {
    try {
      await withTransaction(async (client) => {
        const app = await lockApplication(client, id);
        if (app.status !== STATUS.RESUBMISSION_REQUESTED || !app.resubmission_deadline || new Date(app.resubmission_deadline) >= new Date()) return;
        await transition(client, app, STATUS.CLOSED_EXPIRED, { details: { reason: 'resubmission window elapsed', deadline: app.resubmission_deadline } });
        await recordAudit(client, {
          actor: SYSTEM,
          eventType: AUDIT.APPLICATION_EXPIRED,
          entityType: 'application',
          entityId: id,
          details: { deadline: app.resubmission_deadline },
        });
        closed.push(id);
      });
    } catch (err) {
      console.error('[expiry] could not close', id, err.message);
    }
  }
  return closed;
}

/** Recovery: an application stuck in SUBMITTED for over a minute (e.g. a crash mid-request) is processed again. */
export async function processStuckSubmissions() {
  const { rows } = await query(
    `SELECT id, resubmission_count FROM applications WHERE status = $1 AND updated_at < now() - interval '1 minute'`,
    [STATUS.SUBMITTED],
  );
  const done = [];
  for (const r of rows) {
    try {
      await processApplication(r.id, { reviewed: r.resubmission_count > 0 });
      done.push(r.id);
    } catch (err) {
      if (err.code !== 'INVALID_TRANSITION') console.error('[recovery] could not process', r.id, err.message);
    }
  }
  return done;
}


