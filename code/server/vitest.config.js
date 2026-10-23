import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.js'],
    globalSetup: ['tests/globalSetup.js'],
    setupFiles: ['tests/setupEnv.js'],
    fileParallelism: false, // all files share one test database
    testTimeout: 20000,
    hookTimeout: 30000,
  },
});
