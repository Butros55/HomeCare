# IMPLEMENTATION_PLAN – HomeCare Planner

> Einsatzplanung für Haushaltshilfen: Kunden, Stundenkontingente, Mitarbeiterhierarchien,
> Termine/Serien, Kalender, Routen, Benachrichtigungen, Auswertungen – als Desktop-Web-App und PWA.

Stand: 2026-07-22 · Arbeitsname: **HomeCare Planner** (zentral konfigurierbar über `APP_NAME` / `src/lib/app-config.ts`)

---

## 1. Bestandsaufnahme (PHASE 0)

Das Repository `C:\dev\L` war zu Projektbeginn **vollständig leer**:

- keine Programmiersprache, kein Framework, keine Datenbank, keine Auth, keine UI, keine Tests,
- keine Docker-Konfiguration, keine Konventionen, keine Module, keine Umgebungsvariablen,
- kein Git-Repository (wurde initialisiert).

Verfügbares lokales Tooling: Node.js 24.14, npm 11.11, Docker 29.6 (Daemon läuft), Git 2.53, Windows 10.

**Konsequenz:** Es gibt keine bestehende Architektur, an die angepasst werden muss.
Es gilt die vorgegebene Standardarchitektur (Next.js App Router, TypeScript strict, PostgreSQL, Prisma, Tailwind, shadcn-artiges UI-System, Zod, RHF, Auth-Sessions, date-fns, FullCalendar, Vitest, Playwright, Docker Compose).

## 2. Architektur- und Versionsentscheidungen

Versionsprüfung gegen die npm-Registry am 2026-07-22. Mehrere Ökosystem-Majors sind erst sehr kurz
veröffentlicht (TypeScript 7.0, Prisma 7.9, FullCalendar 7.0, ESLint 10). Gewählt werden die
**aktuellen, breit erprobten stabilen Linien**, die nachweislich zueinander kompatibel sind:

| Baustein | Wahl | Begründung |
|---|---|---|
| Framework | **Next.js 16.2 (App Router, Turbopack)** | aktuelle stabile Major-Linie (16.2.11), React 19.2 |
| Sprache | **TypeScript 5.9 (strict)** | TS 7 (Go-Port) ist brandneu; 5.9 ist die erprobte stabile Linie |
| Datenbank | **PostgreSQL 17 (Docker Compose)** | stabil, von Prisma 6 voll unterstützt |
| ORM | **Prisma 6.19** | Prisma 7 ist eine sehr junge Major-Umstellung (neue Config/Client-Generierung); 6.19 ist aktuell gepflegt und risikoarm; Migrationspfad dokumentiert |
| Styling | **Tailwind CSS 4.3** | CSS-first-Konfiguration |
| UI | **shadcn/ui-kompatible Komponenten (Radix UI)** | zugänglich (WAI-ARIA), im Repo versioniert |
| Formulare | **React Hook Form 7.82 + @hookform/resolvers 5 + Zod 4.4** | Zod validiert Client **und** Server |
| Server-State | **TanStack Query 5** | nur für interaktive Bereiche (Kalender, Routen); sonst RSC/Server Actions |
| Auth | **Eigene sessionbasierte Auth nach dem etablierten Lucia-Muster** | DB-Sessions (widerrufbar), HttpOnly/SameSite-Cookies, Argon2id (`@node-rs/argon2`). Auth.js v5 erzwingt bei Credentials-Login JWT-Sessions ohne DB-Widerruf – das erfüllt die Sicherheitsanforderungen schlechter. |
| Datum/Zeit | **date-fns 4 + @date-fns/tz** | Zeitzonen-korrekte Serienberechnung |
| Wiederholungen | **rrule 2.8 (RFC-5545-RRULE)** | standardisiertes Format in DB |
| Kalender | **FullCalendar 6.1.21** (dayGrid, timeGrid, list, multiMonth, interaction) | v7.0 ist wenige Wochen alt; 6.1 deckt Jahr/Monat/Woche/Tag/Liste + Drag-and-drop ab (MIT) |
| Karte | **Leaflet 1.9 + react-leaflet 5** | providerunabhängig, konfigurierbare Tiles |
| Geocoding/Routing | **Provider-Interfaces + Mock/Nominatim/OSRM-Adapter** | lokal ohne API-Schlüssel lauffähig; Google/Mapbox/ORS als konfigurierbare Produktion-Adapter |
| Unit/Integration | **Vitest 4** | Unit (node env) + Integrationstests gegen Test-DB |
| E2E | **Playwright 1.61** | eigener E2E-Datenbestand, Mock-Provider |
| Lint | **ESLint 9 + eslint-config-next 16** | Flat Config |
| PWA | **Web-Manifest + handgeschriebener Service Worker** | volle Kontrolle über Offline-Verhalten, keine Zusatzabhängigkeit |
| Diagramme | **eigene, schlanke SVG-Diagramme** | „einfache Diagramme" lt. Anforderung, keine Zusatzabhängigkeit |

