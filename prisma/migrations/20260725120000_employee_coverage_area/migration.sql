-- Zuständigkeitsgebiet je Mitarbeiter: Umkreis (km) + Zentrum (Adresse/Zuhause).
ALTER TABLE "Employee" ADD COLUMN "coverageRadiusKm" INTEGER;
ALTER TABLE "Employee" ADD COLUMN "coverageCenter" JSONB;
ALTER TABLE "Employee" ADD COLUMN "coverageUseHome" BOOLEAN NOT NULL DEFAULT true;
