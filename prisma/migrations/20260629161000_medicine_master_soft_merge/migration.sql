ALTER TABLE "medicine_masters"
ADD COLUMN "isArchived" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "mergedIntoId" TEXT,
ADD COLUMN "mergedAt" TIMESTAMP(3),
ADD COLUMN "mergeReason" TEXT;

CREATE INDEX "medicine_masters_isArchived_idx"
ON "medicine_masters"("isArchived");

CREATE INDEX "medicine_masters_mergedIntoId_idx"
ON "medicine_masters"("mergedIntoId");

ALTER TABLE "medicine_masters" ADD CONSTRAINT "medicine_masters_mergedIntoId_fkey"
FOREIGN KEY ("mergedIntoId") REFERENCES "medicine_masters"("id") ON DELETE SET NULL ON UPDATE CASCADE;
