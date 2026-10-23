// Audit trail reads. The table is append-only; these endpoints only ever SELECT.
// PANs inside old/new values and details are masked in every API response and export (the raw values stay in the DB).
import { AUDIT, ROLES } from '../constants.js';
import { query } from '../db/index.js';
import { loadApplicationForUser } from '../services/applicationAccess.js';
import { recordAudit } from '../services/audit.js';
import { toCsv } from '../utils/csv.js';
import { maskPanDeep } from '../utils/mask.js';
import { badRequest } from '../utils/errors.js';
import { parseOrThrow } from '../validators/auth.js';
import { dateRangeSchema } from '../validators/staff.js';

const SELECT = `
  SELECT e.id, e.created_at, e.application_id, e.document_id, e.event_type, e.entity_type, e.entity_id,
         e.actor_id, e.role AS actor_role, u.name AS actor_name, e.old_value, e.new_value, e.details
    FROM audit_events e LEFT JOIN users u ON u.id = e.actor_id`;

const present = (r) => ({
  id: Number(r.id),
  at: r.created_at,
  event_type: r.event_type,
  application_id: r.application_id,
  document_id: r.document_id,
  entity_type: r.entity_type,
  entity_id: r.entity_id,
  actor: { id: r.actor_id, role: r.actor_role, name: r.actor_name },
  old_value: maskPanDeep(r.old_value),
  new_value: maskPanDeep(r.new_value),
  details: maskPanDeep(r.details),
});

/** GET /applications/:id/audit  (KYC officer or compliance officer) */
export async function applicationAudit(req, res) {
  const app = await loadApplicationForUser(req.params.id, req.user);
  const { rows } = await query(`${SELECT} WHERE e.application_id = $1 ORDER BY e.id`, [app.id]);
  res.json({ application_id: app.id, count: rows.length, events: rows.map(present) });
}

/** GET /applications/:id/audit/export  (compliance officer) - CSV, PAN masked. The export itself is audited. */
export async function applicationAuditExport(req, res) {
  const app = await loadApplicationForUser(req.params.id, req.user);
  const { rows } = await query(`${SELECT} WHERE e.application_id = $1 ORDER BY e.id`, [app.id]);
  const events = rows.map(present);
  const csv = toCsv(
    ['id', 'timestamp', 'application_id', 'document_id', 'actor_id', 'actor_role', 'event_type', 'entity_type', 'entity_id', 'old_value', 'new_value', 'details'],
    events.map((e) => [
      e.id, new Date(e.at).toISOString(), e.application_id, e.document_id, e.actor.id, e.actor.role, e.event_type, e.entity_type, e.entity_id,
      e.old_value ? JSON.stringify(e.old_value) : '', e.new_value ? JSON.stringify(e.new_value) : '', e.details ? JSON.stringify(e.details) : '',
    ]),
  );
  await recordAudit({ query }, { actor: req.user, eventType: AUDIT.AUDIT_EXPORTED, entityType: 'application', entityId: app.id, details: { rows: events.length } });
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="audit_${app.id}.csv"`);
  res.send(csv);
}

/** GET /compliance/audit?application_id&event_type&actor_role&from&to&limit&offset - search across applications. */
export async function searchAudit(req, res) {
  const { from, to } = parseOrThrow(dateRangeSchema, { from: req.query.from || undefined, to: req.query.to || undefined });
  const limit = Math.min(Math.max(Number(req.query.limit) || 100, 1), 500);
  const offset = Math.max(Number(req.query.offset) || 0, 0);
  if (req.query.actor_role && !Object.values(ROLES).concat('SYSTEM').includes(String(req.query.actor_role))) {
    throw badRequest('VALIDATION_ERROR', 'Unknown actor_role');
  }
  const { rows } = await query(
    `${SELECT}
      WHERE ($1::text IS NULL OR e.application_id = $1)
        AND ($2::text IS NULL OR e.event_type = $2)
        AND ($3::text IS NULL OR e.role = $3)
        AND (e.created_at AT TIME ZONE 'Asia/Kolkata')::date BETWEEN COALESCE($4::date, DATE '1900-01-01') AND COALESCE($5::date, DATE '2999-12-31')
      ORDER BY e.id DESC LIMIT $6 OFFSET $7`,
    [req.query.application_id || null, req.query.event_type || null, req.query.actor_role || null, from || null, to || null, limit, offset],
  );
  res.json({ count: rows.length, limit, offset, events: rows.map(present) });
}
