ALTER TABLE "medicine_masters"
ADD COLUMN "prescriptionRequired" BOOLEAN;

ALTER TABLE "medicine_packages"
ADD COLUMN "mrpPrice" DECIMAL(10, 2),
ADD COLUMN "priceCurrency" TEXT NOT NULL DEFAULT 'INR',
ADD COLUMN "priceSource" TEXT,
ADD COLUMN "priceLastSeenAt" TIMESTAMP(3);

ALTER TABLE "medicine_import_staging_rows"
ADD COLUMN "prescriptionRequired" BOOLEAN,
ADD COLUMN "mrpPrice" DECIMAL(10, 2),
ADD COLUMN "priceCurrency" TEXT,
ADD COLUMN "priceSource" TEXT;

CREATE INDEX "medicine_masters_prescriptionRequired_idx"
ON "medicine_masters"("prescriptionRequired");
