import { existsSync } from 'node:fs';
import path from 'node:path';

import { defineConfig, devices } from '@playwright/test';

// .env schon beim Laden der Konfiguration einlesen (E2E_DATABASE_URL für webServer.env).
const envFile = path.resolve(process.cwd(), '.env');
if (existsSync(envFile)) {
  process.loadEnvFile(envFile);
}

/**
 * End-to-End-Tests (Anforderung 26): laufen gegen eine eigene E2E-Datenbank
 * (E2E_DATABASE_URL) mit Mock-Providern – deterministisch, ohne externe APIs.
 * Migration + Seed übernimmt tests/e2e/global-setup.ts.
 */
const PORT = 3200;

export default defineConfig({
  testDir: './tests/e2e',
  globalSetup: './tests/e2e/global-setup.ts',
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${PORT}`,
    locale: 'de-DE',
    timezoneId: 'Europe/Berlin',
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    // Produktions-Server: setzt einen vorhandenen Build voraus (npm run build).
    command: `npx next start -p ${PORT}`,
    url: `http://localhost:${PORT}/login`,
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      DATABASE_URL: process.env.E2E_DATABASE_URL ?? '',
      GEOCODING_PROVIDER: 'mock',
      ROUTING_PROVIDER: 'mock',
      MAIL_PROVIDER: 'console',
      RATE_LIMIT_RELAXED: '1',
    },
  },
});
