import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';

/** E2E-Datenbank migrieren und mit den Demo-Daten befüllen. */
export default function globalSetup() {
  const envFile = path.resolve(process.cwd(), '.env');
  if (existsSync(envFile)) {
    process.loadEnvFile(envFile);
  }
  const e2eUrl = process.env.E2E_DATABASE_URL;
  if (!e2eUrl) {
    throw new Error('E2E_DATABASE_URL ist nicht gesetzt (.env). Docker-DB starten: npm run db:up');
  }
  const env = { ...process.env, DATABASE_URL: e2eUrl };
  execSync('npx prisma migrate deploy', { stdio: 'inherit', env });
  execSync('npx prisma db seed', { stdio: 'inherit', env });
}
