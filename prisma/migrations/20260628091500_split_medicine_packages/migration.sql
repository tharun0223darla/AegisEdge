-- Split package-level fields from MedicineMaster without losing existing data.
-- Sequence is intentionally strict:
-- 1. Create medicine_packages.
-- 2. Backfill from existing medicine_masters package columns.
-- 3. Link existing user medicines to the backfilled package where possible.
-- 4. Drop package columns from medicine_masters.

-- CreateEnum
CREATE TYPE "MedicineReviewType" AS ENUM (
  'UNKNOWN_MANUAL',
  'UNKNOWN_BARCODE',
  'MISSING_IMAGE',
  'LOW_CONFIDENCE_MATCH'
);

-- CreateEnum
CREATE TYPE "MedicineReviewStatus" AS ENUM (
  'OPEN',
  'LINKED',
  'VERIFIED',
  'REJECTED'
);

-- Keep backend enum aligned with frontend medicine form options.
ALTER TYPE "MedicineForm" ADD VALUE IF NOT EXISTS 'OINTMENT';
ALTER TYPE "MedicineForm" ADD VALUE IF NOT EXISTS 'POWDER';

-- AlterTable
ALTER TABLE "medicines"
ADD COLUMN "medicinePackageId" TEXT;

-- CreateTable
CREATE TABLE "medicine_packages" (
  "id" TEXT NOT NULL,
  "medicineId" TEXT NOT NULL,
  "gtin" TEXT,
  "barcodeType" TEXT,
  "packSize" TEXT,
  "stripImageUrl" TEXT,
  "pillImageUrl" TEXT,
  "isDemo" BOOLEAN NOT NULL DEFAULT false,
  "isVerified" BOOLEAN NOT NULL DEFAULT false,
  "verifiedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "medicine_packages_pkey" PRIMARY KEY ("id")
);

-- Backfill package records before old columns are removed.
INSERT INTO "medicine_packages" (
  "id",
  "medicineId",
  "gtin",
  "packSize",
  "stripImageUrl",
  "pillImageUrl",
  "isDemo",
  "isVerified",
  "createdAt",
  "updatedAt"
)
SELECT
  'pkg_' || substr(md5(random()::text || clock_timestamp()::text || "id"), 1, 24),
  "id",
  "gtin",
  "packSize",
  "stripImageUrl",
  "pillImageUrl",
  false,
  false,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "medicine_masters"
WHERE "gtin" IS NOT NULL
   OR "packSize" IS NOT NULL
   OR "stripImageUrl" IS NOT NULL
   OR "pillImageUrl" IS NOT NULL;

-- Link existing patient medicines to the single backfilled package for their master.
UPDATE "medicines" AS m
SET "medicinePackageId" = p."id"
FROM "medicine_packages" AS p
WHERE m."medicineMasterId" = p."medicineId"
  AND m."medicinePackageId" IS NULL;

-- CreateTable
CREATE TABLE "medicine_data_reviews" (
  "id" TEXT NOT NULL,
  "type" "MedicineReviewType" NOT NULL,
  "status" "MedicineReviewStatus" NOT NULL DEFAULT 'OPEN',
  "submittedById" TEXT,
  "reviewedById" TEXT,
  "medicineMasterId" TEXT,
  "medicinePackageId" TEXT,
  "rawName" TEXT,
  "gtin" TEXT,
  "userStripImageUrl" TEXT,
  "payload" JSONB,
  "notes" TEXT,
  "adminNotes" TEXT,
  "reviewedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "medicine_data_reviews_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "medicine_packages_gtin_key" ON "medicine_packages"("gtin");

-- CreateIndex
CREATE INDEX "medicine_packages_medicineId_idx" ON "medicine_packages"("medicineId");

-- CreateIndex
CREATE INDEX "medicine_packages_gtin_idx" ON "medicine_packages"("gtin");

-- CreateIndex
CREATE INDEX "medicine_packages_isDemo_idx" ON "medicine_packages"("isDemo");

-- CreateIndex
CREATE INDEX "medicines_medicinePackageId_idx" ON "medicines"("medicinePackageId");

-- CreateIndex
CREATE INDEX "medicine_data_reviews_status_createdAt_idx" ON "medicine_data_reviews"("status", "createdAt");

-- CreateIndex
CREATE INDEX "medicine_data_reviews_type_status_idx" ON "medicine_data_reviews"("type", "status");

-- CreateIndex
CREATE INDEX "medicine_data_reviews_submittedById_idx" ON "medicine_data_reviews"("submittedById");

-- CreateIndex
CREATE INDEX "medicine_data_reviews_reviewedById_idx" ON "medicine_data_reviews"("reviewedById");

-- CreateIndex
CREATE INDEX "medicine_data_reviews_medicineMasterId_idx" ON "medicine_data_reviews"("medicineMasterId");

-- CreateIndex
CREATE INDEX "medicine_data_reviews_medicinePackageId_idx" ON "medicine_data_reviews"("medicinePackageId");

-- CreateIndex
CREATE INDEX "medicine_data_reviews_gtin_idx" ON "medicine_data_reviews"("gtin");

-- AddForeignKey
ALTER TABLE "medicine_packages" ADD CONSTRAINT "medicine_packages_medicineId_fkey"
FOREIGN KEY ("medicineId") REFERENCES "medicine_masters"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "medicines" ADD CONSTRAINT "medicines_medicinePackageId_fkey"
FOREIGN KEY ("medicinePackageId") REFERENCES "medicine_packages"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "medicine_data_reviews" ADD CONSTRAINT "medicine_data_reviews_submittedById_fkey"
FOREIGN KEY ("submittedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "medicine_data_reviews" ADD CONSTRAINT "medicine_data_reviews_reviewedById_fkey"
FOREIGN KEY ("reviewedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "medicine_data_reviews" ADD CONSTRAINT "medicine_data_reviews_medicineMasterId_fkey"
FOREIGN KEY ("medicineMasterId") REFERENCES "medicine_masters"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "medicine_data_reviews" ADD CONSTRAINT "medicine_data_reviews_medicinePackageId_fkey"
FOREIGN KEY ("medicinePackageId") REFERENCES "medicine_packages"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Package-level fields have been safely copied. Drop them only after backfill.
DROP INDEX IF EXISTS "medicine_masters_gtin_key";

ALTER TABLE "medicine_masters"
DROP COLUMN "gtin",
DROP COLUMN "packSize",
DROP COLUMN "stripImageUrl",
DROP COLUMN "pillImageUrl";
