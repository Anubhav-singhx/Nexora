// Compliance officer (checker) APIs: final decisions, dashboard, configuration, watchlists, re-screening.
import { AUDIT, STATUS, WATCHLIST_REASONS, canTransition } from '../constants.js';
import { query, withTransaction } from '../db/index.js';
import { recordAudit } from '../services/audit.js';
import { assertVersion, lockApplication, transition } from '../services/applicationState.js';
import { loadDocuments, loadFields, loadTimeline } from '../services/applicationAccess.js';
import { toListRow, toStaffView } from '../services/applicantView.js';
import { openAccount } from '../services/coreBanking/index.js';
import { DEFAULT_RULE_CONFIG, CONFIG_KEYS, CONFIG_VALIDATORS, crossCheck } from '../services/kyc/config.js';
import { loadConfigFromDb } from '../services/kyc/references.js';
import { completeAccountOpening, expireOverdue, reevaluate } from '../services/pipeline.js';
import { badRequest, conflict, forbidden, notFound, validationError } from '../utils/errors.js';
import { parseOrThrow } from '../validators/auth.js';
import { dateRangeSchema, decisionSchema, pepEntrySchema, sanctionsEntrySchema } from '../validators/staff.js';

async function staffResponse(applicationId) {
  const { rows } = await query('SELECT * FROM applications WHERE id = $1', [applicationId]);
  const app = rows[0];
  return toStaffView(app, await loadDocuments(app.id), { fields: await loadFields(app.id), timeline: await loadTimeline(app) });
}

/** GET /compliance/pending - PENDING_CHECKER, risk HIGH first, then oldest first; items older than the checker SLA are flagged. */
export async function pendingQueue(req, res) {
  await expireOverdue();
  const slaHours = (await loadConfigFromDb({ query })).checker_sla_hours;
  const { rows } = await query(
    `SELECT a.*, u.name AS maker_name,
            extract(epoch FROM (now() - COALESCE(
              (SELECT max(e.created_at) FROM audit_events e
                WHERE e.application_id = a.id AND e.event_type = 'STATUS_CHANGED' AND e.new_value->>'status' = 'PENDING_CHECKER'),
              a.updated_at))) / 3600 AS hours_waiting
       FROM applications a LEFT JOIN users u ON u.id = a.maker_id
      WHERE a.status = $1
      ORDER BY CASE a.risk_category WHEN 'HIGH' THEN 0 WHEN 'MEDIUM' THEN 1 WHEN 'LOW' THEN 2 ELSE 3 END, a.submitted_at ASC, a.id ASC`,
    [STATUS.PENDING_CHECKER],
  );
  res.json({
    count: rows.length,
    sla_hours: slaHours,
    overdue_count: rows.filter((a) => Number(a.hours_waiting) > slaHours).length,
    applications: rows.map((a) => ({
      ...toListRow(a),
      maker_name: a.maker_name,
      maker_comment: a.maker_comment,
      recommended_by: a.maker_id ? 'KYC_OFFICER' : 'SYSTEM',
      hours_waiting: Math.round(Number(a.hours_waiting) * 10) / 10,
      sla_overdue: Number(a.hours_waiting) > slaHours,
    })),
  });
}

/**
 * POST /compliance/:id/decision   body: { decision: APPROVE|REJECT|SEND_BACK, comment, version }
 * 403 if the checker is the maker of this case, 409 on a stale version or an illegal transition.
 * APPROVE opens the (mock) core-banking account first; if that fails nothing changes and the checker can retry.
 */
