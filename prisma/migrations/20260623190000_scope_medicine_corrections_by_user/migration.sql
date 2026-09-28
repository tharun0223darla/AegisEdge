-- Medicine corrections are user-learned data. A global unique key can leak or
-- block corrections across users, so scope uniqueness to the owning user.
DROP INDEX IF EXISTS "medicine_corrections_rawExtractedName_key";
CREATE UNIQUE INDEX "medicine_corrections_userId_rawExtractedName_key"
ON "medicine_corrections"("userId", "rawExtractedName");
