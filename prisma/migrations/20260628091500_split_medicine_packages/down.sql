-- Manual rollback companion for 20260628091500_split_medicine_packages.
-- Prisma does not execute down migrations automatically. Run only against a DB copy
-- or during a controlled rollback window after verifying package data.

ALTER TABLE "medicine_masters"
ADD COLUMN IF NOT EXISTS "packSize" TEXT,
ADD COLUMN IF NOT EXISTS "gtin" TEXT,
ADD COLUMN IF NOT EXISTS "stripImageUrl" TEXT,
ADD COLUMN IF NOT EXISTS "pillImageUrl" TEXT;

-- Copy one non-demo package back to the identity row. If multiple packages exist,
-- prefer a verified package, then the oldest package.
WITH ranked_packages AS (
  SELECT
    p.*,
    row_number() OVER (
      PARTITION BY p."medicineId"
      ORDER BY p."isVerified" DESC, p."createdAt" ASC
    ) AS rank
  FROM "medicine_packages" p
  WHERE p."isDemo" = false
)
UPDATE "medicine_masters" AS m
SET
  "packSize" = p."packSize",
  "gtin" = p."gtin",
  "stripImageUrl" = p."stripImageUrl",
  "pillImageUrl" = p."pillImageUrl"
FROM ranked_packages AS p
WHERE m."id" = p."medicineId"
  AND p.rank = 1;

ALTER TABLE "medicines" DROP CONSTRAINT IF EXISTS "medicines_medicinePackageId_fkey";
ALTER TABLE "medicine_data_reviews" DROP CONSTRAINT IF EXISTS "medicine_data_reviews_medicinePackageId_fkey";
ALTER TABLE "medicine_data_reviews" DROP CONSTRAINT IF EXISTS "medicine_data_reviews_medicineMasterId_fkey";
ALTER TABLE "medicine_data_reviews" DROP CONSTRAINT IF EXISTS "medicine_data_reviews_reviewedById_fkey";
ALTER TABLE "medicine_data_reviews" DROP CONSTRAINT IF EXISTS "medicine_data_reviews_submittedById_fkey";
ALTER TABLE "medicine_packages" DROP CONSTRAINT IF EXISTS "medicine_packages_medicineId_fkey";

DROP TABLE IF EXISTS "medicine_data_reviews";
DROP TABLE IF EXISTS "medicine_packages";

DROP TYPE IF EXISTS "MedicineReviewStatus";
DROP TYPE IF EXISTS "MedicineReviewType";

ALTER TABLE "medicines" DROP COLUMN IF EXISTS "medicinePackageId";

CREATE UNIQUE INDEX IF NOT EXISTS "medicine_masters_gtin_key" ON "medicine_masters"("gtin");