export async function decide(req, res) {
  const body = parseOrThrow(decisionSchema, req.body);
  const target = { APPROVE: STATUS.APPROVED, REJECT: STATUS.REJECTED, SEND_BACK: STATUS.IN_REVIEW }[body.decision];

  const guard = (app) => {
    if (app.maker_id && app.maker_id === req.user.id) {
      throw forbidden('You cannot give final approval on a case you recommended yourself');
    }
    assertVersion(app, body.version);
    if (!canTransition(app.status, target)) {
      throw conflict('INVALID_TRANSITION', `An application in status ${app.status} cannot move to ${target}`, { from: app.status, to: target });
    }
  };

  const { rows } = await query('SELECT * FROM applications WHERE id = $1', [req.params.id]);
  if (!rows[0]) throw notFound('Application not found');
  guard(rows[0]);

  let ids = null;
  if (body.decision === 'APPROVE') {
    try {
      ids = await openAccount(rows[0]);
    } catch (err) {
      await recordAudit({ query }, { actor: req.user, eventType: AUDIT.CORE_ACCOUNT_FAILED, entityType: 'application', entityId: rows[0].id, details: { error: err.message } });
      throw err; // 502: the application stays PENDING_CHECKER
    }
  }

  await withTransaction(async (client) => {
    const app = await lockApplication(client, req.params.id);
    guard(app);
    const checker = { checker_id: req.user.id, checker_decision: body.decision, checker_comment: body.comment || null, checker_at: new Date() };
    const clearMaker = body.decision === 'SEND_BACK' ? { maker_id: null, maker_recommendation: null, maker_comment: null, maker_at: null } : {};
    await recordAudit(client, {
      actor: req.user,
      eventType: AUDIT.CHECKER_DECIDED,
      entityType: 'application',
      entityId: app.id,
      oldValue: { maker_recommendation: app.maker_recommendation, maker_id: app.maker_id },
      newValue: { decision: body.decision },
      details: { comment: body.comment || null },
    });
    await transition(client, app, target, {
      actor: req.user,
      set: { ...checker, ...clearMaker, ...(ids ? { core_customer_id: ids.customerId, core_account_id: ids.accountId } : {}) },
      details: { decision: body.decision },
    });
    if (ids) {
      await recordAudit(client, {
        actor: req.user, eventType: AUDIT.CORE_ACCOUNT_CREATED, entityType: 'application', entityId: app.id,
        newValue: { customer_id: ids.customerId, account_id: ids.accountId },
      });
    }
  });
  res.json({ application: await staffResponse(req.params.id) });
}

/** POST /compliance/:id/open-account - retries a failed account creation for an approved application (idempotent). */
export async function openAccountRetry(req, res) {
  const { rows } = await query('SELECT id FROM applications WHERE id = $1', [req.params.id]);
  if (!rows[0]) throw notFound('Application not found');
  await completeAccountOpening(req.params.id, req.user);
  res.json({ application: await staffResponse(req.params.id) });
}

// ------------------------------------------------------------------ dashboard
function range(req) {
  const { from, to } = parseOrThrow(dateRangeSchema, { from: req.query.from || undefined, to: req.query.to || undefined });
  return { from: from || null, to: to || null };
}

/**
 * GET /compliance/dashboard?from=YYYY-MM-DD&to=YYYY-MM-DD   (dates are IST calendar dates of the submission)
 * Every number is computed from the stored rows; nothing is estimated. See `definitions` in the response.
 */
