-- Private, organisationsgebundene Notizbücher mit versioniertem Vektorinhalt.
CREATE TABLE "HandwrittenNote" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "document" JSONB NOT NULL,
    "contentVersion" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HandwrittenNote_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "HandwrittenNote_organizationId_userId_updatedAt_idx"
ON "HandwrittenNote"("organizationId", "userId", "updatedAt");

ALTER TABLE "HandwrittenNote"
ADD CONSTRAINT "HandwrittenNote_organizationId_fkey"
FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "HandwrittenNote"
ADD CONSTRAINT "HandwrittenNote_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
