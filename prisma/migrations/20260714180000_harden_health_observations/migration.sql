-- Extend the existing health-metric model in place so historical records remain available.
ALTER TYPE "MetricType" ADD VALUE IF NOT EXISTS 'OXYGEN_SATURATION';
ALTER TYPE "MetricSource" ADD VALUE IF NOT EXISTS 'HEALTH_CONNECT';
ALTER TYPE "MetricSource" ADD VALUE IF NOT EXISTS 'DEVICE_VENDOR';
ALTER TYPE "MetricSource" ADD VALUE IF NOT EXISTS 'UNVERIFIED_DEVICE';
ALTER TYPE "DeviceType" ADD VALUE IF NOT EXISTS 'PULSE_OXIMETER';

CREATE TYPE "MetricQuality" AS ENUM ('USER_REPORTED', 'DEVICE_REPORTED', 'QUESTIONABLE');
CREATE TYPE "DeviceTrustLevel" AS ENUM ('UNVERIFIED', 'SIMULATOR', 'VERIFIED');

ALTER TABLE "device_registries"
  ADD COLUMN "trustLevel" "DeviceTrustLevel" NOT NULL DEFAULT 'UNVERIFIED',
  ADD COLUMN "protocol" TEXT,
  ADD COLUMN "manufacturer" TEXT,
  ADD COLUMN "model" TEXT,
  ADD COLUMN "verifiedAt" TIMESTAMP(3),
  ADD COLUMN "lastSyncError" TEXT;

UPDATE "device_registries" SET "trustLevel" = 'SIMULATOR' WHERE "deviceId" LIKE 'sim-%';

ALTER TABLE "health_metrics"
  ADD COLUMN "deviceRegistryId" TEXT,
  ADD COLUMN "unit" TEXT,
  ADD COLUMN "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN "timezoneOffsetMinutes" INTEGER,
  ADD COLUMN "quality" "MetricQuality" NOT NULL DEFAULT 'USER_REPORTED',
  ADD COLUMN "qualityFlags" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "sourceMetadata" JSONB,
  ADD COLUMN "clientRecordId" TEXT,
  ADD COLUMN "idempotencyKey" TEXT,
  ADD COLUMN "safetyAssessment" JSONB,
  ADD COLUMN "evaluatedAt" TIMESTAMP(3),
  ADD COLUMN "alertedAt" TIMESTAMP(3);

UPDATE "health_metrics"
SET "unit" = CASE "metricType"::TEXT
  WHEN 'BLOOD_PRESSURE' THEN 'mmHg'
  WHEN 'BLOOD_GLUCOSE' THEN 'mg/dL'
  WHEN 'HEART_RATE' THEN 'bpm'
  WHEN 'SLEEP_HOURS' THEN 'h'
  ELSE 'unknown'
END;

UPDATE "health_metrics"
SET "quality" = CASE
  WHEN "source" = 'MANUAL' THEN 'USER_REPORTED'::"MetricQuality"
  WHEN "source" = 'BLUETOOTH_SIMULATED' THEN 'QUESTIONABLE'::"MetricQuality"
  ELSE 'DEVICE_REPORTED'::"MetricQuality"
END;

ALTER TABLE "health_metrics" ALTER COLUMN "unit" SET NOT NULL;
CREATE UNIQUE INDEX "health_metrics_userId_idempotencyKey_key" ON "health_metrics"("userId", "idempotencyKey");
CREATE INDEX "health_metrics_deviceRegistryId_recordedAt_idx" ON "health_metrics"("deviceRegistryId", "recordedAt");
ALTER TABLE "health_metrics" ADD CONSTRAINT "health_metrics_deviceRegistryId_fkey"
  FOREIGN KEY ("deviceRegistryId") REFERENCES "device_registries"("id") ON DELETE SET NULL ON UPDATE CASCADE;
