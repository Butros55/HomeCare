-- Persönliche Verdienst-Einstellungen je Organisationsmitglied.
-- Geldbeträge werden als ganzzahlige Euro-Cent gespeichert.
ALTER TABLE "OrganizationMembership"
ADD COLUMN "hourlyWageCents" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "employeeCommissionCentsPerHour" INTEGER NOT NULL DEFAULT 0;