export async function dashboard(req, res) {
  await expireOverdue();
  const { from, to } = range(req);
  const where = `(a.submitted_at AT TIME ZONE 'Asia/Kolkata')::date BETWEEN COALESCE($1::date, DATE '1900-01-01') AND COALESCE($2::date, DATE '2999-12-31')`;
  const p = [from, to];

  const [total, byStatus, byDecision, byRisk, reasons, review, daily] = await Promise.all([
    query(`SELECT count(*)::int AS n FROM applications a WHERE ${where}`, p),
    query(`SELECT status, count(*)::int AS n FROM applications a WHERE ${where} GROUP BY status`, p),
    query(`SELECT decision, count(*)::int AS n FROM applications a WHERE ${where} AND decision IS NOT NULL GROUP BY decision`, p),
    query(`SELECT risk_category, count(*)::int AS n FROM applications a WHERE ${where} AND risk_category IS NOT NULL GROUP BY risk_category`, p),
    query(
      `SELECT code, count(*)::int AS n FROM applications a, unnest(a.reason_codes) AS code
        WHERE ${where} GROUP BY code ORDER BY n DESC, code LIMIT 5`,
      p,
    ),
    query(
      `WITH entered AS (
         SELECT e.id, e.application_id, e.created_at AS entered_at
           FROM audit_events e JOIN applications a ON a.id = e.application_id
          WHERE e.event_type = 'STATUS_CHANGED' AND e.new_value->>'status' = 'IN_REVIEW' AND ${where}
       ), spans AS (
         SELECT en.application_id, en.entered_at,
                (SELECT min(x.created_at) FROM audit_events x
                  WHERE x.application_id = en.application_id AND x.event_type = 'STATUS_CHANGED'
                    AND x.old_value->>'status' = 'IN_REVIEW' AND x.id > en.id) AS left_at
           FROM entered en)
       SELECT count(*) FILTER (WHERE left_at IS NOT NULL)::int AS completed,
              count(*) FILTER (WHERE left_at IS NULL)::int AS open,
              round((avg(extract(epoch FROM (left_at - entered_at)) / 3600) FILTER (WHERE left_at IS NOT NULL))::numeric, 3) AS avg_hours
         FROM spans`,
      p,
    ),
    query(
      `SELECT to_char((a.submitted_at AT TIME ZONE 'Asia/Kolkata')::date, 'YYYY-MM-DD') AS day, count(*)::int AS submitted,
              count(*) FILTER (WHERE a.status IN ('APPROVED','AUTO_APPROVED'))::int AS approved,
              count(*) FILTER (WHERE a.status IN ('REJECTED','AUTO_REJECTED'))::int AS rejected
         FROM applications a WHERE ${where} GROUP BY 1 ORDER BY 1`,
      p,
    ),
  ]);

  const status = Object.fromEntries(Object.values(STATUS).map((s) => [s, 0]));
  byStatus.rows.forEach((r) => (status[r.status] = r.n));
  const decision = { APPROVE: 0, REVIEW: 0, REJECT: 0 };
  byDecision.rows.forEach((r) => (decision[r.decision] = r.n));
  const risk = { LOW: 0, MEDIUM: 0, HIGH: 0 };
  byRisk.rows.forEach((r) => (risk[r.risk_category] = r.n));
  const decided = decision.APPROVE + decision.REVIEW + decision.REJECT;
  const approved = status.APPROVED + status.AUTO_APPROVED;
  const rejected = status.REJECTED + status.AUTO_REJECTED;
  const rate = (n) => (decided ? Math.round((n / decided) * 1000) / 1000 : null);
  const rv = review.rows[0];
  const slaHours = (await loadConfigFromDb({ query })).checker_sla_hours;
  const overdue = await query(
    `SELECT count(*)::int AS n FROM applications a
      WHERE a.status = 'PENDING_CHECKER' AND now() - COALESCE(
        (SELECT max(e.created_at) FROM audit_events e WHERE e.application_id = a.id AND e.event_type = 'STATUS_CHANGED' AND e.new_value->>'status' = 'PENDING_CHECKER'),
        a.updated_at) > make_interval(secs => $1 * 3600)`,
    [slaHours],
  );
  const sla = { hours: slaHours, overdue: overdue.rows[0].n };

  res.json({
    range: { from, to },
    total: total.rows[0].n,
    by_status: status,
    rule_decisions: { ...decision, decided },
    final_outcomes: { approved, rejected, closed_expired: status.CLOSED_EXPIRED, in_progress: total.rows[0].n - approved - rejected - status.CLOSED_EXPIRED },
    risk,
    pending_checker: status.PENDING_CHECKER,
    in_review: status.IN_REVIEW,
    straight_through_rate: rate(status.AUTO_APPROVED),
    review_rate: rate(decision.REVIEW),
    reject_rate: rate(decision.REJECT),
    checker_sla_hours: sla.hours,
    pending_checker_overdue: sla.overdue,
    top_reasons: reasons.rows,
    review_time: { avg_hours: rv.avg_hours === null ? null : Number(rv.avg_hours), completed_reviews: rv.completed, open_reviews: rv.open },
    daily: daily.rows,
    definitions: {
      total: 'Applications submitted in the selected IST date range',
      rule_decisions: 'Latest engine outcome per application; "decided" = applications that have an engine outcome',
      final_outcomes: 'approved = APPROVED + AUTO_APPROVED; rejected = REJECTED + AUTO_REJECTED',
      straight_through_rate: 'AUTO_APPROVED / decided (decided = applications the rules have decided on)',
      review_rate: 'Applications whose latest rules outcome is REVIEW / decided',
      reject_rate: 'Applications whose latest rules outcome is REJECT / decided',
      pending_checker: 'Applications waiting in PENDING_CHECKER right now; overdue = waiting longer than the checker SLA (hours)',
      review_time: 'Time between entering and leaving IN_REVIEW, taken from the audit trail; only completed reviews are averaged',
      top_reasons: 'The 5 most frequent reason codes on the latest rules outcome, counted per application',
    },
  });
}

// ------------------------------------------------------------------ rule configuration
export async function getConfig(req, res) {
  const { rows } = await query('SELECT c.key, c.value, c.version, c.updated_at, u.name AS updated_by FROM rule_config c LEFT JOIN users u ON u.id = c.updated_by ORDER BY c.key');
  const stored = new Map(rows.map((r) => [r.key, r]));
  res.json({
    config: CONFIG_KEYS.map((key) => {
      const r = stored.get(key);
      return { key, value: r ? r.value : DEFAULT_RULE_CONFIG[key], default: DEFAULT_RULE_CONFIG[key], version: r ? r.version : 0, updated_at: r?.updated_at ?? null, updated_by: r?.updated_by ?? null };
    }),
  });
}

