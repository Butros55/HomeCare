# Datenmodell

Vollständiges Schema: [prisma/schema.prisma](../prisma/schema.prisma). Alle
Geschäftsdaten tragen `organizationId` (Mandantentrennung); Zeitmengen sind ganzzahlige
Minuten; Zeitstempel UTC; „Datums“-Felder (Budgets, Serientage, Routendatum) sind
UTC-Mitternacht. Soft Delete über `deletedAt` (Kunden, Mitarbeiter, Termine).

## ERD (Kernentitäten)

```mermaid
erDiagram
    Organization ||--o{ OrganizationMembership : hat
    Organization ||--o{ Employee : beschaeftigt
    Organization ||--o{ Customer : betreut
    Organization ||--o{ AuditLog : protokolliert
    User ||--o{ OrganizationMembership : gehoert
    User ||--o{ Session : besitzt
    User ||--o| UserPreference : speichert
    Employee ||--o{ Employee : fuehrt
    Employee ||--o{ EmployeeAvailability : verfuegbar
    Employee ||--o{ EmployeeAbsence : abwesend
    Employee ||--o{ HourAllocation : erhaelt
    Employee ||--o{ Appointment : uebernimmt
    Employee ||--o{ RoutePlan : faehrt
    Customer ||--o{ Address : wohnt
    Customer ||--o{ CustomerHourBudget : bucht
    Customer ||--o{ Appointment : empfaengt
    Customer ||--o{ AppointmentSeries : vereinbart
    CustomerHourBudget ||--o{ CustomerHourAdjustment : korrigiert
    CustomerHourBudget ||--o{ HourAllocation : verteilt
    AppointmentSeries ||--o{ Appointment : materialisiert
    AppointmentSeries ||--o{ AppointmentSeriesException : ausnahme
    Appointment ||--o{ TimeEntry : erfasst
    Appointment ||--o{ RouteStop : angefahren
    RoutePlan ||--o{ RouteStop : enthaelt
    User ||--o{ Notification : empfaengt

    Organization {
        string id PK
        string name
        string slug UK
        string timezone
        json defaultStartLocation
        json settings
    }
    Employee {
        string id PK
        string organizationId FK
        string userId FK "optional"
        string managerEmployeeId FK "selbstreferenzierend"
        int targetMinutesPerWeek
        int targetMinutesPerMonth
        int maximumMinutesPerDay
        boolean canReceiveHours
        datetime deletedAt "Soft Delete"
    }
    Customer {
        string id PK
        string organizationId FK
        string customerNumber UK "je Organisation"
        string preferredEmployeeId FK
        string privateNotes "gesondert berechtigt"
        datetime deletedAt "Soft Delete"
    }
    CustomerHourBudget {
        string id PK
        datetime periodStart
        datetime periodEnd
        int budgetMinutes
    }
    HourAllocation {
        string id PK
        string budgetId FK
        string allocatedByEmployeeId FK "null = Org-Pool"
        string allocatedToEmployeeId FK
        int allocatedMinutes
        enum status "ACTIVE|REVOKED"
    }
    AppointmentSeries {
        string id PK
        string recurrenceRule "RFC-5545"
        string recurrenceTimezone
        datetime materializedUntil "Horizont 120 Tage"
    }
    Appointment {
        string id PK
        string seriesId FK "optional"
        datetime occurrenceDate "fuer Ausnahmen"
        datetime startAt
        datetime endAt
        int durationMinutes
        enum status
        enum assignmentStatus
        boolean isFlexible
        datetime deletedAt "Soft Delete"
    }
```

Zusätzlich: `Session`, `PasswordResetToken`, `Invitation` (Auth/Einladungen) sowie
`Notification` und `AuditLog`.

## Wichtige Entscheidungen

- **Hierarchie** über selbstreferenzierendes `managerEmployeeId`; Zyklen verhindert die
  reine Funktion `wouldCreateCycle` (`src/lib/hierarchy.ts`, getestet); Unterbäume werden
  in JS über die (kleine) Org-Mitarbeitermenge berechnet.
- **Pool-Modell der Zuweisungen:** `allocatedByEmployeeId = null` verbraucht das
  Kundenbudget; gesetzt = Weitergabe aus dem Pool des Managers (keine Doppelzählung).
- **Serien-Ausnahmen** als eigene Tabelle mit Unique(`seriesId`, `occurrenceDate`) –
  Materialisierung überspringt Ausnahmedaten, Einzeländerungen bleiben erhalten.
- **Start-/Zielorte** (Organisation, Mitarbeiter, Routen) als strukturierte JSON-Standorte
  (Label, Adresse, Koordinaten) – `Address`-Zeilen sind Kundenadressen mit
  Geocoding-Metadaten.
- **RoutePlan** eindeutig je (`employeeId`, `routeDate`); Neuberechnung ersetzt den Plan.
- **Indizes** auf allen Filterpfaden: `organizationId`-Kombinationen, `startAt`/`endAt`,
  `assignedEmployeeId+startAt`, `customerId+startAt`, Budget-Perioden, `routeDate`,
  Status- und `deletedAt`-Kombinationen (siehe Schema).
- **Transaktionen** überall dort, wo Stunden, Termine oder Zuweisungen gemeinsam mit
  Audit-Einträgen geändert werden (`db.$transaction`).