### Grundprinzipien

- **Alle Zeitmengen intern als ganzzahlige Minuten** (keine Gleitkommazahlen für Stunden).
- **Mandantentrennung:** jeder Geschäftsdatensatz trägt `organizationId`; jede Server-Operation prüft Scope serverseitig.
- **Businesslogik in `src/server/**` (Services/Repositories), nicht in React-Komponenten.**
- **Soft Delete** (`deletedAt`) für Kunden, Mitarbeiter, Termine.
- **Audit Log** für alle wichtigen Mutationen.
- **Fehlercodes** einheitlich (`AUTH_REQUIRED`, `ACCESS_DENIED`, `ORGANIZATION_SCOPE_VIOLATION`, `HOUR_BUDGET_EXCEEDED`, `APPOINTMENT_CONFLICT`, `ROUTE_NOT_FEASIBLE`, `GEOCODING_AMBIGUOUS`, …).
- **Serientermine:** RRULE + Ausnahmen (`AppointmentSeriesException`), Materialisierungshorizont 120 Tage, bedarfsgesteuerte Erweiterung.
- **Stundenlogik:** Budget / Zuweisung / Planung / Ist-Zeit strikt getrennt (siehe `docs/architecture.md`).

### Verzeichnisstruktur

```
prisma/                Schema, Migrationen, Seeds
public/                Manifest, Icons, Service Worker
scripts/               Hilfsskripte (Icon-Generierung, Retention-Cleanup)
docs/                  architecture, data-model, permissions, routing, privacy, security, testing
src/
  app/                 Routen (App Router): (auth)/, (app)/dashboard|calendar|customers|employees|routes|notifications|reports|settings
  components/          UI-Basiskomponenten (shadcn-kompatibel), Layout-Bausteine
  features/            Feature-UI (auth, dashboard, calendar, customers, employees, hours, appointments, routing, notifications, reports)
  server/              auth/, permissions/, services/, repositories/, providers/, validation/, audit
  lib/                 Reine Logik (duration, dates, recurrence, conflicts, routing-heuristik, utils) – unit-getestet
  types/               Gemeinsame Typen
tests/
  integration/         DB-gebundene Tests (eigene Test-DB)
  e2e/                 Playwright (eigene E2E-DB, Mock-Provider)
```

## 3. Entscheidungen & Annahmen (fortlaufend)

