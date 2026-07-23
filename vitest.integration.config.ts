import path from 'node:path';
import { defineConfig } from 'vitest/config';

/**
 * Integrationstests: laufen gegen die Test-Datenbank (TEST_DATABASE_URL,
 * angelegt durch docker compose / scripts/db-init). Migrationen werden im
 * globalSetup eingespielt; die Suites räumen ihre Daten selbst auf.
 */
export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      // Server-Module außerhalb von Next testbar machen.
      'server-only': path.resolve(__dirname, './tests/integration/stubs/server-only.ts'),
    },
  },
  test: {
    environment: 'node',
    include: ['tests/integration/**/*.test.ts'],
    globalSetup: ['./tests/integration/global-setup.ts'],
    // DB-Suites nacheinander (gemeinsame Datenbank).
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
