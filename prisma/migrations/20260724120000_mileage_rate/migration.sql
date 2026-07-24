-- Kilometergeld je gefahrenem Kilometer in Euro-Cent (steuerfrei, nur eigene Fahrten).
ALTER TABLE "OrganizationMembership" ADD COLUMN "mileageRatePerKmCents" INTEGER NOT NULL DEFAULT 0;