| # | Entscheidung / Annahme | Begründung |
|---|---|---|
| A1 | UI-Sprache Deutsch, Datums-/Zahlenformat `de-DE`, Standard-Zeitzone `Europe/Berlin` (pro Organisation konfigurierbar) | Zielgruppe; i18n-Framework bewusst nicht im MVP (bekannte Einschränkung) |
| A2 | Auth per E-Mail + Passwort; Registrierung erstellt Organisation + Owner; Mitarbeiter kommen per Einladungslink | einfachster sicherer Start ohne externe Provider |
| A3 | E-Mail-Versand im Dev als Konsolen-Adapter (Einladung/Passwort-Reset-Links werden geloggt) | kein SMTP-Zugang vorhanden; Adapter-Interface für Produktion vorbereitet |
| A4 | Stunden-Pools: Zuweisung aus Org-Budget (`allocatedByEmployeeId = null`) verbraucht Kundenbudget; Weitergabe durch Manager (`allocatedByEmployeeId = Manager`) verbraucht dessen Pool, nicht erneut das Kundenbudget | verhindert Doppelzählung, bildet Hierarchie-Weitergabe sauber ab |
| A5 | Geplante Minuten = Termine mit Status PLANNED/CONFIRMED/IN_PROGRESS/COMPLETED (ohne CANCELLED/NO_SHOW/DRAFT); geleistete Minuten = COMPLETED-Termine (Ist-Zeit aus TimeEntry, sonst Termin-Dauer) | klare, dokumentierte Kennzahlendefinition |
| A6 | Serien werden 120 Tage im Voraus materialisiert (`materializedUntil`), Kalenderabfragen jenseits des Horizonts stoßen Erweiterung an | begrenzte Datenmenge, korrekte Zukunftssicht |
| A7 | Karten-Tiles im Dev: OpenStreetMap-Demo-Tiles; Produktion: konfigurierbarer Tile-/Style-Provider (`MAP_TILE_URL`); Hinweis auf OSM-Nutzungsrichtlinie dokumentiert | Anforderung 16 |
| A8 | Mock-Routing/Geocoding: deterministisch (Haversine, 30 km/h + Stopp-Overhead; Koordinaten-Hash) – Standard in Dev/Tests | ohne kostenpflichtige Schlüssel voll lauffähig/testbar |
| A9 | Adressen: eine Hauptadresse pro Kunde im MVP (Modell erlaubt mehrere); Org-/Mitarbeiter-Start/Ziel als strukturierte JSON-Standorte | Spec-Felder `startLocation`/`endLocation` |
| A10 | Rate Limiting in-memory pro Prozess (Login/Reset/Register); Redis-Adapter als spätere Erweiterung dokumentiert | MVP ohne zusätzliche Infrastruktur |
| A11 | RoutePlan eindeutig je (Mitarbeiter, Datum); Neuberechnung überschreibt Entwurf, Freigabe setzt Status PUBLISHED | einfaches, nachvollziehbares Modell |
| A12 | Offline (PWA): Lesezugriff auf heutige Termine/Route (Runtime-Cache); Offline-Mutationen bewusst deaktiviert und gekennzeichnet | Anforderung 21, kein Datenverlust-Risiko |
| A13 | Kein `middleware.ts`/`proxy.ts`: Auth-Gate im Server-Layout + pro Aktion; CSRF über SameSite=Lax + Origin-Prüfung der Server Actions (Next-Standard) + POST-only Mutationen | weniger bewegliche Teile, Prüfung ohnehin serverseitig pro Operation |
| A14 | Demo-Kunden geographisch um Münster (Westf.) mit festen Seed-Koordinaten (kein Live-Geocoding im Seed) | deterministisch, realistisch |
| A15 | CSP pragmatisch (`script-src 'self' 'unsafe-inline'` u. a. wegen Inline-Bootstrapping von Next/FullCalendar); übrige Security-Header strikt; Nonce-CSP als Härtungsoption dokumentiert | Abwägung in `docs/security.md` |
| A16 | TimeEntry im MVP: manueller Start/Stopp bzw. Nacherfassung je Termin durch den Mitarbeiter, Freigabe durch Manager/Disponent | „optionale Zeiterfassung" |
| A17 | Auswertungen aggregieren live über indizierte Queries (kein Vorab-Aggregat) | Datenmengen im MVP klein; Aggregationsservice gekapselt |
| A19 | UI-Design 1:1 nach der Coreflow-Referenz im Repo (Token-System, Pill-Buttons, Panels, Status-Pills); Coreflow/ selbst bleibt unangetastet und ist von Build/Lint/Git ausgeschlossen | Nutzerwunsch: Design übernehmen, Logik nicht |
| A20 | Auth-Formulare als Progressive-Enhancement-Server-Actions (useActionState): POST auch ohne JS, Inline-Fehler; Dev-Server bindet 0.0.0.0 (npm run dev), DEV_ALLOWED_ORIGINS für LAN-Origins | behebt GET-Credential-Leak vor Hydration; LAN-Anforderung |
| A18 | Benutzer können mehreren Organisationen angehören; aktive Organisation via Cookie, serverseitig gegen Mitgliedschaft validiert | Mandantenfähigkeit |

