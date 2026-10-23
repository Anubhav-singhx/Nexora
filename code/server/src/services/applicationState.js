// The ONLY place that changes an application's status. Every change:
//   - locks the row (SELECT ... FOR UPDATE), so two actors can never interleave
//   - checks the optimistic-lock version when the caller sends one (409 VERSION_CONFLICT)
//   - checks the lifecycle table in constants.js (409 INVALID_TRANSITION)
//   - bumps the version and writes a STATUS_CHANGED audit row in the same transaction
import { AUDIT, STATUS, canTransition } from '../constants.js';
import { conflict, notFound } from '../utils/errors.js';
import { recordAudit } from './audit.js';

export const SYSTEM = Object.freeze({ id: null, role: 'SYSTEM' });

export async function lockApplication(client, id) {
  const { rows } = await client.query('SELECT * FROM applications WHERE id = $1 FOR UPDATE', [id]);
  if (!rows[0]) throw notFound('Application not found');
  return rows[0];
}

/** Throws 409 if the caller read an older version than the one in the database. */
export function assertVersion(app, expectedVersion) {
  if (expectedVersion !== undefined && expectedVersion !== null && Number(expectedVersion) !== app.version) {
    throw conflict('VERSION_CONFLICT', 'This application was changed by someone else. Reload it and try again.', {
      current_version: app.version,
      your_version: Number(expectedVersion),
    });
  }
}

const SETTABLE = new Set([
  'maker_id', 'maker_recommendation', 'maker_comment', 'maker_at',
  'checker_id', 'checker_decision', 'checker_comment', 'checker_at',
  'resubmission_deadline', 'core_customer_id', 'core_account_id', 'application_date',
]);

function buildSet(set, startIndex) {
  const cols = Object.keys(set);
  for (const c of cols) if (!SETTABLE.has(c)) throw new Error(`transition(): column "${c}" may not be set here`);
  return { sql: cols.map((c, i) => `${c} = $${startIndex + i}`).join(', '), values: cols.map((c) => set[c]) };
}

/**
 * Moves a LOCKED application row to a new status.
 * @param {object} client  transaction client
 * @param {object} app     the row returned by lockApplication()
 * @param {string} to      target status
 * @param {object} opts    { actor, expectedVersion, set: {column: value}, details }
 */
export async function transition(client, app, to, { actor = SYSTEM, expectedVersion, set = {}, details } = {}) {
  assertVersion(app, expectedVersion);
  if (!canTransition(app.status, to)) {
    throw conflict('INVALID_TRANSITION', `An application in status ${app.status} cannot move to ${to}`, {
      from: app.status,
      to,
    });
  }
  const { sql, values } = buildSet(set, 4);
  const { rows } = await client.query(
    `UPDATE applications SET status = $2, version = version + 1, updated_at = now()${sql ? ', ' + sql : ''}
      WHERE id = $1 AND version = $3 RETURNING *`,
    [app.id, to, app.version, ...values],
  );
  await recordAudit(client, {
    actor,
    eventType: AUDIT.STATUS_CHANGED,
    entityType: 'application',
    entityId: app.id,
    oldValue: { status: app.status },
    newValue: { status: to },
    details,
  });
  return rows[0];
}

/** Stores a fresh engine result on the application (no status change). Bumps the version. */
export async function saveEvaluation(client, app, result) {
  const { rows } = await client.query(
    `UPDATE applications
        SET decision = $2, reason_codes = $3, name_match_score = $4, risk_category = $5,
            rekyc_due_date = $6, evaluation = $7::jsonb, version = version + 1, updated_at = now()
      WHERE id = $1 RETURNING *`,
    [
      app.id,
      result.decision,
      result.reason_codes,
      result.name_match_score,
      result.risk_category,
      result.rekyc_due_date,
      JSON.stringify({ ...result, evaluated_at: new Date().toISOString() }),
    ],
  );
  return rows[0];
}

export const IS_FINAL = (status) => [STATUS.APPROVED, STATUS.REJECTED, STATUS.AUTO_APPROVED, STATUS.AUTO_REJECTED, STATUS.CLOSED_EXPIRED].includes(status);
