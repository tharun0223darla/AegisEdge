-- CreateEnum
CREATE TYPE "ResolutionState" AS ENUM ('VERIFIED', 'REVIEW', 'UNKNOWN', 'REJECTED', 'PURCHASE_CONFIRMED');

-- CreateEnum
CREATE TYPE "VerificationExecutionStatus" AS ENUM ('NOT_ATTEMPTED', 'COMPLETED', 'SKIPPED_LOW_INFORMATION', 'SKIPPED_CALL_LIMIT', 'TIMEOUT', 'FAILED');

-- AlterTable
ALTER TABLE "extracted_medicines" ADD COLUMN     "extractionRunId" TEXT,
ADD COLUMN     "isActiveMedication" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "isUserConfirmed" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "originalCandidateMentionId" TEXT,
ADD COLUMN     "resolutionState" "ResolutionState" NOT NULL DEFAULT 'REVIEW',
ADD COLUMN     "verificationExecutionStatus" "VerificationExecutionStatus" NOT NULL DEFAULT 'NOT_ATTEMPTED',
ADD COLUMN     "verificationPriority" INTEGER,
ADD COLUMN     "verificationSkippedReason" TEXT;

-- AlterTable
ALTER TABLE "medicine_corrections" ADD COLUMN     "count" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "lastUsed" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "prescriptions" ADD COLUMN     "explainabilityJson" JSONB;

-- CreateIndex
CREATE INDEX "extracted_medicines_resolutionState_idx" ON "extracted_medicines"("resolutionState");

-- CreateIndex
CREATE INDEX "extracted_medicines_verificationExecutionStatus_idx" ON "extracted_medicines"("verificationExecutionStatus");

-- CreateIndex
CREATE INDEX "extracted_medicines_isUserConfirmed_isActiveMedication_idx" ON "extracted_medicines"("isUserConfirmed", "isActiveMedication");

-- CreateIndex
CREATE INDEX "extracted_medicines_originalCandidateMentionId_idx" ON "extracted_medicines"("originalCandidateMentionId");

-- CreateIndex
CREATE UNIQUE INDEX "extracted_medicines_extractionRunId_originalCandidateMentio_key" ON "extracted_medicines"("extractionRunId", "originalCandidateMentionId");

-- Backfill existing rows if any exist
UPDATE "extracted_medicines"
SET
  "resolutionState" = CASE
    WHEN "verificationStatus" = 'VERIFIED' THEN 'VERIFIED'::"ResolutionState"
    WHEN "verificationStatus" = 'NEEDS_REVIEW' THEN 'REVIEW'::"ResolutionState"
    ELSE 'REVIEW'::"ResolutionState"
  END,
  "isUserConfirmed" = "isConfirmed",
  "isActiveMedication" = "isConfirmed",
  "verificationExecutionStatus" = 'NOT_ATTEMPTED'::"VerificationExecutionStatus",
  "extractionRunId" = 'legacy_run',
  "originalCandidateMentionId" = 'legacy_' || "id";
