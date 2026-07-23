-- AlterTable
ALTER TABLE "Appointment" ADD COLUMN     "customerHourBudgetId" TEXT;

-- AlterTable
ALTER TABLE "Customer" ADD COLUMN     "defaultAppointmentDurationMinutes" INTEGER NOT NULL DEFAULT 120;

-- AlterTable
ALTER TABLE "RoutePlan" ADD COLUMN     "bufferMinutes" INTEGER NOT NULL DEFAULT 10,
ADD COLUMN     "originType" TEXT NOT NULL DEFAULT 'office',
ADD COLUMN     "returnToStart" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "totalWaitSeconds" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "CustomerAvailability" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "weekday" INTEGER NOT NULL,
    "startTime" TEXT NOT NULL,
    "endTime" TEXT NOT NULL,

    CONSTRAINT "CustomerAvailability_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CustomerAvailability_customerId_weekday_idx" ON "CustomerAvailability"("customerId", "weekday");

-- CreateIndex
CREATE INDEX "Appointment_customerHourBudgetId_idx" ON "Appointment"("customerHourBudgetId");

-- AddForeignKey
ALTER TABLE "CustomerAvailability" ADD CONSTRAINT "CustomerAvailability_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_customerHourBudgetId_fkey" FOREIGN KEY ("customerHourBudgetId") REFERENCES "CustomerHourBudget"("id") ON DELETE SET NULL ON UPDATE CASCADE;
