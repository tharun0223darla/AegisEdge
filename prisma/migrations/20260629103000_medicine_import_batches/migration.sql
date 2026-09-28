-- Medicine identity import staging.
-- One shared engine supports small admin uploads and large CLI/worker imports.
-- Rows are always scoped to importBatchId so concurrent/repeated imports do not mix.

CREATE TYPE "MedicineImportStatus" AS ENUM (
  'STAGED',
  'COMMITTING',
  'COMMITTED',
  'DISCARDED',
  'FAILED'
);

CREATE TYPE "MedicineImportRowAction" AS ENUM (
  'CREATE',
  'UPDATE',
  'DUPLICATE_IN_FILE',
  'INVALID',
  'NOOP'
);

CREATE TABLE "medicine_import_batches" (
  "id" TEXT NOT NULL,
  "uploadedById" TEXT,
  "originalFileName" TEXT,
  "storedPath" TEXT,
  "datasetName" TEXT,
  "datasetVersion" TEXT,
  "source" "RecordSource" NOT NULL DEFAULT 'IMPORT',
  "status" "MedicineImportStatus" NOT NULL DEFAULT 'STAGED',
  "totalRows" INTEGER NOT NULL DEFAULT 0,
  "validRows" INTEGER NOT NULL DEFAULT 0,
  "invalidRows" INTEGER NOT NULL DEFAULT 0,
  "duplicateRows" INTEGER NOT NULL DEFAULT 0,
  "createRows" INTEGER NOT NULL DEFAULT 0,
  "updateRows" INTEGER NOT NULL DEFAULT 0,
  "saltsToCreate" INTEGER NOT NULL DEFAULT 0,
  "saltsToReuse" INTEGER NOT NULL DEFAULT 0,
  "committedRows" INTEGER NOT NULL DEFAULT 0,
  "skippedRows" INTEGER NOT NULL DEFAULT 0,
  "report" JSONB,
  "committedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "medicine_import_batches_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "medicine_import_staging_rows" (
  "id" TEXT NOT NULL,
  "importBatchId" TEXT NOT NULL,
  "rowNumber" INTEGER NOT NULL,
  "action" "MedicineImportRowAction" NOT NULL DEFAULT 'INVALID',
  "raw" JSONB NOT NULL,
  "normalized" JSONB,
  "brandName" TEXT,
  "normalizedName" TEXT,
  "genericName" TEXT,
  "composition" TEXT,
  "manufacturer" TEXT,
  "strength" TEXT,
  "type" TEXT,
  "packSize" TEXT,
  "gtin" TEXT,
  "stripImageUrl" TEXT,
  "pillImageUrl" TEXT,
  "saltKey" TEXT,
  "saltDisplayName" TEXT,
  "ingredients" JSONB,
  "dedupeKey" TEXT,
  "validationErrors" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "warnings" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "duplicateInFile" BOOLEAN NOT NULL DEFAULT false,
  "existingMedicineMasterId" TEXT,
  "existingSaltProfileId" TEXT,
  "committedMedicineMasterId" TEXT,
  "committedSaltProfileId" TEXT,
  "committedPackageId" TEXT,
  "committedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "medicine_import_staging_rows_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "medicine_import_batches_uploadedById_idx"
ON "medicine_import_batches"("uploadedById");

CREATE INDEX "medicine_import_batches_status_createdAt_idx"
ON "medicine_import_batches"("status", "createdAt");

CREATE UNIQUE INDEX "medicine_import_staging_rows_importBatchId_rowNumber_key"
ON "medicine_import_staging_rows"("importBatchId", "rowNumber");

CREATE INDEX "medicine_import_staging_rows_importBatchId_action_idx"
ON "medicine_import_staging_rows"("importBatchId", "action");

CREATE INDEX "medicine_import_staging_rows_importBatchId_dedupeKey_idx"
ON "medicine_import_staging_rows"("importBatchId", "dedupeKey");

CREATE INDEX "medicine_import_staging_rows_importBatchId_saltKey_idx"
ON "medicine_import_staging_rows"("importBatchId", "saltKey");

ALTER TABLE "medicine_import_batches" ADD CONSTRAINT "medicine_import_batches_uploadedById_fkey"
FOREIGN KEY ("uploadedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "medicine_import_staging_rows" ADD CONSTRAINT "medicine_import_staging_rows_importBatchId_fkey"
FOREIGN KEY ("importBatchId") REFERENCES "medicine_import_batches"("id") ON DELETE CASCADE ON UPDATE CASCADE;
