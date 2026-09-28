-- CreateEnum
CREATE TYPE "VerificationStatus" AS ENUM ('VERIFIED', 'VERIFY_REQUIRED', 'NEEDS_REVIEW');

-- AlterTable
ALTER TABLE "extracted_medicines" ADD COLUMN     "brandName" TEXT,
ADD COLUMN     "genericName" TEXT,
ADD COLUMN     "strength" TEXT,
ADD COLUMN     "verificationStatus" "VerificationStatus" NOT NULL DEFAULT 'NEEDS_REVIEW';

-- CreateTable
CREATE TABLE "medicine_masters" (
    "id" TEXT NOT NULL,
    "brandName" TEXT NOT NULL,
    "genericName" TEXT,
    "composition" TEXT,
    "category" TEXT,
    "manufacturer" TEXT,
    "strength" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "medicine_masters_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "medicine_corrections" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "rawExtractedName" TEXT NOT NULL,
    "correctedName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "medicine_corrections_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "medicine_corrections_rawExtractedName_key" ON "medicine_corrections"("rawExtractedName");

-- CreateIndex
CREATE INDEX "medicine_corrections_rawExtractedName_idx" ON "medicine_corrections"("rawExtractedName");

-- AddForeignKey
ALTER TABLE "medicine_corrections" ADD CONSTRAINT "medicine_corrections_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
