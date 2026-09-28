ALTER TYPE "MedicineReviewType" ADD VALUE IF NOT EXISTS 'MISSING_CLINICAL_DETAILS';

ALTER TABLE "medicine_data_reviews"
ADD COLUMN IF NOT EXISTS "saltProfileId" TEXT;

ALTER TABLE "medicine_data_reviews"
ADD CONSTRAINT "medicine_data_reviews_saltProfileId_fkey"
FOREIGN KEY ("saltProfileId") REFERENCES "salt_profiles"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX IF NOT EXISTS "medicine_data_reviews_saltProfileId_idx"
ON "medicine_data_reviews"("saltProfileId");