-- AlterTable
ALTER TABLE "Appointment" ADD COLUMN     "soloReassignedFromEmployeeId" TEXT;

-- AlterTable
ALTER TABLE "AppointmentSeries" ADD COLUMN     "soloReassignedFromEmployeeId" TEXT;

-- AlterTable
ALTER TABLE "UserPreference" ADD COLUMN     "personalViewActive" BOOLEAN NOT NULL DEFAULT false;
