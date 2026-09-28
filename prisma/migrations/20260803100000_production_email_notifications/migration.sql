CREATE TYPE "NotificationDeliveryStatus" AS ENUM (
  'PENDING',
  'PROCESSING',
  'SENT',
  'SKIPPED',
  'FAILED'
);

CREATE TABLE "notification_preferences" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "emailEnabled" BOOLEAN NOT NULL DEFAULT FALSE,
  "missedDoseEmails" BOOLEAN NOT NULL DEFAULT FALSE,
  "refillEmails" BOOLEAN NOT NULL DEFAULT FALSE,
  "includeMedicineNames" BOOLEAN NOT NULL DEFAULT FALSE,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "notification_preferences_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "notification_deliveries" (
  "id" TEXT NOT NULL,
  "notificationLogId" TEXT NOT NULL,
  "channel" "NotificationChannel" NOT NULL,
  "status" "NotificationDeliveryStatus" NOT NULL DEFAULT 'PENDING',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "maxAttempts" INTEGER NOT NULL DEFAULT 5,
  "nextAttemptAt" TIMESTAMP(3),
  "claimedAt" TIMESTAMP(3),
  "provider" TEXT,
  "providerMessageId" TEXT,
  "recipientMasked" TEXT,
  "lastErrorCode" TEXT,
  "sentAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "notification_deliveries_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "notification_deliveries_attempts_check" CHECK ("attempts" >= 0 AND "attempts" <= "maxAttempts")
);

CREATE UNIQUE INDEX "notification_preferences_userId_key"
  ON "notification_preferences"("userId");
CREATE UNIQUE INDEX "notification_deliveries_notificationLogId_key"
  ON "notification_deliveries"("notificationLogId");
CREATE INDEX "notification_deliveries_channel_status_nextAttemptAt_idx"
  ON "notification_deliveries"("channel", "status", "nextAttemptAt");

ALTER TABLE "notification_preferences"
  ADD CONSTRAINT "notification_preferences_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "notification_deliveries"
  ADD CONSTRAINT "notification_deliveries_notificationLogId_fkey"
  FOREIGN KEY ("notificationLogId") REFERENCES "notification_logs"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
