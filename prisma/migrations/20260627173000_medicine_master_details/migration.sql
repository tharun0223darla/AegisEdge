-- CreateEnum
CREATE TYPE "MedSource" AS ENUM ('MANUAL', 'BILL', 'BARCODE', 'PRESCRIPTION', 'IMPORT');

-- AlterTable
ALTER TABLE "medicines"
ADD COLUMN "medicineMasterId" TEXT,
ADD COLUMN "source" "MedSource" NOT NULL DEFAULT 'MANUAL',
ADD COLUMN "userStripImageUrl" TEXT,
ADD COLUMN "visualConfirmed" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "medicine_masters"
ADD COLUMN "normalizedName" TEXT,
ADD COLUMN "salts" JSONB,
ADD COLUMN "packSize" TEXT,
ADD COLUMN "type" TEXT,
ADD COLUMN "gtin" TEXT,
ADD COLUMN "stripImageUrl" TEXT,
ADD COLUMN "pillImageUrl" TEXT;

-- Backfill normalized names for current seed data.
UPDATE "medicine_masters"
SET "normalizedName" = lower(regexp_replace("brandName", '[^a-zA-Z0-9]+', '', 'g'))
WHERE "normalizedName" IS NULL;

-- CreateTable
CREATE TABLE "medicine_details" (
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

-- CreateIndex
CREATE INDEX "medicines_medicineMasterId_idx" ON "medicines"("medicineMasterId");

-- CreateIndex
CREATE INDEX "medicine_masters_brandName_idx" ON "medicine_masters"("brandName");

-- CreateIndex
CREATE INDEX "medicine_masters_normalizedName_idx" ON "medicine_masters"("normalizedName");

-- CreateIndex
CREATE INDEX "medicine_masters_composition_idx" ON "medicine_masters"("composition");

-- CreateIndex
CREATE UNIQUE INDEX "medicine_masters_gtin_key" ON "medicine_masters"("gtin");

-- CreateIndex
CREATE UNIQUE INDEX "medicine_details_medicineId_key" ON "medicine_details"("medicineId");

-- AddForeignKey
ALTER TABLE "medicines" ADD CONSTRAINT "medicines_medicineMasterId_fkey"
FOREIGN KEY ("medicineMasterId") REFERENCES "medicine_masters"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "medicine_details" ADD CONSTRAINT "medicine_details_medicineId_fkey"
FOREIGN KEY ("medicineId") REFERENCES "medicine_masters"("id") ON DELETE CASCADE ON UPDATE CASCADE;
