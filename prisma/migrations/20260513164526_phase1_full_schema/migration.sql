/*
  Warnings:

  - You are about to drop the column `dosage` on the `Medicine` table. All the data in the column will be lost.
  - You are about to drop the column `patientId` on the `Medicine` table. All the data in the column will be lost.
  - You are about to drop the column `scheduledTime` on the `MedicineSchedule` table. All the data in the column will be lost.
  - You are about to drop the column `age` on the `PatientProfile` table. All the data in the column will be lost.
  - You are about to drop the column `fullName` on the `PatientProfile` table. All the data in the column will be lost.
  - You are about to drop the column `phoneNumber` on the `PatientProfile` table. All the data in the column will be lost.
  - A unique constraint covering the columns `[scheduleId,scheduledAt]` on the table `DoseLog` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `medicineId` to the `DoseLog` table without a default value. This is not possible if the table is not empty.
  - Added the required column `updatedAt` to the `DoseLog` table without a default value. This is not possible if the table is not empty.
  - Added the required column `userId` to the `DoseLog` table without a default value. This is not possible if the table is not empty.
  - Added the required column `userId` to the `Medicine` table without a default value. This is not possible if the table is not empty.
  - Added the required column `startDate` to the `MedicineSchedule` table without a default value. This is not possible if the table is not empty.
  - Added the required column `userId` to the `MedicineSchedule` table without a default value. This is not possible if the table is not empty.
  - Changed the type of `frequency` on the `MedicineSchedule` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.
  - Added the required column `firstName` to the `PatientProfile` table without a default value. This is not possible if the table is not empty.
  - Added the required column `lastName` to the `PatientProfile` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "MedicineForm" AS ENUM ('TABLET', 'CAPSULE', 'SYRUP', 'INJECTION', 'DROPS', 'INHALER', 'PATCH', 'CREAM', 'OTHER');

-- CreateEnum
CREATE TYPE "ScheduleFrequency" AS ENUM ('DAILY', 'TWICE_DAILY', 'THREE_TIMES_DAILY', 'FOUR_TIMES_DAILY', 'WEEKLY', 'AS_NEEDED', 'CUSTOM');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AuditAction" ADD VALUE 'CREATED';
ALTER TYPE "AuditAction" ADD VALUE 'UPDATED';
ALTER TYPE "AuditAction" ADD VALUE 'SCHEDULE_ACTIVATED';
ALTER TYPE "AuditAction" ADD VALUE 'SCHEDULE_DEACTIVATED';
ALTER TYPE "AuditAction" ADD VALUE 'DOSE_RECORDED';

-- DropForeignKey
ALTER TABLE "DoseLog" DROP CONSTRAINT "DoseLog_scheduleId_fkey";

-- DropForeignKey
ALTER TABLE "Medicine" DROP CONSTRAINT "Medicine_patientId_fkey";

-- DropForeignKey
ALTER TABLE "MedicineSchedule" DROP CONSTRAINT "MedicineSchedule_medicineId_fkey";

-- DropForeignKey
ALTER TABLE "PatientProfile" DROP CONSTRAINT "PatientProfile_userId_fkey";

-- AlterTable
ALTER TABLE "AuditLog" ADD COLUMN     "entityType" TEXT,
ADD COLUMN     "newValues" JSONB,
ADD COLUMN     "oldValues" JSONB;

-- AlterTable
ALTER TABLE "DoseLog" ADD COLUMN     "actionAt" TIMESTAMP(3),
ADD COLUMN     "medicineId" TEXT NOT NULL,
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL,
ADD COLUMN     "userId" TEXT NOT NULL,
ALTER COLUMN "status" SET DEFAULT 'PENDING';

-- AlterTable
ALTER TABLE "Medicine" DROP COLUMN "dosage",
DROP COLUMN "patientId",
ADD COLUMN     "brandName" TEXT,
ADD COLUMN     "color" TEXT,
ADD COLUMN     "form" "MedicineForm" NOT NULL DEFAULT 'TABLET',
ADD COLUMN     "genericName" TEXT,
ADD COLUMN     "isActive" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "notes" TEXT,
ADD COLUMN     "remainingQuantity" INTEGER,
ADD COLUMN     "shape" TEXT,
ADD COLUMN     "sideEffects" TEXT,
ADD COLUMN     "strength" TEXT,
ADD COLUMN     "totalQuantity" INTEGER,
ADD COLUMN     "userId" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "MedicineSchedule" DROP COLUMN "scheduledTime",
ADD COLUMN     "daysOfWeek" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
ADD COLUMN     "dosesPerIntake" DOUBLE PRECISION NOT NULL DEFAULT 1,
ADD COLUMN     "endDate" TIMESTAMP(3),
ADD COLUMN     "isActive" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "notes" TEXT,
ADD COLUMN     "startDate" TIMESTAMP(3) NOT NULL,
ADD COLUMN     "timesOfDay" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "unit" TEXT NOT NULL DEFAULT 'tablet',
ADD COLUMN     "userId" TEXT NOT NULL,
DROP COLUMN "frequency",
ADD COLUMN     "frequency" "ScheduleFrequency" NOT NULL;

-- AlterTable
ALTER TABLE "PatientProfile" DROP COLUMN "age",
DROP COLUMN "fullName",
DROP COLUMN "phoneNumber",
ADD COLUMN     "allergies" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "avatarUrl" TEXT,
ADD COLUMN     "bloodGroup" TEXT,
ADD COLUMN     "conditions" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "dateOfBirth" TIMESTAMP(3),
ADD COLUMN     "emergencyContact" TEXT,
ADD COLUMN     "emergencyPhone" TEXT,
ADD COLUMN     "firstName" TEXT NOT NULL,
ADD COLUMN     "height" DOUBLE PRECISION,
ADD COLUMN     "lastName" TEXT NOT NULL,
ADD COLUMN     "notes" TEXT,
ADD COLUMN     "weight" DOUBLE PRECISION,
ALTER COLUMN "gender" DROP NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "DoseLog_scheduleId_scheduledAt_key" ON "DoseLog"("scheduleId", "scheduledAt");

-- AddForeignKey
ALTER TABLE "PatientProfile" ADD CONSTRAINT "PatientProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Medicine" ADD CONSTRAINT "Medicine_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MedicineSchedule" ADD CONSTRAINT "MedicineSchedule_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MedicineSchedule" ADD CONSTRAINT "MedicineSchedule_medicineId_fkey" FOREIGN KEY ("medicineId") REFERENCES "Medicine"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DoseLog" ADD CONSTRAINT "DoseLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DoseLog" ADD CONSTRAINT "DoseLog_medicineId_fkey" FOREIGN KEY ("medicineId") REFERENCES "Medicine"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DoseLog" ADD CONSTRAINT "DoseLog_scheduleId_fkey" FOREIGN KEY ("scheduleId") REFERENCES "MedicineSchedule"("id") ON DELETE CASCADE ON UPDATE CASCADE;
