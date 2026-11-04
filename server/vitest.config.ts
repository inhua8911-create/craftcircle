import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: {
    environment: 'node',
    globalSetup: ['./src/tests/globalSetup.ts'],
    setupFiles: ['./src/tests/setup.ts'],
    testTimeout: 30000,
    hookTimeout: 60000,
    fileParallelism: false,
  },
});
