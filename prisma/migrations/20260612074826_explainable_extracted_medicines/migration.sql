-- AlterTable
ALTER TABLE "extracted_medicines" ADD COLUMN     "reasons" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "verificationSource" TEXT;
