DROP INDEX IF EXISTS "health_metrics_deviceRegistryId_recordedAt_idx";
DROP INDEX IF EXISTS "health_metrics_userId_idempotencyKey_key";
ALTER TABLE "health_metrics" DROP CONSTRAINT IF EXISTS "health_metrics_deviceRegistryId_fkey";
ALTER TABLE "health_metrics"
  DROP COLUMN IF EXISTS "deviceRegistryId", DROP COLUMN IF EXISTS "unit",
  DROP COLUMN IF EXISTS "receivedAt", DROP COLUMN IF EXISTS "timezoneOffsetMinutes",
  DROP COLUMN IF EXISTS "quality", DROP COLUMN IF EXISTS "qualityFlags",
  DROP COLUMN IF EXISTS "sourceMetadata",
  DROP COLUMN IF EXISTS "clientRecordId", DROP COLUMN IF EXISTS "idempotencyKey",
  DROP COLUMN IF EXISTS "safetyAssessment", DROP COLUMN IF EXISTS "evaluatedAt",
  DROP COLUMN IF EXISTS "alertedAt";
ALTER TABLE "device_registries"
  DROP COLUMN IF EXISTS "trustLevel", DROP COLUMN IF EXISTS "protocol",
  DROP COLUMN IF EXISTS "manufacturer", DROP COLUMN IF EXISTS "model",
  DROP COLUMN IF EXISTS "verifiedAt", DROP COLUMN IF EXISTS "lastSyncError";
DROP TYPE IF EXISTS "MetricQuality";
DROP TYPE IF EXISTS "DeviceTrustLevel";

-- Enum values are intentionally retained because rebuilding live enums can lock tables.
