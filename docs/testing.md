# Teststrategie

Drei Ebenen, alle deterministisch (keine echten Geo-/Routing-APIs, feste Mock-Provider,
relative Seed-Daten):

## 1. Unit-Tests – `npm test` (Vitest, ohne Datenbank)

Reine Logik in `src/lib/**`:

| Datei | Abdeckung |
|---|---|
| `duration.test.ts` | Stundenparser (`2`, `2,5`, `2.5`, `2:30`, `150 Minuten`, kombiniert), Formatierungen, Roundtrip, Grenzfälle (leer/negativ/zu groß) |
| `hours.test.ts` | Kundenbudget + Korrekturen, Org-Pool vs. Weitergabe (keine Doppelzählung), geplante/geleistete Minuten, Zielstunden/fehlende Stunden, Manager-Eigenverpflichtung, Zuweisungs-Validierung inkl. Bearbeitungsfall und Negativbudget |
| `hierarchy.test.ts` | direkte/transitive Untergebene, Zykluserkennung (Selbstreferenz, direkt, transitiv, defekte Bestandszyklen), Managerkette |
| `recurrence.test.ts` | RRULE-Erzeugung (täglich/wöchentlich/2-wöchentlich/Wochentage/monatlich Datum & Wochentag, Ende nach Datum/Anzahl/offen), Expansion inkl. UNTIL/COUNT, **DST-Sicherheit** (März-Umstellung), deutsche Beschreibung, ungültige Regeln |
| `conflicts.test.ts` | alle Konflikttypen (Überschneidung, Abwesenheit, Verfügbarkeit, Fahrzeit vor/zurück, Tagesmaximum, Kundenzeitfenster, fehlende Adresse, ungültige Dauer) und Schweregrade |
| `route-optimizer.test.ts` | Zeitplansimulation (feste Zeiten, Fenster-Wartezeit, Puffer, Rückkehr), Sortierung fester Termine, Insertionsheuristik, 2-opt, „feste Zeiten werden nie verletzt“, Unlösbarkeit wird gemeldet |
| `geo.test.ts` | Haversine-Plausibilität, deterministische Fahrzeitschätzung, Formatierungen, Maps-Links |

## 2. Integrationstests – `npm run test:integration` (echte PostgreSQL `homecare_test`)

`tests/integration/**` (Migrationen im Global-Setup, Suites räumen selbst auf):

- **Mandantentrennung/IDOR:** fremde Kunden/Mitarbeiter sind unsichtbar; Owner=ALL,
  Team-Manager = rekursiver Unterbaum, Mitarbeiter = nur selbst; Kunden-Scope über
  Zuweisungs-/Termin-/Präferenz-Bezug; `customerScopeWhere`-Listenfilter.
- **Stundenberechnung** gegen echte Daten: Budget+Korrektur, Org-Pool vs. Weitergabe,
  abgesagte und soft-gelöschte Termine zählen nicht, Ist-Zeit vor Plan-Dauer.
- **Serien:** Materialisierung (COUNT-Regel), Idempotenz, Ausnahmen werden nie
  überschrieben, Wandzeit→UTC korrekt.
- **Audit-Log**-Schreibpfad.

## 3. End-to-End – `npm run build && npm run test:e2e` (Playwright, `homecare_e2e`)

Produktionsbuild, eigener Seed, Mock-Provider, entspannte Rate-Limits
(`RATE_LIMIT_RELAXED=1`). Ein serieller Ablauf deckt die 12 geforderten Schritte ab:

1–2 Owner-Login und Kundenanlage inkl. Mock-Geocoding (Karte statt „keine Koordinaten“) ·
3 Mitarbeiteranlage · 4 Budget anlegen und **„2,5“ → 150 Minuten** zuweisen (mit
Bestätigungsschritt) · 5–6 wöchentlichen Serientermin anlegen · 7 Termin erscheint im
Kalender · 8 Zuweisung im Drawer inkl. **Pflicht-Konfliktwarnung** (außerhalb der
Verfügbarkeit) · 9 Mitarbeiterin sieht den Termin · 10 Tagesroute mit Stoppliste,
Kennzahlen und dem geseedeten **Fahrzeitkonflikt** · 11 Dashboard-Kennzahlen inkl. des
neuen Kunden im Handlungsbedarf · 12 fremde Organisation: direkter Objektzugriff → 404,
Liste leer.

## Konventionen

- Unit-Tests liegen neben dem Code (`src/**/*.test.ts`), DB-Tests unter
  `tests/integration`, Browser-Tests unter `tests/e2e`.
- Kein Test ruft externe Netzwerke auf; Zeit-Abhängigkeiten nutzen feste Daten
  (Unit) bzw. relative Seeds (E2E).
- Vor jedem Abschluss: `npm run lint && npm run typecheck && npm test` müssen grün sein;
  Integration/E2E setzen die Docker-Datenbank voraus.
