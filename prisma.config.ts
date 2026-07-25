import path from 'node:path';

import { defineConfig } from 'prisma/config';

/**
 * Prisma-Konfiguration (ersetzt den veralteten `package.json#prisma`-Block, der
 * mit Prisma 7 entfällt).
 *
 * Wichtig: Sobald eine Config-Datei existiert, lädt Prisma die `.env` NICHT mehr
 * automatisch ("Prisma config detected, skipping environment variable loading").
 * Wir laden sie deshalb hier selbst – dependency-frei über die Node-Standard-
 * funktion `process.loadEnvFile` (dieselbe, die bereits die Test-Setups nutzen).
 * Ist `DATABASE_URL` schon gesetzt (CI/Render, Test-/E2E-Setups mit eigener URL)
 * oder fehlt eine `.env`, wird das Laden übersprungen – ohne Fehler.
 */
if (!process.env.DATABASE_URL) {
  try {
    process.loadEnvFile(path.join(process.cwd(), '.env'));
  } catch {
    // Keine .env-Datei vorhanden – es greifen die echten Umgebungsvariablen.
  }
}

export default defineConfig({
  schema: path.join('prisma', 'schema.prisma'),
  migrations: {
    seed: 'tsx prisma/seed.ts',
  },
});
