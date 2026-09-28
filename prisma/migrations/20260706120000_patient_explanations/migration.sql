CREATE TYPE "PatientExplanationStatus" AS ENUM ('NEEDS_SOURCE', 'GENERATED', 'REVIEW_REQUIRED', 'REVIEWED');

CREATE TABLE "patient_explanations" (
    "id" TEXT NOT NULL,
    "saltProfileId" TEXT NOT NULL,
    "language" TEXT NOT NULL DEFAULT 'en',
    "whyPrescribed" TEXT,
    "howToTake" TEXT,
    "sideEffects" JSONB,
    "warnings" TEXT,
    "storage" TEXT,
    "sourceRefs" JSONB,
    "unsafeOmittedFields" JSONB,
    "status" "PatientExplanationStatus" NOT NULL DEFAULT 'NEEDS_SOURCE',
    "generatedBy" TEXT,
    "modelVersion" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "patient_explanations_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "patient_explanations_saltProfileId_language_key" ON "patient_explanations"("saltProfileId", "language");
CREATE INDEX "patient_explanations_language_status_idx" ON "patient_explanations"("language", "status");
CREATE INDEX "patient_explanations_status_updatedAt_idx" ON "patient_explanations"("status", "updatedAt");

ALTER TABLE "patient_explanations" ADD CONSTRAINT "patient_explanations_saltProfileId_fkey" FOREIGN KEY ("saltProfileId") REFERENCES "salt_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;