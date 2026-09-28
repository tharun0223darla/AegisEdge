DROP INDEX IF EXISTS "medicine_data_reviews_source_status_idx";
DROP INDEX IF EXISTS "medicine_data_reviews_normalizedKey_idx";
DROP INDEX IF EXISTS "medicine_data_reviews_normalizedKey_key";

ALTER TABLE "medicine_data_reviews"
DROP COLUMN IF EXISTS "demandCount",
DROP COLUMN IF EXISTS "billLine",
DROP COLUMN IF EXISTS "form",
DROP COLUMN IF EXISTS "strength",
DROP COLUMN IF EXISTS "source",
DROP COLUMN IF EXISTS "normalizedKey";

DROP INDEX IF EXISTS "medicines_captureReviewKey_idx";

ALTER TABLE "medicines"
DROP COLUMN IF EXISTS "captureReviewKey";

-- PostgreSQL enum values cannot be removed safely in a down migration without
-- recreating the enum and rewriting dependent columns.