## 4. Phasenplan & Status

| Phase | Inhalt | Status |
|---|---|---|
| 0 | Repositoryanalyse, Plan, Risiken | ✅ abgeschlossen |
| 1 | Projektgrundlage: Tooling, Docker, DB, UI-System, Grundlayout, Env, Lint/Tests | ✅ abgeschlossen |
| 2 | Auth, Sessions, Organisationen, Rollen, serverseitige Berechtigungen, Mandantentrennung | ✅ abgeschlossen (Einladungs-Annahme folgt in Phase 5) |
| 3 | Datenmodell: Schema, Migrationen, Seeds, Indizes, Soft Delete, Audit-Grundlage | ✅ abgeschlossen |
| 4 | Kundenmodul: Übersicht, Formulare, Detailseite, Adressen, Suche/Filter | ✅ abgeschlossen |
| 5 | Mitarbeitermodul: Übersicht, Detail, Hierarchie, Zielstunden, Verfügbarkeit, Abwesenheiten | ✅ abgeschlossen |
| 6 | Stundenbudgets, Korrekturen, Zuweisungen, Berechnungsservice, Warnungen, Tests | ✅ abgeschlossen |
| 7 | Termine & Serien: CRUD, RRULE, Ausnahmen, Zuweisung, Status, Konfliktprüfung | ✅ abgeschlossen |
| 8 | Kalender: Jahr/Monat/Woche/Tag/Liste, Filter, Drag-and-drop, Detail-Drawer | ✅ abgeschlossen |
| 9 | Dashboard: Kennzahlen, Heute, Handlungsbedarf, 7 Tage, Schnellaktionen | ✅ abgeschlossen |
| 10 | Karten & Navigation: Providerabstraktion, Geocoding, Kundenkarte, Deep-Links | ✅ abgeschlossen |
| 11 | Routenplanung: Matrix, Heuristik, Konflikte, Karte, Stoppliste, Speicherung | ✅ abgeschlossen |
| 12 | Benachrichtigungen & globale Suche, Deep Links, Präferenzen | ✅ abgeschlossen |
| 13 | Auswertungen: Kennzahlen, Tabellen, Diagramme, CSV-Export | ✅ abgeschlossen |
| 14 | PWA & Mobile: Manifest, Service Worker, Offline, Bottom-Navigation | ✅ abgeschlossen |
| 15 | Datenschutz & Sicherheit: Export, Löschworkflow, Aufbewahrung, Härtung, Audit-Ansichten | ✅ abgeschlossen |
| 16 | Qualitätssicherung: Tests, A11y, Performance, finaler Build, Doku | ✅ abgeschlossen |

## 5. Anforderungs-Checkliste (Abnahmekriterien)

Wird nach jeder Phase aktualisiert. ✅ erfüllt · 🔶 teilweise · ✅ offen

