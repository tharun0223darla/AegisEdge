/*
  Warnings:

  - You are about to drop the column `filePath` on the `Bill` table. All the data in the column will be lost.
  - You are about to drop the column `filePath` on the `Prescription` table. All the data in the column will be lost.
  - Added the required column `localPath` to the `Bill` table without a default value. This is not possible if the table is not empty.
  - Added the required column `storedName` to the `Bill` table without a default value. This is not possible if the table is not empty.
  - Added the required column `localPath` to the `Prescription` table without a default value. This is not possible if the table is not empty.
  - Added the required column `storedName` to the `Prescription` table without a default value. This is not possible if the table is not empty.

*/
-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AuditAction" ADD VALUE 'FILE_UPLOADED';
ALTER TYPE "AuditAction" ADD VALUE 'OCR_PROCESSED';
ALTER TYPE "AuditAction" ADD VALUE 'OCR_FAILED';
ALTER TYPE "AuditAction" ADD VALUE 'PRESCRIPTION_CONFIRMED';
ALTER TYPE "AuditAction" ADD VALUE 'BILL_CONFIRMED';

-- AlterEnum
ALTER TYPE "DocumentStatus" ADD VALUE 'OCR_PROCESSING';

-- AlterTable
ALTER TABLE "Bill" DROP COLUMN "filePath",
ADD COLUMN     "localPath" TEXT NOT NULL,
ADD COLUMN     "notes" TEXT,
ADD COLUMN     "storedName" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "ExtractedMedicine" ADD COLUMN     "confirmedAt" TIMESTAMP(3),
ADD COLUMN     "createdMedicineId" TEXT,
ADD COLUMN     "createdScheduleId" TEXT;

-- AlterTable
ALTER TABLE "Prescription" DROP COLUMN "filePath",
ADD COLUMN     "doctorName" TEXT,
ADD COLUMN     "localPath" TEXT NOT NULL,
ADD COLUMN     "notes" TEXT,
ADD COLUMN     "prescribedAt" TIMESTAMP(3),
ADD COLUMN     "storedName" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "RefillLog" ADD COLUMN     "notes" TEXT;