/** PATCH /compliance/config   body: { changes: { key: value, ... } } - applies to the next evaluation, no restart. */
export async function patchConfig(req, res) {
  const changes = req.body?.changes;
  if (!changes || typeof changes !== 'object' || Array.isArray(changes) || !Object.keys(changes).length) {
    throw badRequest('VALIDATION_ERROR', 'Send { "changes": { "<key>": <value> } }');
  }
  const problems = [];
  const clean = {};
  for (const [key, value] of Object.entries(changes)) {
    if (!CONFIG_KEYS.includes(key)) {
      problems.push({ field: key, message: 'Unknown configuration key' });
      continue;
    }
    const r = CONFIG_VALIDATORS[key].safeParse(value);
    if (r.success) clean[key] = r.data;
    else problems.push({ field: key, message: r.error.issues.map((i) => i.message).join('; ') });
  }
  if (problems.length) throw validationError(problems);

  await withTransaction(async (client) => {
    const current = await loadConfigFromDb(client);
    const merged = { ...current, ...clean };
    const cross = crossCheck(merged);
    if (cross.length) throw validationError(cross.map((m) => ({ field: 'changes', message: m })));
    const { rows } = await client.query('SELECT key, value, version FROM rule_config');
    const old = new Map(rows.map((r) => [r.key, r]));
    for (const [key, value] of Object.entries(clean)) {
      const before = old.get(key);
      await client.query(
        `INSERT INTO rule_config (key, value, version, updated_by) VALUES ($1, $2::jsonb, 1, $3)
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, version = rule_config.version + 1, updated_by = EXCLUDED.updated_by, updated_at = now()`,
        [key, JSON.stringify(value), req.user.id],
      );
      await recordAudit(client, {
        actor: req.user, eventType: AUDIT.CONFIG_UPDATED, entityType: 'config', entityId: key,
        oldValue: { value: before ? before.value : current[key], version: before?.version ?? 0 }, newValue: { value, version: (before?.version ?? 0) + 1 },
      });
    }
  });
  return getConfig(req, res);
}

// ------------------------------------------------------------------ watchlists
const LISTS = {
  sanctions: { table: 'sanctions_entries', schema: sanctionsEntrySchema, cols: ['list_id', 'name', 'aliases', 'dob', 'nationality', 'program'], prefix: 'SAN' },
  pep: { table: 'pep_entries', schema: pepEntrySchema, cols: ['pep_id', 'name', 'aliases', 'dob', 'position', 'category'], prefix: 'PEP' },
};
const listOf = (name) => {
  const l = LISTS[String(name).toLowerCase()];
  if (!l) throw badRequest('VALIDATION_ERROR', 'list must be "sanctions" or "pep"');
  return l;
};

export async function listWatchlist(req, res) {
  const l = listOf(req.query.list || 'sanctions');
  const q = String(req.query.q || '').trim();
  const { rows } = await query(
    `SELECT * FROM ${l.table} WHERE $1 = '' OR name ILIKE '%' || $1 || '%' OR EXISTS (SELECT 1 FROM unnest(aliases) a WHERE a ILIKE '%' || $1 || '%') ORDER BY id`,
    [q],
  );
  res.json({ list: String(req.query.list || 'sanctions').toLowerCase(), count: rows.length, entries: rows });
}

export async function createWatchlistEntry(req, res) {
  const l = listOf(req.body?.list);
  const data = parseOrThrow(l.schema, req.body);
  const result = await withTransaction(async (client) => {
    const idCol = l.cols[0];
    const { rows: seq } = await client.query(`SELECT COALESCE(max(id), 0) + 1 AS n FROM ${l.table}`);
    const code = data[idCol] || `${l.prefix}${String(seq[0].n).padStart(4, '0')}`;
    const values = l.cols.map((c) => (c === idCol ? code : c === 'aliases' ? data.aliases : data[c] ?? null));
    const { rows } = await client.query(
      `INSERT INTO ${l.table} (${l.cols.join(', ')}) VALUES (${l.cols.map((_, i) => `$${i + 1}`).join(', ')}) RETURNING *`,
      values,
    );
    await recordAudit(client, {
      actor: req.user, eventType: AUDIT.WATCHLIST_UPDATED, entityType: 'watchlist', entityId: `${req.body.list}/${rows[0].id}`,
      newValue: rows[0], details: { action: 'CREATE' },
    });
    return rows[0];
  });
  res.status(201).json({ entry: result, rescreen_recommended: true });
}

