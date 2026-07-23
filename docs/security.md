# Sicherheit

## Authentifizierung & Sessions

- **Argon2id** (`@node-rs/argon2`; m=19 MiB, t=2, p=1 – OWASP-Empfehlung).
- **DB-Sessions** (Lucia-Muster): Zufallstoken (192 bit) nur im Cookie, DB speichert den
  SHA-256-Hash; gleitende Verlängerung; Widerruf bei Logout, Passwortwechsel
  (alle Sessions), Kontosperrung.
- Cookie: `HttpOnly`, `SameSite=Lax`, `Secure` in Produktion, `Path=/`.
- **Login/Registrierung/Reset/Einladung als Progressive-Enhancement-Formulare**
  (`useActionState`): Auch vor/ohne JS wird per POST an die Server Action gesendet –
  Zugangsdaten können nie als GET-Parameter in URLs, Logs oder der History landen.
  Die Login-Seite bereinigt zusätzlich aktiv jede URL mit `email`/`password`-Parametern.
- Generische Fehlermeldungen (kein Konto-Enumerationsleck), konstante
  Hash-Verifikation auch bei unbekannter E-Mail-Adresse.
- Passwort-Reset: einmaliger, gehashter Token (60 min), Invalidierung aller Sessions.
- Einladungen: gehashte Token, 7 Tage gültig, Rollenvergabe > EMPLOYEE nur durch
  Owner/Admin.

## Rate Limiting

Token-Bucket in-memory (pro Prozess) für Login (5/15 min je IP **und** je Konto),
Registrierung (3/h je IP), Reset (3/15 min). `RATE_LIMIT_RELAXED=1` hebt die Limits
ausschließlich für automatisierte Tests an. Für horizontale Skalierung ist ein
Redis-Backend als Adapter vorgesehen (dokumentierte Einschränkung).

## Autorisierung

Jede Mutation prüft serverseitig: Session → aktive Organisationsmitgliedschaft (der
Org-Cookie wird gegen die Mitgliedschaft validiert – **kein Vertrauen in
Client-`organizationId`s**) → Rollen-Berechtigung → Zugehörigkeit *aller* referenzierten
Datensätze (`assertSameOrg`; fremde IDs → 404, kein Existenz-Leak) → Zod-Validierung →
Audit-Eintrag. IDOR-Schutz ist integrations- (`tests/integration/scope.test.ts`) und
E2E-getestet (Schritt 12).

## CSRF

Server Actions akzeptieren nur POST und werden von Next.js mit Origin/Host-Prüfung
abgesichert; ergänzend `SameSite=Lax`-Cookies. Eigene Route-Handler sind ausschließlich
lesend (GET) und sessiongebunden. Es existieren keine zustandsändernden GET-Endpunkte
(Export-GETs erzeugen nur Downloads und werden auditiert).

## Security-Header (next.config.ts)

`Content-Security-Policy` (default-src 'self'; img-src erweitert um den konfigurierten
Tile-Host; object-src 'none'; frame-ancestors 'none'; form-action 'self'),
`X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy:
strict-origin-when-cross-origin`, `Permissions-Policy` (Kamera/Mikro/Payment/USB aus),
`Strict-Transport-Security` in Produktion.

**Bewusster Kompromiss:** `script-src 'self' 'unsafe-inline'` (Dev zusätzlich
`'unsafe-eval'`) wegen der Inline-Bootstrap-Skripte von Next/FullCalendar ohne
Nonce-Middleware. Härtungsoption: Nonce-basierte CSP über Middleware (erzwingt
volldynamisches Rendering) – als Erweiterung dokumentiert.

## Schlüssel & Geheimnisse

API-Schlüssel (Google/Mapbox/ORS/GraphHopper) und `AUTH_SECRET` existieren nur
serverseitig (`.env`, nicht `NEXT_PUBLIC_*`); `.env` ist nicht versioniert. Der Client
erhält ausschließlich die öffentliche Tile-URL und den Anzeigenamen.

## Sonstiges

- Audit-Log ohne Passwörter/Tokens/sensible Volltexte; Einträge entstehen in derselben
  Transaktion wie die Änderung.
- `dangerouslySetInnerHTML` wird nicht verwendet; Leaflet-Popups erhalten nur
  React-gerenderte Inhalte, der Karten-DivIcon nur kontrollierte Werte (Hex-Farbe,
  Zahl).
- Fehlerantworten enthalten stabile Codes statt Stacktraces; unerwartete Fehler werden
  serverseitig geloggt und generisch beantwortet.
