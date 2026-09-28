-- Additive medication-safety schema. Legacy patient profile fields remain intact.
ALTER TYPE "CarePermission" ADD VALUE IF NOT EXISTS 'VIEW_MEDICATION_SAFETY';

ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'SAFETY_PROFILE_UPDATED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'ALLERGY_RECORDED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'ALLERGY_UPDATED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'ALLERGY_REMOVED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'SAFETY_FINDING_ACKNOWLEDGED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'MEDICATION_SAFETY_REVIEWED';

CREATE TYPE "SafetyConditionStatus" AS ENUM ('UNKNOWN', 'NO', 'YES', 'NOT_APPLICABLE');
CREATE TYPE "SafetyRecordSource" AS ENUM ('PATIENT_REPORTED', 'CAREGIVER_REPORTED', 'CLINICIAN', 'ADMIN', 'IMPORT');
CREATE TYPE "SafetyVerificationStatus" AS ENUM ('UNVERIFIED', 'CONFIRMED', 'REFUTED', 'ENTERED_IN_ERROR');
CREATE TYPE "AllergyCategory" AS ENUM ('ALLERGY', 'INTOLERANCE');
CREATE TYPE "AllergyCriticality" AS ENUM ('LOW', 'HIGH', 'UNABLE_TO_ASSESS');
CREATE TYPE "AllergyClinicalStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'RESOLVED', 'ENTERED_IN_ERROR');
CREATE TYPE "MedicationSafetyRule" AS ENUM ('EXACT_DUPLICATE', 'DUPLICATE_INGREDIENT', 'ALLERGY_CONFLICT', 'OVERLAPPING_SCHEDULE', 'UNKNOWN_COMPOSITION');
CREATE TYPE "MedicationSafetySeverity" AS ENUM ('INFO', 'WARNING', 'HIGH');
CREATE TYPE "MedicationSafetyFindingStatus" AS ENUM ('OPEN', 'ACKNOWLEDGED', 'RESOLVED', 'DISMISSED');

CREATE TABLE "patient_safety_profiles" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "pregnancyStatus" "SafetyConditionStatus" NOT NULL DEFAULT 'UNKNOWN',
    "kidneyCondition" "SafetyConditionStatus" NOT NULL DEFAULT 'UNKNOWN',
    "liverCondition" "SafetyConditionStatus" NOT NULL DEFAULT 'UNKNOWN',
    "source" "SafetyRecordSource" NOT NULL DEFAULT 'PATIENT_REPORTED',
    "verificationStatus" "SafetyVerificationStatus" NOT NULL DEFAULT 'UNVERIFIED',
    "lastReviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "patient_safety_profiles_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "allergy_intolerances" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "saltProfileId" TEXT,
    "substanceRaw" TEXT NOT NULL,
    "normalizedSubstance" TEXT NOT NULL,
    "category" "AllergyCategory" NOT NULL DEFAULT 'ALLERGY',
    "criticality" "AllergyCriticality" NOT NULL DEFAULT 'UNABLE_TO_ASSESS',
    "reaction" TEXT,
    "clinicalStatus" "AllergyClinicalStatus" NOT NULL DEFAULT 'ACTIVE',
    "verificationStatus" "SafetyVerificationStatus" NOT NULL DEFAULT 'UNVERIFIED',
    "source" "SafetyRecordSource" NOT NULL DEFAULT 'PATIENT_REPORTED',
    "verifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "allergy_intolerances_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "medication_safety_findings" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "rule" "MedicationSafetyRule" NOT NULL,
    "severity" "MedicationSafetySeverity" NOT NULL,
    "status" "MedicationSafetyFindingStatus" NOT NULL DEFAULT 'OPEN',
    "title" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "triggerIngredients" JSONB NOT NULL,
    "evidence" JSONB NOT NULL,
    "sourceRefs" JSONB,
    "firstDetectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastDetectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "acknowledgedAt" TIMESTAMP(3),
    "resolvedAt" TIMESTAMP(3),
    "resolutionReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "medication_safety_findings_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "medication_safety_finding_medicines" (
    "findingId" TEXT NOT NULL,
    "medicineId" TEXT NOT NULL,
    CONSTRAINT "medication_safety_finding_medicines_pkey" PRIMARY KEY ("findingId", "medicineId")
);

CREATE UNIQUE INDEX "patient_safety_profiles_userId_key" ON "patient_safety_profiles"("userId");
CREATE INDEX "allergy_intolerances_userId_clinicalStatus_idx" ON "allergy_intolerances"("userId", "clinicalStatus");
CREATE INDEX "allergy_intolerances_userId_normalizedSubstance_idx" ON "allergy_intolerances"("userId", "normalizedSubstance");
CREATE INDEX "allergy_intolerances_saltProfileId_idx" ON "allergy_intolerances"("saltProfileId");
CREATE UNIQUE INDEX "medication_safety_findings_fingerprint_key" ON "medication_safety_findings"("fingerprint");
CREATE INDEX "medication_safety_findings_userId_status_severity_idx" ON "medication_safety_findings"("userId", "status", "severity");
CREATE INDEX "medication_safety_findings_userId_rule_idx" ON "medication_safety_findings"("userId", "rule");
CREATE INDEX "medication_safety_finding_medicines_medicineId_idx" ON "medication_safety_finding_medicines"("medicineId");

ALTER TABLE "patient_safety_profiles" ADD CONSTRAINT "patient_safety_profiles_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "allergy_intolerances" ADD CONSTRAINT "allergy_intolerances_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "allergy_intolerances" ADD CONSTRAINT "allergy_intolerances_saltProfileId_fkey" FOREIGN KEY ("saltProfileId") REFERENCES "salt_profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "medication_safety_findings" ADD CONSTRAINT "medication_safety_findings_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "medication_safety_finding_medicines" ADD CONSTRAINT "medication_safety_finding_medicines_findingId_fkey" FOREIGN KEY ("findingId") REFERENCES "medication_safety_findings"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "medication_safety_finding_medicines" ADD CONSTRAINT "medication_safety_finding_medicines_medicineId_fkey" FOREIGN KEY ("medicineId") REFERENCES "medicines"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Existing profile allergy strings become unverified patient-reported records.
INSERT INTO "allergy_intolerances" (
    "id", "userId", "substanceRaw", "normalizedSubstance", "category",
    "criticality", "clinicalStatus", "verificationStatus", "source", "createdAt", "updatedAt"
)
SELECT DISTINCT
    'legacy_' || md5(pp."userId" || ':' || lower(trim(allergy))),
    pp."userId",
    trim(allergy),
    trim(regexp_replace(lower(allergy), '[^a-z0-9]+', ' ', 'g')),
    'ALLERGY'::"AllergyCategory",
    'UNABLE_TO_ASSESS'::"AllergyCriticality",
    'ACTIVE'::"AllergyClinicalStatus",
    'UNVERIFIED'::"SafetyVerificationStatus",
    'IMPORT'::"SafetyRecordSource",
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
FROM "patient_profiles" pp
CROSS JOIN LATERAL unnest(pp."allergies") AS allergy
WHERE length(trim(allergy)) > 0;
