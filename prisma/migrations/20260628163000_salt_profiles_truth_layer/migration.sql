-- Move clinical truth from brand-level MedicineDetail to salt-level SaltProfile.
-- Strict order:
-- 1. Create salt_profiles and new enums.
-- 2. Add brand linkage fields.
-- 3. Backfill SaltProfile from current medicine_masters + medicine_details.
-- 4. Link every MedicineMaster to a SaltProfile and assign dedupe keys.
-- 5. Only then drop medicine_details.

-- CreateEnum safely for rerunnable local development.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'RecordSource') THEN
    CREATE TYPE "RecordSource" AS ENUM ('IMPORT', 'ADMIN', 'ENRICHMENT', 'USER');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'EnrichmentStatus') THEN
    CREATE TYPE "EnrichmentStatus" AS ENUM ('NEEDS_SOURCE', 'PARTIAL', 'COMPLETE');
  END IF;
END $$;

-- CreateTable
CREATE TABLE "salt_profiles" (
  "id" TEXT NOT NULL,
  "saltKey" TEXT NOT NULL,
  "displayName" TEXT NOT NULL,
  "ingredients" JSONB NOT NULL,
  "uses" TEXT,
  "howToTake" TEXT,
  "whenToTake" TEXT,
  "sideEffects" JSONB,
  "warnings" TEXT,
  "substitutes" JSONB,
  "storage" TEXT,
  "sourceRefs" JSONB,
  "enrichmentStatus" "EnrichmentStatus" NOT NULL DEFAULT 'NEEDS_SOURCE',
  "source" "RecordSource" NOT NULL DEFAULT 'IMPORT',
  "isVerified" BOOLEAN NOT NULL DEFAULT false,
  "version" INTEGER NOT NULL DEFAULT 1,
  "language" TEXT NOT NULL DEFAULT 'en',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "salt_profiles_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "medicine_masters"
ADD COLUMN "saltProfileId" TEXT,
ADD COLUMN "brandOverride" JSONB,
ADD COLUMN "source" "RecordSource" NOT NULL DEFAULT 'IMPORT',
ADD COLUMN "isVerified" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN "dedupeKey" TEXT;

ALTER TABLE "medicine_packages"
ADD COLUMN "source" "RecordSource" NOT NULL DEFAULT 'IMPORT';

-- CreateIndex
CREATE UNIQUE INDEX "salt_profiles_saltKey_key" ON "salt_profiles"("saltKey");
CREATE INDEX "salt_profiles_saltKey_idx" ON "salt_profiles"("saltKey");
CREATE UNIQUE INDEX "medicine_masters_dedupeKey_key" ON "medicine_masters"("dedupeKey");
CREATE INDEX "medicine_masters_saltProfileId_idx" ON "medicine_masters"("saltProfileId");

-- Backfill stable salt profiles. This is intentionally simple and deterministic:
-- composition > genericName > brandName+strength. Import pipeline can later rebuild
-- richer ingredient JSON while preserving admin-verified records.
WITH salt_source AS (
  SELECT
    m."id" AS "masterId",
    COALESCE(NULLIF(m."composition", ''), NULLIF(m."genericName", ''), concat_ws(' ', m."brandName", m."strength")) AS "displayName",
    lower(
      trim(
        both '-' from regexp_replace(
          COALESCE(NULLIF(m."composition", ''), NULLIF(m."genericName", ''), concat_ws(' ', m."brandName", m."strength")),
          '[^a-zA-Z0-9]+',
          '-',
          'g'
        )
      )
    ) AS "saltKey",
    CASE
      WHEN m."salts" IS NOT NULL THEN m."salts"
      ELSE jsonb_build_array(
        jsonb_build_object(
          'ingredient',
          COALESCE(NULLIF(m."composition", ''), NULLIF(m."genericName", ''), m."brandName"),
          'strength',
          m."strength"
        )
      )
    END AS "ingredients",
    d."uses",
    d."howToTake",
    d."whenToTake",
    d."sideEffects",
    d."warnings",
    d."substitutes",
    d."storage",
    d."sourceRefs",
    d."language"
  FROM "medicine_masters" m
  LEFT JOIN "medicine_details" d ON d."medicineId" = m."id"
),
salt_ranked AS (
  SELECT
    *,
    row_number() OVER (
      PARTITION BY "saltKey"
      ORDER BY
        CASE WHEN "sourceRefs" IS NULL THEN 1 ELSE 0 END,
        "masterId"
    ) AS rank
  FROM salt_source
  WHERE "saltKey" IS NOT NULL AND "saltKey" <> ''
)
INSERT INTO "salt_profiles" (
  "id",
  "saltKey",
  "displayName",
  "ingredients",
  "uses",
  "howToTake",
  "whenToTake",
  "sideEffects",
  "warnings",
  "substitutes",
  "storage",
  "sourceRefs",
  "enrichmentStatus",
  "source",
  "isVerified",
  "version",
  "language",
  "createdAt",
  "updatedAt"
)
SELECT
  'salt_' || substr(md5("saltKey"), 1, 24),
  "saltKey",
  "displayName",
  "ingredients",
  "uses",
  "howToTake",
  "whenToTake",
  "sideEffects",
  "warnings",
  "substitutes",
  "storage",
  "sourceRefs",
  CASE
    WHEN "sourceRefs" IS NOT NULL THEN 'COMPLETE'::"EnrichmentStatus"
    ELSE 'NEEDS_SOURCE'::"EnrichmentStatus"
  END,
  'IMPORT'::"RecordSource",
  false,
  1,
  COALESCE("language", 'en'),
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM salt_ranked
WHERE rank = 1
ON CONFLICT ("saltKey") DO NOTHING;

-- Link masters to their salt profiles.
WITH master_salts AS (
  SELECT
    m."id",
    lower(
      trim(
        both '-' from regexp_replace(
          COALESCE(NULLIF(m."composition", ''), NULLIF(m."genericName", ''), concat_ws(' ', m."brandName", m."strength")),
          '[^a-zA-Z0-9]+',
          '-',
          'g'
        )
      )
    ) AS "saltKey"
  FROM "medicine_masters" m
)
UPDATE "medicine_masters" AS m
SET "saltProfileId" = s."id"
FROM master_salts ms
JOIN "salt_profiles" s ON s."saltKey" = ms."saltKey"
WHERE m."id" = ms."id";

-- Assign unique dedupe keys for import/admin upserts.
WITH keyed AS (
  SELECT
    "id",
    COALESCE(
      NULLIF(
        lower(
          trim(
            both '-' from regexp_replace(
              concat_ws('|', "brandName", "strength", "manufacturer"),
              '[^a-zA-Z0-9]+',
              '-',
              'g'
            )
          )
        ),
        ''
      ),
      'master-' || "id"
    ) AS base_key
  FROM "medicine_masters"
),
ranked AS (
  SELECT
    "id",
    base_key,
    row_number() OVER (PARTITION BY base_key ORDER BY "id") AS rank
  FROM keyed
)
UPDATE "medicine_masters" AS m
SET "dedupeKey" = CASE
  WHEN ranked.rank = 1 THEN ranked.base_key
  ELSE ranked.base_key || '-' || ranked.rank::text
END
FROM ranked
WHERE m."id" = ranked."id";

ALTER TABLE "medicine_masters" ALTER COLUMN "dedupeKey" SET NOT NULL;

-- AddForeignKey
ALTER TABLE "medicine_masters" ADD CONSTRAINT "medicine_masters_saltProfileId_fkey"
FOREIGN KEY ("saltProfileId") REFERENCES "salt_profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Clinical fields are now salt-owned and backfilled.
DROP TABLE "medicine_details";
