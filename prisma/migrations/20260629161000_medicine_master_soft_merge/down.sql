ALTER TABLE "medicine_masters" DROP CONSTRAINT IF EXISTS "medicine_masters_mergedIntoId_fkey";
DROP INDEX IF EXISTS "medicine_masters_mergedIntoId_idx";
DROP INDEX IF EXISTS "medicine_masters_isArchived_idx";
ALTER TABLE "medicine_masters"
DROP COLUMN IF EXISTS "mergeReason",
DROP COLUMN IF EXISTS "mergedAt",
DROP COLUMN IF EXISTS "mergedIntoId",
DROP COLUMN IF EXISTS "isArchived";
