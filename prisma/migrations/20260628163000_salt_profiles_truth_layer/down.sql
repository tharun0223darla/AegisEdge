-- Manual rollback companion for 20260628163000_salt_profiles_truth_layer.
-- Prisma does not execute down migrations automatically. Run only on a DB copy
-- or during a controlled rollback window.

CREATE TABLE IF NOT EXISTS "medicine_details" (
  "id" TEXT NOT NULL,
  "medicineId" TEXT NOT NULL,
  "uses" TEXT,
  "howToTake" TEXT,
  "whenToTake" TEXT,
  "sideEffects" JSONB,
  "warnings" TEXT,
  "substitutes" JSONB,
  "storage" TEXT,
  "sourceRefs" JSONB,
  "language" TEXT NOT NULL DEFAULT 'en',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "medicine_details_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "medicine_details_medicineId_key"
ON "medicine_details"("medicineId");

INSERT INTO "medicine_details" (
  "id",
  "medicineId",
  "uses",
  "howToTake",
  "whenToTake",
  "sideEffects",
  "warnings",
  "substitutes",
  "storage",
  "sourceRefs",
  "language",
  "createdAt",
  "updatedAt"
)
SELECT
  'detail_' || substr(md5(m."id" || sp."id"), 1, 24),
  m."id",
  sp."uses",
  sp."howToTake",
  sp."whenToTake",
  sp."sideEffects",
  sp."warnings",
  sp."substitutes",
  sp."storage",
  sp."sourceRefs",
  sp."language",
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "medicine_masters" m
JOIN "salt_profiles" sp ON sp."id" = m."saltProfileId"
ON CONFLICT ("medicineId") DO NOTHING;

ALTER TABLE "medicine_details" ADD CONSTRAINT "medicine_details_medicineId_fkey"
FOREIGN KEY ("medicineId") REFERENCES "medicine_masters"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "medicine_masters" DROP CONSTRAINT IF EXISTS "medicine_masters_saltProfileId_fkey";

DROP INDEX IF EXISTS "medicine_masters_saltProfileId_idx";
DROP INDEX IF EXISTS "medicine_masters_dedupeKey_key";

ALTER TABLE "medicine_masters"
DROP COLUMN IF EXISTS "saltProfileId",
DROP COLUMN IF EXISTS "brandOverride",
DROP COLUMN IF EXISTS "source",
DROP COLUMN IF EXISTS "isVerified",
DROP COLUMN IF EXISTS "version",
DROP COLUMN IF EXISTS "dedupeKey";

ALTER TABLE "medicine_packages"
DROP COLUMN IF EXISTS "source";

DROP TABLE IF EXISTS "salt_profiles";

DROP TYPE IF EXISTS "EnrichmentStatus";
DROP TYPE IF EXISTS "RecordSource";
