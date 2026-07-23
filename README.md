# HomeCare Planner

Einsatzplanung für selbstständige Haushaltshilfen, Reinigungsunternehmen und Firmen mit
Haushaltshilfen: **Kunden & Stundenkontingente, Mitarbeiterhierarchien, Termine & Serien,
Kalender, Tagesrouten, Benachrichtigungen, Auswertungen** – als Desktop-Webanwendung und
installierbare PWA.

Der Produktname ist zentral konfigurierbar (`APP_NAME` / `NEXT_PUBLIC_APP_NAME`).

## Technik

Next.js 16 (App Router, TypeScript strict) · PostgreSQL 17 + Prisma 6 · Tailwind CSS 4 ·
Radix UI · FullCalendar 6 · Leaflet · Zod 4 + React Hook Form · eigene DB-Sessions
(Argon2id) · Vitest 4 · Playwright. Details: [docs/architecture.md](docs/architecture.md).

## Voraussetzungen

- Node.js ≥ 20.9 (getestet mit 24)
- Docker (für PostgreSQL)
- npm

## Schnellstart

```bash
npm install
cp .env.example .env       # Werte prüfen; AUTH_SECRET ändern
npm run db:up              # startet PostgreSQL (Docker) inkl. Test-/E2E-Datenbanken
npm run db:migrate         # Migrationen einspielen
npm run db:seed            # Demo-Daten laden
npm run dev                # http://localhost:3000  (bindet 0.0.0.0 → im LAN erreichbar)
```

> **LAN-Zugriff:** `npm run dev` bindet an `0.0.0.0`. Von anderen Geräten:
> `http://<deine-LAN-IP>:3000` (Windows-Firewall beim ersten Start für Node freigeben).
> Zusätzliche Hostnamen/IPs für Dev-Assets: `DEV_ALLOWED_ORIGINS` in `.env`.
> Nur lokal binden: `npm run dev:local`.

## Demo-Benutzer (nur lokale Entwicklung)

Passwort jeweils **`Demo1234!`**

| E-Mail | Rolle |
|---|---|
| `owner@demo.example` | Inhaberin (Katrin Sommer) |
| `dispo@demo.example` | Disponent |
| `maria@demo.example` | Team-Managerin (Team mit 2 Ebenen) |
| `thomas@demo.example` | Team-Manager |
| `anna@demo.example` | Mitarbeiterin |
| `fremd@demo.example` | fremde Organisation (Isolationstests) |

## Skripte

| Befehl | Zweck |
|---|---|
| `npm run dev` / `dev:local` | Entwicklungsserver (mit/ohne LAN-Bindung) |
| `npm run build` / `start` | Produktionsbuild / -server |
| `npm run lint` / `typecheck` | ESLint / TypeScript |
| `npm test` | Unit-Tests (Vitest, ohne DB) |
| `npm run test:integration` | Integrationstests gegen `homecare_test` (DB muss laufen) |
| `npm run test:e2e` | Playwright-E2E gegen `homecare_e2e` (setzt `npm run build` voraus) |
| `npm run db:up` / `db:migrate` / `db:seed` / `db:studio` | Datenbank |
| `npm run icons` | PWA-Platzhalter-Icons erzeugen |
| `npm run retention:cleanup` | Aufbewahrungsfristen anwenden (docs/privacy.md) |

## Umgebungsvariablen

Alle Variablen mit Erklärung: [.env.example](.env.example). Wichtig:

- `DATABASE_URL`, `TEST_DATABASE_URL`, `E2E_DATABASE_URL`
- `AUTH_SECRET` – zufälliger Wert, in Produktion zwingend ändern
- `GEOCODING_PROVIDER` (`mock` | `nominatim`), `ROUTING_PROVIDER` (`mock` | `osrm`) –
  Produktion: Google/Mapbox/ORS/GraphHopper vorbereitet, Schlüssel **nur serverseitig**
- `NEXT_PUBLIC_MAP_TILE_URL` – Karten-Tiles (Standard: OSM, **nur für Entwicklung**;
  Nutzungsrichtlinie beachten → [docs/routing.md](docs/routing.md))
- `APP_NAME` / `NEXT_PUBLIC_APP_NAME` – Produktname

Standardmäßig läuft alles **ohne kostenpflichtige API-Schlüssel** (deterministische
Mock-Provider für Geocoding und Routing).

## Tests

```bash
npm test                   # 100+ Unit-Tests (Stunden, Parser, RRULE, Konflikte, Routenheuristik …)
npm run test:integration   # Mandantentrennung, Hierarchie-Scope, Stundenberechnung, Serien (echte DB)
npm run build && npm run test:e2e   # 12-Schritte-Kernablauf im echten Browser
```

Details: [docs/testing.md](docs/testing.md)

## Dokumentation

| Datei | Inhalt |
|---|---|
| [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md) | Phasenplan, Entscheidungen, Checkliste |
| [docs/architecture.md](docs/architecture.md) | Schichten, Stundenmodell, Serienlogik, Fehlercodes |
| [docs/data-model.md](docs/data-model.md) | ERD (Mermaid) und Modellentscheidungen |
| [docs/permissions.md](docs/permissions.md) | Rollen- und Berechtigungsmatrix, Scopes |
| [docs/routing.md](docs/routing.md) | Karten-/Geocoding-/Routing-Provider, Heuristik |
| [docs/privacy.md](docs/privacy.md) | DSGVO: Datenminimierung, Export, Anonymisierung, Fristen |
| [docs/security.md](docs/security.md) | Auth, Sessions, Header, CSRF, Rate Limits |
| [docs/testing.md](docs/testing.md) | Teststrategie und -abdeckung |

## Bekannte Einschränkungen (MVP)

- UI-Sprache Deutsch (kein i18n-Framework); Kalenderanzeige nutzt die Browser-Zeitzone
  (Annahme: Nutzer arbeiten in der Organisations-Zeitzone; Serienberechnung ist
  serverseitig zeitzonen-korrekt inkl. DST).
- E-Mail-Versand als Konsolen-Adapter (Einladungs-/Reset-Links im Server-Log);
  SMTP/Push/SMS-Adapter vorbereitet, WhatsApp bewusst nicht (rechtliche Prüfung nötig).
- Rate Limiting in-memory pro Prozess (Redis-Adapter als Erweiterungspunkt).
- Offline (PWA): Lesezugriff auf heutige Termine/Route; Offline-Mutationen bewusst
  deaktiviert (kein Risiko stiller Datenverluste).
- Terminfeld „Erinnerung“ ist nicht umgesetzt (benötigt Hintergrund-Jobs); Benachrichtigungen
  entstehen ereignisbasiert.
- Keine Lohn-/Abrechnungsfunktionen (Datenbasis über TimeEntry vorhanden).
# HomeCare
