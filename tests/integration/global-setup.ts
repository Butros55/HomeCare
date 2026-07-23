import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';

/** Testdatenbank vorbereiten: .env laden, DATABASE_URL umbiegen, Migrationen einspielen. */
export default function globalSetup() {
  const envFile = path.resolve(process.cwd(), '.env');
  if (existsSync(envFile)) {
    process.loadEnvFile(envFile);
  }
  // Tests bleiben deterministisch/offline, egal was .env konfiguriert.
  process.env.GEOCODING_PROVIDER = 'mock';
  process.env.ROUTING_PROVIDER = 'mock';

  const testUrl = process.env.TEST_DATABASE_URL;
  if (!testUrl) {
    throw new Error(
      'TEST_DATABASE_URL ist nicht gesetzt (.env). Docker-DB starten: npm run db:up',
    );
  }
  process.env.DATABASE_URL = testUrl;

  execSync('npx prisma migrate deploy', {
    stdio: 'inherit',
    env: { ...process.env, DATABASE_URL: testUrl },
  });
}
