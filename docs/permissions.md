# Rollen & Berechtigungen

Implementierung: `src/server/permissions/index.ts`. Jede geschützte Operation prüft
serverseitig: Session → Mitgliedschaft → Berechtigung → Datensatz-Scope
(`assertSameOrg`, `canAccessEmployee`, `canAccessCustomer`). Das Ausblenden von
Navigation/Buttons ist reine UX und ersetzt keine Prüfung.

## Rollen

| Rolle | Kurzbeschreibung |
|---|---|
| ORGANIZATION_OWNER | Vollzugriff auf die eigene Organisation |
| ADMIN | wie Owner, außer Eigentums-Übertragung/Organisation löschen |
| DISPATCHER | operative Planung: Kunden, Termine, Routen, Stunden aus dem Org-Budget |
| TEAM_MANAGER | eigener Unterbaum: Mitarbeiter verwalten, Termine planen, Stunden aus dem eigenen Pool weitergeben |
| EMPLOYEE | eigene Termine/Route, Terminstatus, optionale Zeiterfassung |

## Matrix (Fähigkeit × Rolle)

| Fähigkeit | OWNER | ADMIN | DISPATCHER | TEAM_MANAGER | EMPLOYEE |
|---|:-:|:-:|:-:|:-:|:-:|
| customers.read | ✅ | ✅ | ✅ | 🔶 Scope¹ | 🔶 Scope¹ |
| customers.manage | ✅ | ✅ | ✅ | – | – |
| customers.privateNotes | ✅ | ✅ | – | – | – |
| employees.read | ✅ | ✅ | ✅ | 🔶 Unterbaum | nur selbst |
| employees.manage | ✅ | ✅ | – | 🔶 Unterbaum | – |
| employees.invite | ✅ | ✅ | – | 🔶 mit `canRecruitEmployees` | – |
| hours.allocateOrg (Org-Budget) | ✅ | ✅ | ✅ | – | – |
| hours.allocateOwnPool (Weitergabe) | ✅ | ✅ | – | ✅ | – |
| budgets.manage (+ Korrekturen) | ✅ | ✅ | ✅ | – | – |
| appointments.viewAll | ✅ | ✅ | ✅ | 🔶 Unterbaum + Offene | nur eigene |
| appointments.manage | ✅ | ✅ | ✅ | 🔶 Unterbaum | Status eigener² |
| timeEntries.approve | ✅ | ✅ | ✅ | ✅ | – |
| routes.manage | ✅ | ✅ | ✅ | 🔶 Unterbaum | eigene ansehen |
| reports.view | ✅ | ✅ | ✅ | 🔶 Scope | – |
| settings.manage (Organisation) | ✅ | ✅ | – | – | – |
| members.manage (Rollen/Sperren) | ✅ | ✅³ | – | – | – |
| organization.transferOwnership | ✅ | – | – | – | – |
| audit.view | ✅ | ✅ | – | – | – |
| privacy.export / Anonymisierung | ✅ | ✅ | – | – | – |

¹ Kunden-Scope für TEAM_MANAGER/EMPLOYEE: nur Kunden mit Bezug zum eigenen Bereich
(aktive Zuweisung, zugewiesener Termin oder bevorzugte Zuordnung) – Datenminimierung.
² EMPLOYEE darf am eigenen Termin IN_PROGRESS/COMPLETED/NO_SHOW setzen sowie
Zuweisungen annehmen/ablehnen.
³ ADMIN kann die Eigentümerrolle weder vergeben noch entziehen oder sperren.

## Hierarchie-Scope

`getManagedEmployeeIds(ctx)` liefert `'ALL'` (OWNER/ADMIN/DISPATCHER), den rekursiven
Unterbaum inkl. selbst (TEAM_MANAGER) oder nur das eigene Profil (EMPLOYEE). Der
Unterbaum wird aus der Org-Hierarchie berechnet (`collectSubtree`), Zyklen verhindert
`wouldCreateCycle` (Selbstreferenz, direkter und transitiver Kreis) – unit- und
integrationsgetestet.

Regeln bei Zuweisungen/Umhängungen:

- kein Vorgesetzter aus fremder Organisation (`assertSameOrg`),
- niemand kann sich selbst als Vorgesetzten setzen,
- Team-Manager legen neue Mitarbeiter nur unterhalb des eigenen Bereichs an,
- Stunden-Weitergabe nur an aktive Empfänger (`canReceiveHours`) im eigenen Unterbaum.

## Mandantentrennung

Alle Listen filtern auf `organizationId` der aktiven Mitgliedschaft (Cookie wird
serverseitig gegen die Mitgliedschaft validiert); Einzelzugriffe prüfen die
Organisation des Datensatzes → fremde IDs enden als 404 (kein Existenz-Leak).
Nachgewiesen durch Integrationstests (`tests/integration/scope.test.ts`) und den
E2E-Schritt 12.