### Grundlage & Betrieb
- ✅ Anwendung startet lokal (`npm run dev`, Docker-DB, wenige Befehle)
- ✅ Datenbankmigration funktioniert (`prisma migrate dev/deploy`)
- ✅ Seed-Daten ladbar (`npm run db:seed`, Demo-Org lt. Anforderung 27)
- ✅ Linter erfolgreich · ✅ Typecheck erfolgreich · ✅ Produktionsbuild erfolgreich
- ✅ Unit-Tests · ✅ Integrationstests · ✅ E2E-Tests (12-Schritte-Flow)
- ✅ Dokumentation (README, docs/*, .env.example, docker-compose)

### Auth, Rollen, Mandanten
- ✅ Anmeldung/Abmeldung, sichere Sessions (HttpOnly, SameSite, Argon2id, Rate Limit)
- ✅ Passwort-Reset (generische Meldungen), Einladungsflow
- ✅ Rollen OWNER/ADMIN/DISPATCHER/TEAM_MANAGER/EMPLOYEE, serverseitig geprüft
- ✅ Organisationen sauber getrennt (Scope-Checks, IDOR-Tests)
- ✅ Rekursive Mitarbeiterhierarchie inkl. Zyklenschutz, Scope „eigener Bereich"
- ✅ Berechtigungsmatrix in `docs/permissions.md`

### Kunden & Mitarbeiter
- ✅ Kunden-CRUD inkl. Archivieren/Wiederherstellen, kein Hard-Delete bei Historie
- ✅ Kundenliste: Suche, Filter (Status/Ort/Mitarbeiter/offene Stunden), Sortierung, Pagination, Kartenansicht
- ✅ Kundendetail mit Tabs (Übersicht/Termine/Stunden/Mitarbeiter/Route+Karte/Notizen/Aktivität)
- ✅ Klickbare Aktionen (Anruf, E-Mail, Adresse kopieren, Google-Maps-Navigation, Termin/Serie/Stunden/Mitarbeiter)
- ✅ Mitarbeiter-CRUD, Einladung, Deaktivierung, Hierarchieansicht
- ✅ Zielstunden, Verfügbarkeiten, Abwesenheiten, Kennzahlen & Warn-Markierungen

### Stunden (Kernlogik)
- ✅ Alle Zeitmengen als ganzzahlige Minuten
- ✅ Getrennte Kennzahlen: Budget/korrigiert/zugewiesen/geplant/geleistet/offen (Kunde & Mitarbeiter)
- ✅ Berechnungsfunktionen (`getCustomer*`, `getEmployee*`, `getManagerSelfObligationMinutes`) mit Unit-Tests
- ✅ Stundenparser (`2`, `2,5`, `2.5`, `2:30`, `150 Minuten`) mit Tests
- ✅ Zuweisungsdialog mit Budgetanzeige, Hierarchie, Zielstunden, Warnungen, Bestätigung
- ✅ Schutz: kein Überziehen, keine Fremd-Org, keine inaktiven Empfänger, Korrekturbuchung nur bewusst

### Termine, Serien, Kalender
- ✅ Einzel-/Serien-/flexible/feste Termine, Status- & Zuweisungsstatus-Modell
- ✅ RRULE-Serien (täglich/wöchentlich/2-wöchentlich/Wochentage/monatlich Datum+Wochentag/Ende nach Datum/Anzahl/offen)
- ✅ Serien-Bearbeitung „nur dieser / dieser+folgende / ganze Serie", Ausnahmen überschreibungsfest
- ✅ Materialisierungshorizont (120 Tage) mit Erweiterung
- ✅ Kalender Jahr/Monat/Woche/Tag/Liste, letzte Ansicht pro Benutzer gespeichert
- ✅ Monatsansicht mit „+X weitere" & Agenda-Umschalter; Wochen-/Tagesansicht mit Zeitraster/Jetzt-Linie/Konflikten
- ✅ Drag-and-drop + Resize serverseitig gespeichert (mit Konfliktprüfung)
- ✅ Filter (Mitarbeiter/Kunde/Team/Status/Zuweisung/Konflikte/…), Farbcodierung wählbar
- ✅ Zeitraumbezogenes Laden (nie alle Termine)

### Konflikte & Dashboard
- ✅ Konfliktservice: Überschneidung, Abwesenheit, Verfügbarkeit, Fahrtzeit, Tagesmax, Zeitfenster, Adresse fehlt – ERROR/WARNING/INFO
- ✅ Dashboard: Kennzahlkarten (klickbar → gefilterte Ansichten), Heute-Zeitleiste, Handlungsbedarf, 7-Tage-Vorschau, Schnellaktionen

### Karten, Routen
- ✅ Provider-Interfaces (Geocoding/Map/Routing), Mock + Nominatim/OSRM, Produktion konfigurierbar, Schlüssel nur serverseitig
- ✅ Geocoding beim Adresse-Speichern inkl. Mehrdeutigkeits-Auswahl, Cache, kein Re-Geocoding pro Aufruf
- ✅ Kundenkarte (Leaflet) + „In Google Maps öffnen" (mobil App-Deep-Link)
- ✅ Tagesroutenplanung: feste Termine sortieren, Matrix, Erreichbarkeit, Insertion + 2-opt, keine Verletzung fester Zeiten, Warnungen
- ✅ Routenansicht: Karte, Stoppliste, Zeitachse, Zusammenfassung; verschieben/ausschließen/neu berechnen/speichern/freigeben
- ✅ Keine automatische Zuweisung nur wegen Nähe (nur Vorschläge)

### Benachrichtigungen, Suche, Auswertungen
- ✅ In-App-Benachrichtigungen (Ereignisse lt. Anforderung 18), gelesen/ungelesen, Deep-Links, Präferenzen
- ✅ Globale organisationsgebundene Suche (Kunden/Mitarbeiter/Termine/Telefon/Orte/Notizen), gruppiert
- ✅ Auswertungen: Filter, Kennzahlen, SVG-Diagramme, Tabelle, CSV-Export

### PWA, Datenschutz, Sicherheit
- ✅ Manifest, Icons, Service Worker, Offline-Fallback, App-Shell-Cache, heutige Termine/Route offline lesbar
- ✅ Mobile Bottom-Navigation, Bottom-Sheets, Touch-Ziele
- ✅ DSGVO-Basis: Datenminimierung, Exporte (Kunde/Mitarbeiter), Anonymisierung, Aufbewahrungsfristen, `docs/privacy.md`
- ✅ Security-Header, `docs/security.md`, Audit Log + Aktivitätsverlauf auf Detailseiten

## 6. Risiken

| Risiko | Gegenmaßnahme |
|---|---|
| Sehr junge Majors im Ökosystem (TS 7, Prisma 7, FC 7) | bewusst stabile Linien gewählt; Upgrade-Pfade dokumentiert |
| Zeitzonen/DST bei Serienterminen | Expansion in `recurrenceTimezone` mit @date-fns/tz, DST-Unit-Tests |
| Öffentliche OSM-Tiles/Nominatim nicht für Produktionslast | Provider konfigurierbar, Hinweis in docs; Mock als Dev-Standard |
| Native Abhängigkeit `@node-rs/argon2` unter Windows | vorgebaute Binaries; `serverExternalPackages`; Fallback dokumentiert |
| Drag-and-drop + Serverpersistenz + Konflikte | Konfliktprüfung im selben Server-Aufruf, Revert bei Ablehnung |
| In-Memory-Rate-Limit nur pro Prozess | dokumentiert; Redis-Adapter als Erweiterung |

## 7. Offene optionale Erweiterungen (nicht MVP)

- E-Mail-/Push-/SMS-Versand produktiv (Adapter vorhanden), WhatsApp nur nach rechtlicher Prüfung
- Lohn-/Abrechnungsmodul (Architektur lässt Erweiterung zu: TimeEntry → Abrechnungsperioden)
- Redis für Rate-Limit/Matrix-Cache, Hintergrund-Jobs (Cron) für Retention & Serienhorizont
- i18n-Framework (aktuell deutschsprachige UI)
- Nonce-basierte strikte CSP
