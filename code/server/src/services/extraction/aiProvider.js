// "ai" provider: delegates extraction to an HTTP service (AI_EXTRACTION_URL). Not used by default - the Web Engineer
// track uses the mock. It exists so the provider can be switched with EXTRACTION_PROVIDER=ai and no code change.
//
// Contract with that service:  POST { doc_id, text }  ->  { doc_type, confidence, fields: { name: { value, confidence } } }
import { config } from '../../config.js';
import { UNKNOWN_DOCUMENT } from './mockProvider.js';

export function createAiProvider({ url = config.extraction.aiUrl, apiKey = config.extraction.aiApiKey, fetchImpl = fetch } = {}) {
  return {
    name: 'ai',
    async extract({ docId, text }) {
      if (!url) throw new Error('EXTRACTION_PROVIDER=ai needs AI_EXTRACTION_URL to be set');
      const res = await fetchImpl(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}) },
        body: JSON.stringify({ doc_id: docId, text }),
        signal: AbortSignal.timeout(15000),
      });
      if (!res.ok) throw new Error(`AI extraction service answered ${res.status}`);
      const body = await res.json();
      const fields = {};
      for (const [k, v] of Object.entries(body.fields || {})) {
        fields[k] = { value: String(v?.value ?? ''), confidence: Math.min(1, Math.max(0, Number(v?.confidence) || 0)) };
      }
      if (!body.doc_type) return { ...UNKNOWN_DOCUMENT, fields: {}, provider: 'ai', known: false };
      return { doc_type: String(body.doc_type).toUpperCase(), confidence: Math.min(1, Math.max(0, Number(body.confidence) || 0)), fields, provider: 'ai', known: true };
    },
  };
}
