CREATE TYPE "DoseBarrierReason" AS ENUM (
  'FORGOT',
  'ASLEEP',
  'AWAY_FROM_HOME',
  'ROUTINE_CHANGED',
  'RAN_OUT',
  'COST_OR_ACCESS',
  'SIDE_EFFECT_CONCERN',
  'DID_NOT_WANT_TO_TAKE',
  'OTHER'
);

ALTER TABLE "dose_logs"
  ADD COLUMN "barrierReason" "DoseBarrierReason",
  ADD COLUMN "barrierRecordedAt" TIMESTAMP(3);

ALTER TYPE "AuditAction" ADD VALUE 'DOSE_BARRIER_RECORDED';

CREATE INDEX "dose_logs_userId_barrierReason_scheduledAt_idx"
  ON "dose_logs"("userId", "barrierReason", "scheduledAt");