export async function updateWatchlistEntry(req, res) {
  const l = listOf(req.params.list);
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) throw badRequest('VALIDATION_ERROR', 'Invalid id');
  const partial = parseOrThrow(l.schema.partial(), req.body);
  // only fields that were actually sent are updated (schema defaults such as aliases must not wipe stored values)
  const keys = Object.keys(req.body || {}).filter((k) => l.cols.includes(k) && partial[k] !== undefined);
  if (!keys.length) throw badRequest('VALIDATION_ERROR', 'Nothing to update');
  const entry = await withTransaction(async (client) => {
    const { rows: cur } = await client.query(`SELECT * FROM ${l.table} WHERE id = $1 FOR UPDATE`, [id]);
    if (!cur[0]) throw notFound('Entry not found');
    const { rows } = await client.query(
      `UPDATE ${l.table} SET ${keys.map((k, i) => `${k} = $${i + 2}`).join(', ')} WHERE id = $1 RETURNING *`,
      [id, ...keys.map((k) => partial[k])],
    );
    await recordAudit(client, {
      actor: req.user, eventType: AUDIT.WATCHLIST_UPDATED, entityType: 'watchlist', entityId: `${req.params.list}/${id}`,
      oldValue: cur[0], newValue: rows[0], details: { action: 'UPDATE' },
    });
    return rows[0];
  });
  res.json({ entry, rescreen_recommended: true });
}

export async function deleteWatchlistEntry(req, res) {
  const l = listOf(req.params.list);
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) throw badRequest('VALIDATION_ERROR', 'Invalid id');
  await withTransaction(async (client) => {
    const { rows } = await client.query(`DELETE FROM ${l.table} WHERE id = $1 RETURNING *`, [id]);
    if (!rows[0]) throw notFound('Entry not found');
    await recordAudit(client, {
      actor: req.user, eventType: AUDIT.WATCHLIST_UPDATED, entityType: 'watchlist', entityId: `${req.params.list}/${id}`,
      oldValue: rows[0], details: { action: 'DELETE' },
    });
  });
  res.json({ deleted: true, rescreen_recommended: true });
}

/**
 * POST /compliance/rescreen   body: { application_ids?: [...] }
 * Re-runs the rules for open cases (IN_REVIEW, PENDING_CHECKER) with the CURRENT watchlists and configuration.
 * A case waiting for the checker that picks up a new watchlist reason goes back to IN_REVIEW.
 */
export async function rescreen(req, res) {
  const ids = Array.isArray(req.body?.application_ids) ? req.body.application_ids.map(String) : null;
  const { rows } = await query(
    `SELECT id FROM applications WHERE status = ANY($1::text[]) AND ($2::text[] IS NULL OR id = ANY($2::text[])) ORDER BY id`,
    [[STATUS.IN_REVIEW, STATUS.PENDING_CHECKER], ids],
  );
  const changed = [];
  for (const { id } of rows) {
    await withTransaction(async (client) => {
      const app = await lockApplication(client, id);
      if (![STATUS.IN_REVIEW, STATUS.PENDING_CHECKER].includes(app.status)) return;
      const { application, result, before, changed: didChange } = await reevaluate(client, app, { actor: req.user, reason: 're-screen', onlyIfChanged: true });
      if (!didChange) return;
      let statusAfter = application.status;
      const newWatchlist = result.reason_codes.some((c) => WATCHLIST_REASONS.includes(c) && !before.reason_codes.includes(c));
      if (application.status === STATUS.PENDING_CHECKER && newWatchlist) {
        const moved = await transition(client, application, STATUS.IN_REVIEW, {
          actor: req.user,
          set: { maker_id: null, maker_recommendation: null, maker_comment: null, maker_at: null },
          details: { reason: 'new watchlist hit after re-screen' },
        });
        statusAfter = moved.status;
      }
      changed.push({
        application_id: id,
        before: { decision: before.decision, reason_codes: before.reason_codes, risk_category: before.risk_category },
        after: { decision: result.decision, reason_codes: result.reason_codes, risk_category: result.risk_category },
        status: statusAfter,
      });
    });
  }
  await recordAudit({ query }, {
    actor: req.user, eventType: AUDIT.RESCREEN_RUN, entityType: 'config', entityId: 'rescreen',
    details: { checked: rows.length, changed: changed.map((c) => c.application_id) },
  });
  res.json({ checked: rows.length, changed_count: changed.length, changed });
}

