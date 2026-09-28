ALTER TYPE "CarePermission" ADD VALUE IF NOT EXISTS 'RECEIVE_DOSE_HELP_REQUESTS';

CREATE TYPE "CareEscalationKind" AS ENUM ('MISSED_DOSE', 'DOSE_HELP_REQUEST');

ALTER TABLE "care_escalations"
ADD COLUMN "kind" "CareEscalationKind" NOT NULL DEFAULT 'MISSED_DOSE';

DROP INDEX "care_escalations_relationshipId_doseLogId_key";

CREATE UNIQUE INDEX "care_escalations_relationshipId_doseLogId_kind_key"
ON "care_escalations"("relationshipId", "doseLogId", "kind");

ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'CARE_DOSE_HELP_REQUESTED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'CARE_DOSE_HELP_ESCALATED';
