CREATE TABLE "web_source_assist_cache" (
    "id" TEXT NOT NULL,
    "saltProfileId" TEXT NOT NULL,
    "query" TEXT NOT NULL,
    "queryHash" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'Tavily',
    "status" TEXT NOT NULL DEFAULT 'SUCCESS',
    "result" JSONB NOT NULL,
    "sourceCount" INTEGER NOT NULL DEFAULT 0,
    "evidenceCount" INTEGER NOT NULL DEFAULT 0,
    "draftedFields" JSONB,
    "warnings" JSONB,
    "lastError" TEXT,
    "searchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "web_source_assist_cache_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "web_source_assist_cache_queryHash_key" ON "web_source_assist_cache"("queryHash");
CREATE INDEX "web_source_assist_cache_saltProfileId_searchedAt_idx" ON "web_source_assist_cache"("saltProfileId", "searchedAt");
CREATE INDEX "web_source_assist_cache_saltProfileId_expiresAt_idx" ON "web_source_assist_cache"("saltProfileId", "expiresAt");
CREATE INDEX "web_source_assist_cache_status_searchedAt_idx" ON "web_source_assist_cache"("status", "searchedAt");

ALTER TABLE "web_source_assist_cache" ADD CONSTRAINT "web_source_assist_cache_saltProfileId_fkey" FOREIGN KEY ("saltProfileId") REFERENCES "salt_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;