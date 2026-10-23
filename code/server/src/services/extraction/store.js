// Runs the provider for one stored document and saves the result: classification on the documents row and one
// extracted_fields row per field. Officer corrections are never overwritten (the unique key is document + field).
import { AUDIT } from '../../constants.js';
import { recordAudit } from '../audit.js';
import { extractDocument } from './index.js';

export async function extractAndStore(client, { application, document, text, actor }) {
  let result;
  try {
    result = await extractDocument({ docId: document.doc_id, text });
  } catch (err) {
    // A failing provider must not lose the application: the document counts as unknown and goes to a human.
    result = { doc_type: 'OTHER', confidence: 0, fields: {}, provider: 'error', known: false, error: err.message };
  }
  await client.query('UPDATE documents SET classified_type = $2, classification_confidence = $3 WHERE id = $1', [
    document.id,
    result.doc_type,
    result.confidence,
  ]);
  for (const [field, f] of Object.entries(result.fields)) {
    await client.query(
      `INSERT INTO extracted_fields (application_id, document_id, doc_id, doc_type, field, value, confidence, source, original_value, original_confidence)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$6,$7)
       ON CONFLICT (document_id, field) DO UPDATE
         SET value = EXCLUDED.value, confidence = EXCLUDED.confidence, doc_type = EXCLUDED.doc_type,
             original_value = EXCLUDED.original_value, original_confidence = EXCLUDED.original_confidence, updated_at = now()
         WHERE extracted_fields.source <> 'OFFICER'`,
      [application.id, document.id, document.doc_id, result.doc_type, field, f.value, f.confidence, result.provider === 'ai' ? 'AI' : 'MOCK'],
    );
  }
  await recordAudit(client, {
    actor,
    eventType: AUDIT.DOCUMENT_EXTRACTED,
    entityType: 'document',
    entityId: `${application.id}/${document.doc_id}`,
    applicationId: application.id,
    documentId: document.doc_id,
    details: {
      provider: result.provider,
      declared_type: document.declared_type,
      extracted_type: result.doc_type,
      confidence: result.confidence,
      fields: Object.keys(result.fields),
      ...(result.error ? { error: result.error } : {}),
    },
  });
  return result;
}
