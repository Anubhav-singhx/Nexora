// For `npm run test:rules` and `npm run test:sample`: these suites need no database, so no global setup here.
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { environment: 'node', include: ['tests/**/*.test.js'], testTimeout: 20000 },
});
