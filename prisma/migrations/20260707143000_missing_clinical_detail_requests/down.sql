DROP INDEX IF EXISTS "medicine_data_reviews_saltProfileId_idx";

ALTER TABLE "medicine_data_reviews"
DROP CONSTRAINT IF EXISTS "medicine_data_reviews_saltProfileId_fkey";

ALTER TABLE "medicine_data_reviews"
DROP COLUMN IF EXISTS "saltProfileId";

-- PostgreSQL enum values cannot be removed safely in a down migration without
-- recreating the enum and rewriting dependent columns.