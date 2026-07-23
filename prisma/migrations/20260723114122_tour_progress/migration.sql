-- CreateEnum
CREATE TYPE "TourStatus" AS ENUM ('IN_PROGRESS', 'COMPLETED', 'SKIPPED');

-- CreateTable
CREATE TABLE "UserTourProgress" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "tourId" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" "TourStatus" NOT NULL DEFAULT 'IN_PROGRESS',
    "currentStepId" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserTourProgress_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "UserTourProgress_organizationId_idx" ON "UserTourProgress"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "UserTourProgress_userId_organizationId_tourId_key" ON "UserTourProgress"("userId", "organizationId", "tourId");

-- AddForeignKey
ALTER TABLE "UserTourProgress" ADD CONSTRAINT "UserTourProgress_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserTourProgress" ADD CONSTRAINT "UserTourProgress_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
