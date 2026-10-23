// Extraction provider interface (FR-3). Selected by EXTRACTION_PROVIDER (mock | ai); no code change to switch.
//   provider.extract({ docId, text }) -> { doc_type, confidence, fields: { name: { value, confidence } }, provider, known }
// A document the provider does not know is OTHER with confidence 0 (never an error).
import { config } from '../../config.js';
import { createAiProvider } from './aiProvider.js';
import { createMockProvider } from './mockProvider.js';

let cached = null;
let cachedKey = '';

export function getProvider() {
  const key = `${config.extraction.provider}|${config.extraction.mockFile}`;
  if (!cached || key !== cachedKey) {
    cached = config.extraction.provider === 'ai' ? createAiProvider() : createMockProvider(config.extraction.mockFile);
    cachedKey = key;
  }
  return cached;
}

export const extractDocument = (input) => getProvider().extract(input);
