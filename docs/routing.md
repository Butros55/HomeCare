# Karten, Geocoding & Routenplanung

## Providerabstraktion

Interfaces in `src/server/providers/types.ts` (`GeocodingProvider`, `RoutingProvider`,
`MapProvider`-Konfiguration über Env). Auswahl ausschließlich serverseitig – API-Schlüssel
erreichen nie den Client.

| Zweck | Dev-Standard | Optional (implementiert) | Produktion (vorbereitet) |
|---|---|---|---|
| Geocoding | `mock` (deterministisch) | `nominatim` | Google, Mapbox, ORS |
| Routing/Matrix | `mock` (Haversine-Schätzung) | `osrm` | Google Routes, Mapbox, ORS, GraphHopper |
| Karten-Tiles | OSM (`NEXT_PUBLIC_MAP_TILE_URL`) | beliebiger Tile-Server | kommerzieller Tile-/Style-Provider |

**Mock-Provider (Standard):** Geocoding hasht die normalisierte Adresse auf eine stabile
Koordinate im Raum Münster („mehrdeutig“ im Straßennamen → zwei Kandidaten für den
Auswahl-Dialog, „unbekannt“ → Fehlschlag). Routing schätzt Luftlinie × 1,3 bei 30 km/h
plus 60 s Rüstzeit. Dadurch ist die Anwendung **ohne Schlüssel voll lauffähig und
deterministisch testbar** – Tests rufen niemals echte APIs.

> **OSM/Nominatim-Hinweis:** Die öffentlichen OSM-Tiles und der öffentliche
> Nominatim-Dienst sind nicht für Produktionslast gedacht (Usage Policy: sparsame
> Nutzung, korrekter User-Agent, Caching). Für den Betrieb einen kommerziellen oder
> selbst gehosteten Provider konfigurieren.

## Adress-Autocomplete beim Ausfüllen

Formulare mit Adressfeldern (Kunde, Organisations-Startpunkt) haben eine Suche
„Adresse suchen": Während der Eingabe liefert `suggestAddresses(query)` Vorschläge
(mock: Straßenliste im Demo-Raum Münster, komplett offline; nominatim: `/search` mit
`addressdetails`; Google Places als Produktionsoption über dieselbe Schnittstelle).
Eine Auswahl füllt Straße, Hausnummer, PLZ und Ort und übernimmt die **Koordinate
direkt** – beim Speichern entfällt das erneute Geocoding samt Mehrdeutigkeits-Dialog.
Werden die Felder danach **manuell korrigiert**, wird die übernommene Koordinate
verworfen und der normale Ablauf unten greift wieder. Vorschläge werden 10 Minuten
gecacht (schont Nominatim beim Tippen); der Aufruf ist sessiongebunden (kein offener
Geocoding-Proxy).

## Geocoding-Ablauf beim Adress-Speichern

1. Adresse normalisieren und validieren (Zod).
2. Geocoding über den Provider, Ergebnisse 24 h in-memory gecacht.
3. Genau ein Treffer → Koordinaten + Qualität (`exact`/`approximate`) am `Address`-Datensatz.
4. Mehrere Treffer → `GEOCODING_AMBIGUOUS` mit Kandidaten → Auswahl-Dialog im Formular,
   bestätigte Koordinate wird gespeichert.
5. Kein Treffer → Adresse ohne Koordinaten gespeichert; routenrelevante Termine melden
   das als Konflikt (`ADDRESS_MISSING`), Routen ignorieren den Termin mit Warnung.
6. **Kein Re-Geocoding bei Seitenaufrufen** – nur bei geänderter Adresse.

Navigation: „In Google Maps öffnen“/„Route starten“ als Deep-Link
(`google.com/maps/dir/?api=1…`) – mobil öffnet die Karten-App, Desktop einen Tab.
Übertragen werden **nur Koordinaten bzw. die Zieladresse** (Datenminimierung).

## Tagesrouten-Heuristik (`src/lib/route-optimizer.ts`)

MVP-Verfahren gemäß Anforderung 17, deterministisch und unit-getestet:

1. Feste Termine chronologisch sortieren (Grundgerüst).
2. Fahrzeitmatrix vom Provider (10 min gecacht; Schlüssel: Provider + Koordinaten).
3. Erreichbarkeitsprüfung entlang der Kette – Verspätungen werden als Warnung gemeldet,
   niemals stillschweigend „repariert“.
4. Flexible Termine per günstigster Einfügung (Insertionsheuristik) unter Beachtung von
   `earliestStartAt`/`latestEndAt` (Warten auf Fensteröffnung wird eingeplant).
5. 2-opt-Verbesserung nur innerhalb zusammenhängender flexibler Blöcke – **feste
   Terminzeiten werden durch die Optimierung nie verletzt**.
6. Ergebnis: Reihenfolge, Ankunft/Einsatzbeginn/-ende je Stopp, Fahrzeit/Distanz je
   Abschnitt, Wartezeiten, Puffer, Summen, Rückkehrzeit, Warnungen; „keine zulässige
   Route“ wird explizit gemeldet (`ROUTE_NOT_FEASIBLE` bzw. Warnliste).

Regeln der Routenseite:

- Nicht zugewiesene Termine erscheinen nur als **Vorschläge** und werden erst nach
  ausdrücklicher Auswahl eingeplant – **die Zuweisung ändert sich dadurch nie**.
- Stopps lassen sich manuell verschieben (Neuberechnung des Zeitplans ohne Optimierung),
  ausschließen, neu optimieren; Pläne werden je Mitarbeiter+Tag gespeichert und können
  für Mitarbeiter freigegeben werden (Benachrichtigung).
