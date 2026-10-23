// KYC engine entry points.
//   evaluate(app, documents, refs, config)  -> pure rules (rules.js); used by batch, tests and everything below
//   evaluateStored(db, applicationId)       -> loads one stored application + its ACTIVE documents + extracted fields +
//                                              reference data + rule_config from the database, then calls evaluate()
export { DEFAULT_RULE_CONFIG, buildConfig } from './config.js';
export { evaluate, ENGINE_VERSION, RULES, selectDocuments } from './rules.js';
import { evaluate } from './rules.js';
import { loadConfigFromDb, loadReferencesFromDb } from './references.js';

/** Builds the engine's document list from document rows and extracted_fields rows. */
export function buildEngineDocuments(docRows, fieldRows) {
  const byDoc = new Map();
  for (const f of fieldRows) {
    if (!byDoc.has(f.document_id)) byDoc.set(f.document_id, {});
    byDoc.get(f.document_id)[f.field] = { value: f.value, confidence: Number(f.confidence), source: f.source };
  }
  return docRows.map((d) => ({
    doc_id: d.doc_id,
    declared_type: d.declared_type,
    classified_type: d.classified_type,
    classification_confidence: d.classification_confidence === null ? null : Number(d.classification_confidence),
    fields: byDoc.get(d.id) || {},
  }));
}

export function toEngineApplication(a) {
  return {
    application_id: a.id,
    full_name: a.full_name,
    dob: a.dob,
    pan_number: a.pan,
    aadhaar_last4: a.aadhaar_last4,
    pincode: a.pincode,
    occupation_code: a.occupation,
    annual_income: a.annual_income,
    application_date: a.application_date,
  };
}

export async function evaluateStored(db, applicationId, preloaded = {}) {
  const { rows: appRows } = await db.query('SELECT * FROM applications WHERE id = $1', [applicationId]);
  if (!appRows[0]) throw new Error(`Application ${applicationId} not found`);
  const { rows: docRows } = await db.query(
    'SELECT * FROM documents WHERE application_id = $1 AND superseded = FALSE ORDER BY id',
    [applicationId],
  );
  const { rows: fieldRows } = await db.query(
    `SELECT f.* FROM extracted_fields f JOIN documents d ON d.id = f.document_id
      WHERE f.application_id = $1 AND d.superseded = FALSE`,
    [applicationId],
  );
  const refs = preloaded.refs || (await loadReferencesFromDb(db));
  const config = preloaded.config || (await loadConfigFromDb(db));
  return evaluate(toEngineApplication(appRows[0]), buildEngineDocuments(docRows, fieldRows), refs, config);
}
