# Datenschutz (DSGVO)

Technische und organisatorische Grundlagen des MVP. Ergänzend: [security.md](security.md).

## Datenminimierung & Zugriff nach Erforderlichkeit

- Mitarbeiter sehen **nur die Kundendaten ihrer Einsätze** (Name, Einsatzadresse,
  Telefon, Zugangs-/Reinigungshinweise); die Kundenliste/-verwaltung ist Planungsrollen
  vorbehalten (Scope-Regeln in [permissions.md](permissions.md)).
- **Private interne Notizen** (`privateNotes`) sind gesondert berechtigt
  (nur Owner/Admin) – auch die globale Suche respektiert das.
- Karten-/Routing-Provider erhalten ausschließlich **Koordinaten bzw. die für das
  Routing nötigen Adressbestandteile** – nie Namen, Notizen oder Kontaktdaten.
- Audit-Einträge enthalten Feldnamen/Kurzwerte, **keine Passwörter, Tokens oder
  sensiblen Volltexte**.

## Betroffenenrechte

| Recht | Umsetzung |
|---|---|
| Auskunft/Übertragbarkeit (Art. 15/20) | Einstellungen → Datenschutz: JSON-Export je Kunde/Mitarbeiter (`/api/privacy/export`), auditiert |
| Löschung (Art. 17) | Zweistufig: Kunde **archivieren** (Soft Delete, Historie bleibt konsistent) → **anonymisieren** (unumkehrbar: Name, Kontakt, Adresse inkl. Koordinaten, alle Notizen und Terminbeschreibungen entfernt; Stunden-/Terminhistorie bleibt anonym für Auswertungen) |
| Berichtigung (Art. 16) | reguläre Bearbeitungsfunktionen, auditiert |

Harte Löschung von Kunden mit Termin-/Zeithistorie gibt es bewusst nicht
(`SOFT_DELETE_REQUIRED`) – Anonymisierung erfüllt Art. 17 ohne Konsistenzverlust.

## Aufbewahrungsfristen

Konfigurierbar je Organisation (Einstellungen → Datenschutz, gespeichert in
`Organization.settings.retention`): abgeschlossene Termine/Zeiteinträge, Audit-Log,
Benachrichtigungen (Monate; 0 = unbegrenzt). Angewendet durch
`npm run retention:cleanup` (z. B. täglicher geplanter Task); der Lauf protokolliert
die gelöschten Mengen.

## Rechtsgrundlagen & Einwilligungen

Verarbeitung erfolgt zur Vertragserfüllung (Einsatzplanung) bzw. im berechtigten
Interesse der Organisation; das MVP erhebt bewusst **keine** darüber hinausgehenden
Einwilligungsfelder. Eine konfigurierbare Datenschutzerklärungs-Seite sowie
Einwilligungsfelder (z. B. für Werbe-E-Mails) sind als Erweiterung vorgesehen, sobald
fachlich benötigt – dokumentierte offene Erweiterung, keine Attrappe im UI.

## Weitere Punkte

- Demo-Zugangsdaten existieren nur in Seeds/README für die lokale Entwicklung.
- E-Mail-Versand läuft im Dev als Konsolen-Adapter – es verlassen keine
  personenbezogenen Daten das System; produktive Kanäle (SMTP/Push/SMS) sind Adapter,
  WhatsApp ist bewusst ausgeklammert (separate rechtliche/technische Prüfung nötig).
- Benutzerkonten-Sperrung beendet sofort alle Sessions des Benutzers.
