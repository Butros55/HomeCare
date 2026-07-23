# Architektur

## Schichten

```
src/app         Routen (App Router) – nur Komposition, kein Fachcode
src/features    Feature-UI (Client-/Server-Komponenten je Modul)
src/components  UI-Basis (Design-System, Layout-Shell)
src/server      auth/ permissions/ services/ providers/ actions/ validation/
src/lib         Reine, unit-getestete Logik (Minuten, Daten, RRULE, Konflikte, Routenheuristik)
prisma          Schema, Migrationen, Seed
```

Grundsätze:

- **Businesslogik nie in React-Komponenten.** Server Actions validieren (Zod) und rufen
  Services; Services kapseln Prisma-Zugriffe, Berechtigungen und Audit.
- **Jede Mutation:** authentifizieren → Organisationsmitgliedschaft → Berechtigung →
  Zugehörigkeit aller referenzierten Datensätze (`assertSameOrg`) → Eingaben validieren →
  Audit-Eintrag (in derselben Transaktion).
- **ActionResult statt Exceptions über die Leitung:** `{ ok } | { ok:false, code, message,
  details }` mit stabilen Fehlercodes (`AUTH_REQUIRED`, `ACCESS_DENIED`,
  `ORGANIZATION_SCOPE_VIOLATION`, `HOUR_BUDGET_EXCEEDED`, `APPOINTMENT_CONFLICT`,
  `ROUTE_NOT_FEASIBLE`, `GEOCODING_AMBIGUOUS`, …) – Meldungstexte zentral in
  `src/lib/error-codes.ts`.

## Authentifizierung

Eigene DB-Sessions nach dem Lucia-Muster (bewusst statt Auth.js: Credentials-Login in
Auth.js v5 erzwingt JWT ohne serverseitigen Widerruf):

- Zufallstoken nur im HttpOnly-Cookie (`SameSite=Lax`, `Secure` in Produktion); die DB
  speichert ausschließlich den SHA-256-Hash. Gleitende Verlängerung, Widerruf bei
  Passwortwechsel/Sperrung.
- Passwörter: Argon2id (`@node-rs/argon2`, OWASP-Parameter).
- Auth-Formulare sind **Progressive-Enhancement-Formulare** (`useActionState` + Server
  Action): funktionieren vor/ohne JS als POST – Zugangsdaten können nie per GET in
  URLs/Logs landen; Fehler erscheinen inline.

## Stundenmodell (Kernlogik)

Alle Zeitmengen sind **ganzzahlige Minuten**. Vier strikt getrennte Begriffe:

| Begriff | Quelle |
|---|---|
| Budget (gebucht + Korrekturen) | `CustomerHourBudget` + `CustomerHourAdjustment` |
| Zuweisung (an Mitarbeiter übertragen) | `HourAllocation` |
| Planung (Termin-Minuten) | `Appointment` (PLANNED/CONFIRMED/IN_PROGRESS/COMPLETED) |
| Ist-Zeit (geleistet) | COMPLETED-Termine; freigegebene `TimeEntry` vor Plan-Dauer |

**Pool-Modell:** `allocatedByEmployeeId = null` → Zuweisung aus dem Org-Budget
(verbraucht Kundenbudget). `allocatedByEmployeeId = M` → Weitergabe aus dem erhaltenen
Pool von M (verbraucht *nicht* erneut das Kundenbudget). Eigenverpflichtung eines
Managers = erhalten − weitergegeben. Alle Berechnungen sind reine Funktionen in
`src/lib/hours.ts` (vollständig unit-getestet); die Services in
`src/server/services/hours-service.ts` laden nur Daten und delegieren.

Überziehungen sind gesperrt (`HOUR_BUDGET_EXCEEDED` / `ALLOCATION_POOL_EXCEEDED`);
Administratoren erweitern Budgets ausschließlich über bewusste **Korrekturbuchungen**
mit Pflicht-Begründung (auditiert).

## Termine & Serien

- Serien speichern eine **RFC-5545-RRULE** (`rrule`-Bibliothek) + `recurrenceTimezone`.
- Vorkommen werden bis zu einem Horizont (120 Tage) als `Appointment`-Zeilen
  **materialisiert** (`materializedUntil`); Kalenderabfragen jenseits des Horizonts
  stoßen die Erweiterung an – niemals unbegrenzte Vorab-Erzeugung.
- Wandzeit → UTC über `@date-fns/tz`: „9:00“ bleibt über DST-Wechsel 9:00 (getestet).
- Einzeländerungen erzeugen `AppointmentSeriesException` (MODIFIED/CANCELLED) mit
  Verweis auf den Termin – **Regenerierungen überschreiben Ausnahmen nie**.
- Bearbeiten/Absagen mit Umfangswahl: nur dieser / dieser und folgende (Serien-Split via
  `endDate`) / gesamte Serie.

## Konfliktservice

`src/lib/conflicts.ts` (rein, getestet): Überschneidung, Abwesenheit, Verfügbarkeit,
unzureichende Fahrzeit (deterministische Schätzung), Tageshöchstarbeitszeit,
Kundenzeitfenster, fehlende Geokodierung. Drei Schweregrade: **ERROR** blockiert,
**WARNING** erfordert ausdrückliche Bestätigung (Dialog „Trotzdem speichern“), **INFO**
informiert. Geprüft bei Anlegen, Bearbeiten, Zuweisen und Drag-and-drop; Anzeige im
Kalender (⚠), Dashboard und auf Mitarbeiterseiten.

## Kalender-Datenfluss

`GET /api/calendar/events?start&end&filter…` liefert ausschließlich den sichtbaren
Zeitraum (max. ~13 Monate, Kappung), rollen-gescoped, mit Konfliktmarkierung.
Drag-and-drop/Resize ruft `rescheduleAppointmentAction` (Konfliktprüfung serverseitig,
Revert bei Ablehnung). Die zuletzt genutzte Ansicht/Farbcodierung liegt in
`UserPreference`.

## PWA & Offline

Web-Manifest (`src/app/manifest.ts`), handgeschriebener Service Worker (`public/sw.js`,
nur Produktion registriert): Navigationen Netz-zuerst mit `/offline`-Fallback, statische
Assets Cache-zuerst, `/api/my/today` Netz-zuerst mit Cache-Fallback → heutige Termine
und freigegebene Route bleiben offline lesbar. **Offline-Mutationen sind bewusst nicht
implementiert** (deaktiviert statt scheinbar funktionierend – kein Datenverlust).

## Erweiterungspunkte

- `MailProvider` (Konsole → SMTP/API), Benachrichtigungskanäle (E-Mail/Push/SMS-Adapter
  an `createNotification`), `GeocodingProvider`/`RoutingProvider` (mock/nominatim/osrm →
  Google/Mapbox/ORS/GraphHopper), Redis für Rate-Limit/Matrix-Cache, Abrechnung auf
  Basis `TimeEntry`.
