CREATE TABLE "email_verification_tokens" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "usedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "email_verification_tokens_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "email_verification_tokens_expiry_check" CHECK ("expiresAt" > "createdAt")
);

CREATE UNIQUE INDEX "email_verification_tokens_tokenHash_key"
  ON "email_verification_tokens"("tokenHash");
CREATE INDEX "email_verification_tokens_userId_usedAt_expiresAt_idx"
  ON "email_verification_tokens"("userId", "usedAt", "expiresAt");
CREATE INDEX "email_verification_tokens_expiresAt_idx"
  ON "email_verification_tokens"("expiresAt");

ALTER TABLE "email_verification_tokens"
  ADD CONSTRAINT "email_verification_tokens_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'EMAIL_VERIFICATION_SENT';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'EMAIL_VERIFIED';

-- Existing accounts already had full application access before this gate.
-- Grandfather them once so deployment does not lock out current users.
UPDATE "users" SET "isVerified" = TRUE WHERE "isVerified" = FALSE;
