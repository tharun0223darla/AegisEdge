DROP INDEX IF EXISTS "medicine_masters_isDiscontinued_idx";
ALTER TABLE "medicine_import_staging_rows"
DROP COLUMN IF EXISTS "isDiscontinued";
ALTER TABLE "medicine_masters"
DROP COLUMN IF EXISTS "isDiscontinued";
