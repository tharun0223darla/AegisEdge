ALTER TYPE "MedSource" ADD VALUE IF NOT EXISTS 'PACKAGE_IMAGE';

ALTER TABLE "medicines"
ADD COLUMN "captureReviewKey" TEXT;

CREATE INDEX "medicines_captureReviewKey_idx"
ON "medicines"("captureReviewKey");

ALTER TABLE "medicine_data_reviews"
ADD COLUMN "normalizedKey" TEXT,
ADD COLUMN "source" "MedSource",
ADD COLUMN "strength" TEXT,
ADD COLUMN "form" "MedicineForm",
ADD COLUMN "billLine" TEXT,
ADD COLUMN "demandCount" INTEGER NOT NULL DEFAULT 1;

CREATE UNIQUE INDEX "medicine_data_reviews_normalizedKey_key"
ON "medicine_data_reviews"("normalizedKey");

CREATE INDEX "medicine_data_reviews_normalizedKey_idx"
ON "medicine_data_reviews"("normalizedKey");

CREATE INDEX "medicine_data_reviews_source_status_idx"
ON "medicine_data_reviews"("source", "status");
