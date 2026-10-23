// Shared audit helper. EVERY module (Person 1, 2, 3) writes audit rows through this function.
// `db` can be the pool or a transaction client, so an audit row commits/rolls back with the action it records.
//
//   await recordAudit(client, {
//     actor: req.user,                       // { id, role } or null for anonymous events
//     eventType: AUDIT.FIELD_CORRECTED,      // always use the AUDIT constants
//     entityType: 'application',
//     entityId: 'A3000001',
//     applicationId: 'A3000001',             // optional; implied when entityType is 'application'
//     documentId: 'DEMO_PAN',                // optional HCL doc_id
//     oldValue: { pan: 'ABCDE1234F' },       // optional, JSON-serialisable
//     newValue: { pan: 'ABCDE1234G' },       // optional
//     details: { reason: 'poor scan' },      // optional
//   });
//
// The table is append-only: a database trigger rejects UPDATE and DELETE.

const json = (v) => (v === undefined || v === null ? null : JSON.stringify(v));

export async function recordAudit(
  db,
  { actor, eventType, entityType, entityId, applicationId, documentId, oldValue, newValue, details },
) {
  // entity 'application' rows are filed under that application automatically
  const appId = applicationId ?? (entityType === 'application' ? entityId : null);
  await db.query(
    `INSERT INTO audit_events (actor_id, role, event_type, entity_type, entity_id, application_id, document_id, old_value, new_value, details)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb, $10::jsonb)`,
    [
      actor?.id ?? null,
      actor?.role ?? null,
      eventType,
      entityType,
      entityId === undefined || entityId === null ? null : String(entityId),
      appId === undefined || appId === null ? null : String(appId),
      documentId ?? null,
      json(oldValue),
      json(newValue),
      json(details),
    ],
  );
}
