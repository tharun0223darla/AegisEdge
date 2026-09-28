ALTER TABLE "medicine_masters"
ADD COLUMN "isDiscontinued" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "medicine_import_staging_rows"
ADD COLUMN "isDiscontinued" BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX "medicine_masters_isDiscontinued_idx"
ON "medicine_masters"("isDiscontinued");
