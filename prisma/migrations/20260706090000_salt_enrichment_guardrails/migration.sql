ALTER TABLE "salt_profiles"
ADD COLUMN IF NOT EXISTS "lastEnrichmentAttemptAt" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "lastEnrichmentSuccessAt" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "lastEnrichmentError" TEXT;

CREATE INDEX IF NOT EXISTS "salt_profiles_enrichmentStatus_lastEnrichmentAttemptAt_idx"
ON "salt_profiles"("enrichmentStatus", "lastEnrichmentAttemptAt");
