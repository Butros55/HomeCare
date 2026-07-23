import path from 'node:path';
import { defineConfig } from 'vitest/config';

/**
 * Unit-Tests: reine Logik (src/**), Node-Umgebung, keine Datenbank.
 * Integrationstests laufen separat über vitest.integration.config.ts.
 */
export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
