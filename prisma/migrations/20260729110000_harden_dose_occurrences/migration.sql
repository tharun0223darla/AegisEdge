ALTER TABLE medicine_schedules
ADD COLUMN timezone TEXT NOT NULL DEFAULT 'UTC';

CREATE TYPE "DoseActionSource" AS ENUM (
  'APP',
  'DEVICE_NOTIFICATION',
  'OFFLINE_SYNC',
  'SYSTEM'
);

ALTER TABLE dose_logs
ADD COLUMN "actionSource" "DoseActionSource";

ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'DOSE_SKIPPED';

-- Older generators used skipDuplicates without a supporting unique key.
-- Preserve the most meaningful state before enforcing the invariant.
WITH ranked AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY "scheduleId", "scheduledAt"
      ORDER BY
        CASE status
          WHEN 'TAKEN' THEN 5
          WHEN 'SNOOZED' THEN 4
          WHEN 'SKIPPED' THEN 3
          WHEN 'MISSED' THEN 2
          ELSE 1
        END DESC,
        "actionAt" DESC NULLS LAST,
        "createdAt" ASC,
        id ASC
    ) AS duplicate_rank
  FROM dose_logs
)
DELETE FROM dose_logs
WHERE id IN (
  SELECT id FROM ranked WHERE duplicate_rank > 1
);

CREATE UNIQUE INDEX dose_logs_scheduleId_scheduledAt_key
ON dose_logs("scheduleId", "scheduledAt");

CREATE TABLE dose_action_events (
  id TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "doseLogId" TEXT NOT NULL,
  "clientActionId" TEXT NOT NULL,
  status "DoseStatus" NOT NULL,
  source "DoseActionSource" NOT NULL,
  "occurredAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT dose_action_events_pkey PRIMARY KEY (id)
);

CREATE UNIQUE INDEX dose_action_events_clientActionId_key
ON dose_action_events("clientActionId");

CREATE INDEX dose_action_events_userId_occurredAt_idx
ON dose_action_events("userId", "occurredAt");

CREATE INDEX dose_action_events_doseLogId_occurredAt_idx
ON dose_action_events("doseLogId", "occurredAt");

ALTER TABLE dose_action_events
ADD CONSTRAINT dose_action_events_userId_fkey
FOREIGN KEY ("userId") REFERENCES users(id)
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE dose_action_events
ADD CONSTRAINT dose_action_events_doseLogId_fkey
FOREIGN KEY ("doseLogId") REFERENCES dose_logs(id)
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE notification_logs
ADD COLUMN "dedupeKey" TEXT;

CREATE UNIQUE INDEX notification_logs_dedupeKey_key
ON notification_logs("dedupeKey");
