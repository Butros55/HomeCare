-- Stundenkonto (Konto-Modell): Gutschriften als Buchungszeilen, Abzüge
-- abgeleitet aus abgeschlossenen Terminen. Alt-Budgets bleiben als Historie
-- stehen und werden hier einmalig in Gutschriften übernommen.

CREATE TYPE "HourTopupKind" AS ENUM ('MANUAL', 'RECURRING', 'CORRECTION');
CREATE TYPE "RecurringIntervalUnit" AS ENUM ('WEEK', 'MONTH');

CREATE TABLE "CustomerRecurringHourGrant" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "minutes" INTEGER NOT NULL,
    "intervalUnit" "RecurringIntervalUnit" NOT NULL,
    "intervalCount" INTEGER NOT NULL DEFAULT 1,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "note" TEXT,
    "materializedUntil" TIMESTAMP(3),
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CustomerRecurringHourGrant_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CustomerHourTopup" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "kind" "HourTopupKind" NOT NULL,
    "minutes" INTEGER NOT NULL,
    "effectiveOn" TIMESTAMP(3) NOT NULL,
    "note" TEXT,
    "sourceType" "BudgetSourceType",
    "recurringGrantId" TEXT,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CustomerHourTopup_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "CustomerRecurringHourGrant_organizationId_active_idx"
ON "CustomerRecurringHourGrant"("organizationId", "active");
CREATE INDEX "CustomerRecurringHourGrant_customerId_active_idx"
ON "CustomerRecurringHourGrant"("customerId", "active");

CREATE UNIQUE INDEX "CustomerHourTopup_recurringGrantId_effectiveOn_key"
ON "CustomerHourTopup"("recurringGrantId", "effectiveOn");
CREATE INDEX "CustomerHourTopup_customerId_effectiveOn_idx"
ON "CustomerHourTopup"("customerId", "effectiveOn");
CREATE INDEX "CustomerHourTopup_organizationId_effectiveOn_idx"
ON "CustomerHourTopup"("organizationId", "effectiveOn");

ALTER TABLE "CustomerRecurringHourGrant"
ADD CONSTRAINT "CustomerRecurringHourGrant_organizationId_fkey"
FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CustomerRecurringHourGrant"
ADD CONSTRAINT "CustomerRecurringHourGrant_customerId_fkey"
FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CustomerRecurringHourGrant"
ADD CONSTRAINT "CustomerRecurringHourGrant_createdByUserId_fkey"
FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "CustomerHourTopup"
ADD CONSTRAINT "CustomerHourTopup_organizationId_fkey"
FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CustomerHourTopup"
ADD CONSTRAINT "CustomerHourTopup_customerId_fkey"
FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CustomerHourTopup"
ADD CONSTRAINT "CustomerHourTopup_recurringGrantId_fkey"
FOREIGN KEY ("recurringGrantId") REFERENCES "CustomerRecurringHourGrant"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "CustomerHourTopup"
ADD CONSTRAINT "CustomerHourTopup_createdByUserId_fkey"
FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Neue Zuweisungen kommen ohne Budget-Bezug aus (Alt-Zeilen behalten ihren).
ALTER TABLE "HourAllocation" ALTER COLUMN "budgetId" DROP NOT NULL;

-- ---------------------------------------------------------------------------
-- Datenübernahme Alt-Budgets → Konto-Gutschriften
-- ---------------------------------------------------------------------------

-- Jedes Budget wird eine einmalige Gutschrift zum Zeitraumsbeginn.
INSERT INTO "CustomerHourTopup"
  ("id", "organizationId", "customerId", "kind", "minutes", "effectiveOn", "note", "sourceType", "createdAt")
SELECT
  gen_random_uuid()::text,
  b."organizationId",
  b."customerId",
  'MANUAL',
  b."budgetMinutes",
  b."periodStart",
  CASE
    WHEN b."note" IS NOT NULL AND b."note" <> ''
      THEN b."note" || ' · übernommen aus Budget ' || to_char(b."periodStart", 'DD.MM.YYYY') || '–' || to_char(b."periodEnd", 'DD.MM.YYYY')
    ELSE 'Übernommen aus Budget ' || to_char(b."periodStart", 'DD.MM.YYYY') || '–' || to_char(b."periodEnd", 'DD.MM.YYYY')
  END,
  b."sourceType",
  b."createdAt"
FROM "CustomerHourBudget" b
WHERE b."budgetMinutes" <> 0;

-- Korrekturbuchungen bleiben Korrekturen (inkl. Begründung und Verursacher).
INSERT INTO "CustomerHourTopup"
  ("id", "organizationId", "customerId", "kind", "minutes", "effectiveOn", "note", "createdByUserId", "createdAt")
SELECT
  gen_random_uuid()::text,
  b."organizationId",
  b."customerId",
  'CORRECTION',
  a."adjustmentMinutes",
  date_trunc('day', a."createdAt"),
  a."reason",
  a."createdByUserId",
  a."createdAt"
FROM "CustomerHourAdjustment" a
JOIN "CustomerHourBudget" b ON b."id" = a."customerHourBudgetId"
WHERE a."adjustmentMinutes" <> 0;
