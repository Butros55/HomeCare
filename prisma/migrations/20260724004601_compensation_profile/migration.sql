-- CreateEnum
CREATE TYPE "TaxEmploymentType" AS ENUM ('MINIJOB', 'EMPLOYED', 'SELF_EMPLOYED');

-- AlterTable
ALTER TABLE "OrganizationMembership" ADD COLUMN     "applySolidarity" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "churchTaxRatePercent" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN     "hasChildren" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "healthInsuranceExtraRatePercent" DOUBLE PRECISION NOT NULL DEFAULT 2.5,
ADD COLUMN     "incomeTaxRatePercent" DOUBLE PRECISION,
ADD COLUMN     "taxEmploymentType" "TaxEmploymentType",
ADD COLUMN     "taxFreeBonusCentsPerHour" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "taxFreeBonusLabel" TEXT NOT NULL DEFAULT 'Werbepauschale';
