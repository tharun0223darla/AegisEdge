CREATE TYPE "CarePermission" AS ENUM (
  'VIEW_ADHERENCE',
  'VIEW_MEDICATIONS',
  'VIEW_REFILLS',
  'RECEIVE_MISSED_DOSE_ALERTS'
);

CREATE TYPE "CareRelationshipStatus" AS ENUM ('ACTIVE', 'REVOKED', 'EXPIRED');
CREATE TYPE "CareInvitationStatus" AS ENUM ('PENDING', 'ACCEPTED', 'REVOKED', 'EXPIRED');
CREATE TYPE "CareEscalationStatus" AS ENUM ('PENDING', 'PROCESSING', 'SENT', 'FAILED');

CREATE TABLE "care_relationships" (
  "id" TEXT NOT NULL,
  "patientId" TEXT NOT NULL,
  "caregiverId" TEXT NOT NULL,
  "status" "CareRelationshipStatus" NOT NULL DEFAULT 'ACTIVE',
  "permissions" "CarePermission"[] NOT NULL,
  "consentVersion" TEXT NOT NULL,
  "patientConsentedAt" TIMESTAMP(3) NOT NULL,
  "caregiverAcknowledgedAt" TIMESTAMP(3) NOT NULL,
  "expiresAt" TIMESTAMP(3),
  "revokedAt" TIMESTAMP(3),
  "revokedById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "care_relationships_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "care_relationships_distinct_people_check" CHECK ("patientId" <> "caregiverId"),
  CONSTRAINT "care_relationships_permissions_check" CHECK (cardinality("permissions") > 0)
);

CREATE TABLE "care_invitations" (
  "id" TEXT NOT NULL,
  "patientId" TEXT NOT NULL,
  "invitedEmail" TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "permissions" "CarePermission"[] NOT NULL,
  "status" "CareInvitationStatus" NOT NULL DEFAULT 'PENDING',
  "consentVersion" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "accessExpiresAt" TIMESTAMP(3) NOT NULL,
  "acceptedAt" TIMESTAMP(3),
  "acceptedById" TEXT,
  "relationshipId" TEXT,
  "revokedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "care_invitations_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "care_invitations_permissions_check" CHECK (cardinality("permissions") > 0),
  CONSTRAINT "care_invitations_expiry_check" CHECK ("expiresAt" > "createdAt")
);

CREATE TABLE "care_escalations" (
  "id" TEXT NOT NULL,
  "relationshipId" TEXT NOT NULL,
  "doseLogId" TEXT NOT NULL,
  "status" "CareEscalationStatus" NOT NULL DEFAULT 'PENDING',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "claimedAt" TIMESTAMP(3),
  "nextAttemptAt" TIMESTAMP(3),
  "notifiedAt" TIMESTAMP(3),
  "lastError" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "care_escalations_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "care_relationships_patientId_caregiverId_key" ON "care_relationships"("patientId", "caregiverId");
CREATE INDEX "care_relationships_patientId_status_idx" ON "care_relationships"("patientId", "status");
CREATE INDEX "care_relationships_caregiverId_status_idx" ON "care_relationships"("caregiverId", "status");
CREATE INDEX "care_relationships_status_expiresAt_idx" ON "care_relationships"("status", "expiresAt");

CREATE UNIQUE INDEX "care_invitations_tokenHash_key" ON "care_invitations"("tokenHash");
CREATE UNIQUE INDEX "care_invitations_one_pending_per_recipient_idx" ON "care_invitations"("patientId", "invitedEmail") WHERE "status" = 'PENDING';
CREATE INDEX "care_invitations_patientId_status_idx" ON "care_invitations"("patientId", "status");
CREATE INDEX "care_invitations_invitedEmail_status_idx" ON "care_invitations"("invitedEmail", "status");
CREATE INDEX "care_invitations_status_expiresAt_idx" ON "care_invitations"("status", "expiresAt");

CREATE UNIQUE INDEX "care_escalations_relationshipId_doseLogId_key" ON "care_escalations"("relationshipId", "doseLogId");
CREATE INDEX "care_escalations_status_nextAttemptAt_idx" ON "care_escalations"("status", "nextAttemptAt");
CREATE INDEX "care_escalations_doseLogId_idx" ON "care_escalations"("doseLogId");

ALTER TABLE "care_relationships" ADD CONSTRAINT "care_relationships_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "care_relationships" ADD CONSTRAINT "care_relationships_caregiverId_fkey" FOREIGN KEY ("caregiverId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "care_invitations" ADD CONSTRAINT "care_invitations_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "care_invitations" ADD CONSTRAINT "care_invitations_acceptedById_fkey" FOREIGN KEY ("acceptedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "care_invitations" ADD CONSTRAINT "care_invitations_relationshipId_fkey" FOREIGN KEY ("relationshipId") REFERENCES "care_relationships"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "care_escalations" ADD CONSTRAINT "care_escalations_relationshipId_fkey" FOREIGN KEY ("relationshipId") REFERENCES "care_relationships"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "care_escalations" ADD CONSTRAINT "care_escalations_doseLogId_fkey" FOREIGN KEY ("doseLogId") REFERENCES "dose_logs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'CARE_INVITATION_CREATED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'CARE_INVITATION_ACCEPTED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'CARE_INVITATION_REVOKED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'CARE_ACCESS_UPDATED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'CARE_ACCESS_REVOKED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'CAREGIVER_DATA_ACCESSED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'CARE_MISSED_DOSE_ESCALATED';