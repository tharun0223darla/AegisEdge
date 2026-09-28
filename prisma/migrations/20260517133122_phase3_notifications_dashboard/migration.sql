/*
  Warnings:

  - The values [CREATE,UPDATE,DELETE,REGISTER,DOSE_RECORDED] on the enum `AuditAction` will be removed. If these variants are still used in the database, this will fail.
  - You are about to drop the `AuditLog` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `Bill` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `DoseLog` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `ExtractedMedicine` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `Medicine` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `MedicineSchedule` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `PatientProfile` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `Prescription` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `RefillLog` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `User` table. If the table is not empty, all the data it contains will be lost.

*/
-- CreateEnum
CREATE TYPE "NotificationChannel" AS ENUM ('LOCAL', 'PUSH', 'SMS', 'EMAIL');

-- CreateEnum
CREATE TYPE "RiskLevel" AS ENUM ('LOW', 'MEDIUM', 'HIGH');

-- AlterEnum
BEGIN;
CREATE TYPE "AuditAction_new" AS ENUM ('CREATED', 'UPDATED', 'DELETED', 'LOGIN', 'LOGOUT', 'PASSWORD_CHANGED', 'DOSE_TAKEN', 'DOSE_MISSED', 'DOSE_SNOOZED', 'SCHEDULE_ACTIVATED', 'SCHEDULE_DEACTIVATED', 'FILE_UPLOADED', 'OCR_PROCESSED', 'OCR_FAILED', 'PRESCRIPTION_CONFIRMED', 'BILL_CONFIRMED', 'REFILL_LOGGED', 'DOSE_SNOOZED_EXTENDED', 'ADHERENCE_SNAPSHOT_CREATED', 'REMINDER_SENT');
ALTER TABLE "AuditLog" ALTER COLUMN "action" TYPE "AuditAction_new" USING ("action"::text::"AuditAction_new");
ALTER TYPE "AuditAction" RENAME TO "AuditAction_old";
ALTER TYPE "AuditAction_new" RENAME TO "AuditAction";
DROP TYPE "public"."AuditAction_old";
COMMIT;

-- DropForeignKey
ALTER TABLE "Bill" DROP CONSTRAINT "Bill_userId_fkey";

-- DropForeignKey
ALTER TABLE "DoseLog" DROP CONSTRAINT "DoseLog_medicineId_fkey";

-- DropForeignKey
ALTER TABLE "DoseLog" DROP CONSTRAINT "DoseLog_scheduleId_fkey";

-- DropForeignKey
ALTER TABLE "DoseLog" DROP CONSTRAINT "DoseLog_userId_fkey";

-- DropForeignKey
ALTER TABLE "ExtractedMedicine" DROP CONSTRAINT "ExtractedMedicine_billId_fkey";

-- DropForeignKey
ALTER TABLE "ExtractedMedicine" DROP CONSTRAINT "ExtractedMedicine_prescriptionId_fkey";

-- DropForeignKey
ALTER TABLE "ExtractedMedicine" DROP CONSTRAINT "ExtractedMedicine_userId_fkey";

-- DropForeignKey
ALTER TABLE "Medicine" DROP CONSTRAINT "Medicine_userId_fkey";

-- DropForeignKey
ALTER TABLE "MedicineSchedule" DROP CONSTRAINT "MedicineSchedule_medicineId_fkey";

-- DropForeignKey
ALTER TABLE "MedicineSchedule" DROP CONSTRAINT "MedicineSchedule_userId_fkey";

-- DropForeignKey
ALTER TABLE "PatientProfile" DROP CONSTRAINT "PatientProfile_userId_fkey";

-- DropForeignKey
ALTER TABLE "Prescription" DROP CONSTRAINT "Prescription_userId_fkey";

-- DropForeignKey
ALTER TABLE "RefillLog" DROP CONSTRAINT "RefillLog_medicineId_fkey";

-- DropForeignKey
ALTER TABLE "RefillLog" DROP CONSTRAINT "RefillLog_userId_fkey";

-- DropTable
DROP TABLE "AuditLog";

-- DropTable
DROP TABLE "Bill";

-- DropTable
DROP TABLE "DoseLog";

-- DropTable
DROP TABLE "ExtractedMedicine";

-- DropTable
DROP TABLE "Medicine";

-- DropTable
DROP TABLE "MedicineSchedule";

-- DropTable
DROP TABLE "PatientProfile";

-- DropTable
DROP TABLE "Prescription";

-- DropTable
DROP TABLE "RefillLog";

-- DropTable
DROP TABLE "User";

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT,
    "passwordHash" TEXT NOT NULL,
    "role" "UserRole" NOT NULL DEFAULT 'PATIENT',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isVerified" BOOLEAN NOT NULL DEFAULT false,
    "lastLoginAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "patient_profiles" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "dateOfBirth" TIMESTAMP(3),
    "gender" TEXT,
    "bloodGroup" TEXT,
    "height" DOUBLE PRECISION,
    "weight" DOUBLE PRECISION,
    "allergies" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "conditions" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "emergencyContact" TEXT,
    "emergencyPhone" TEXT,
    "notes" TEXT,
    "avatarUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "patient_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "medicines" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "genericName" TEXT,
    "brandName" TEXT,
    "form" "MedicineForm" NOT NULL DEFAULT 'TABLET',
    "strength" TEXT,
    "color" TEXT,
    "shape" TEXT,
    "instructions" TEXT,
    "sideEffects" TEXT,
    "totalQuantity" INTEGER,
    "remainingQuantity" INTEGER,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "medicines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "medicine_schedules" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "medicineId" TEXT NOT NULL,
    "frequency" "ScheduleFrequency" NOT NULL DEFAULT 'DAILY',
    "timesOfDay" TEXT[],
    "daysOfWeek" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3),
    "dosesPerIntake" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "unit" TEXT NOT NULL DEFAULT 'tablet',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "gracePeriodMinutes" INTEGER NOT NULL DEFAULT 60,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "medicine_schedules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dose_logs" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "medicineId" TEXT NOT NULL,
    "scheduleId" TEXT NOT NULL,
    "scheduledAt" TIMESTAMP(3) NOT NULL,
    "actionAt" TIMESTAMP(3),
    "status" "DoseStatus" NOT NULL DEFAULT 'PENDING',
    "snoozeUntil" TIMESTAMP(3),
    "snoozeCount" INTEGER NOT NULL DEFAULT 0,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "dose_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_logs" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "channel" "NotificationChannel" NOT NULL DEFAULT 'LOCAL',
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "isRead" BOOLEAN NOT NULL DEFAULT false,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notification_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "action" "AuditAction" NOT NULL,
    "entityType" TEXT,
    "entityId" TEXT,
    "oldValues" JSONB,
    "newValues" JSONB,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "prescriptions" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "storedName" TEXT NOT NULL,
    "localPath" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "fileSize" INTEGER NOT NULL,
    "rawOcrText" TEXT,
    "status" "DocumentStatus" NOT NULL DEFAULT 'UPLOADED',
    "notes" TEXT,
    "doctorName" TEXT,
    "prescribedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "prescriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bills" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "storedName" TEXT NOT NULL,
    "localPath" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "fileSize" INTEGER NOT NULL,
    "rawOcrText" TEXT,
    "pharmacyName" TEXT,
    "purchaseDate" TIMESTAMP(3),
    "totalAmount" DOUBLE PRECISION,
    "status" "DocumentStatus" NOT NULL DEFAULT 'UPLOADED',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bills_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "extracted_medicines" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "prescriptionId" TEXT,
    "billId" TEXT,
    "medicineName" TEXT NOT NULL,
    "dosage" TEXT,
    "frequency" TEXT,
    "timesOfDay" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "durationDays" INTEGER,
    "quantity" INTEGER,
    "instructions" TEXT,
    "confidenceScore" DOUBLE PRECISION,
    "isConfirmed" BOOLEAN NOT NULL DEFAULT false,
    "confirmedAt" TIMESTAMP(3),
    "createdMedicineId" TEXT,
    "createdScheduleId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "extracted_medicines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refill_logs" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "medicineId" TEXT NOT NULL,
    "totalQuantity" INTEGER NOT NULL,
    "dailyUsage" DOUBLE PRECISION NOT NULL,
    "remainingQuantity" INTEGER NOT NULL,
    "expectedFinishDate" TIMESTAMP(3) NOT NULL,
    "refillReminderDate" TIMESTAMP(3) NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "refill_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "adherence_snapshots" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "snapshotDate" TIMESTAMP(3) NOT NULL,
    "totalScheduled" INTEGER NOT NULL DEFAULT 0,
    "totalTaken" INTEGER NOT NULL DEFAULT 0,
    "totalMissed" INTEGER NOT NULL DEFAULT 0,
    "totalSnoozed" INTEGER NOT NULL DEFAULT 0,
    "totalSkipped" INTEGER NOT NULL DEFAULT 0,
    "adherencePercent" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "currentStreak" INTEGER NOT NULL DEFAULT 0,
    "riskLevel" "RiskLevel" NOT NULL DEFAULT 'LOW',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "adherence_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "users_phone_key" ON "users"("phone");

-- CreateIndex
CREATE INDEX "users_email_idx" ON "users"("email");

-- CreateIndex
CREATE INDEX "users_role_idx" ON "users"("role");

-- CreateIndex
CREATE UNIQUE INDEX "patient_profiles_userId_key" ON "patient_profiles"("userId");

-- CreateIndex
CREATE INDEX "patient_profiles_userId_idx" ON "patient_profiles"("userId");

-- CreateIndex
CREATE INDEX "medicines_userId_idx" ON "medicines"("userId");

-- CreateIndex
CREATE INDEX "medicines_userId_isActive_idx" ON "medicines"("userId", "isActive");

-- CreateIndex
CREATE INDEX "medicine_schedules_userId_idx" ON "medicine_schedules"("userId");

-- CreateIndex
CREATE INDEX "medicine_schedules_medicineId_idx" ON "medicine_schedules"("medicineId");

-- CreateIndex
CREATE INDEX "medicine_schedules_userId_isActive_idx" ON "medicine_schedules"("userId", "isActive");

-- CreateIndex
CREATE INDEX "dose_logs_userId_idx" ON "dose_logs"("userId");

-- CreateIndex
CREATE INDEX "dose_logs_userId_status_idx" ON "dose_logs"("userId", "status");

-- CreateIndex
CREATE INDEX "dose_logs_userId_scheduledAt_idx" ON "dose_logs"("userId", "scheduledAt");

-- CreateIndex
CREATE INDEX "dose_logs_userId_status_scheduledAt_idx" ON "dose_logs"("userId", "status", "scheduledAt");

-- CreateIndex
CREATE INDEX "dose_logs_scheduleId_idx" ON "dose_logs"("scheduleId");

-- CreateIndex
CREATE INDEX "dose_logs_status_snoozeUntil_idx" ON "dose_logs"("status", "snoozeUntil");

-- CreateIndex
CREATE INDEX "notification_logs_userId_idx" ON "notification_logs"("userId");

-- CreateIndex
CREATE INDEX "notification_logs_userId_isRead_idx" ON "notification_logs"("userId", "isRead");

-- CreateIndex
CREATE INDEX "audit_logs_userId_idx" ON "audit_logs"("userId");

-- CreateIndex
CREATE INDEX "audit_logs_userId_action_idx" ON "audit_logs"("userId", "action");

-- CreateIndex
CREATE INDEX "audit_logs_entityType_entityId_idx" ON "audit_logs"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "prescriptions_userId_idx" ON "prescriptions"("userId");

-- CreateIndex
CREATE INDEX "prescriptions_userId_status_idx" ON "prescriptions"("userId", "status");

-- CreateIndex
CREATE INDEX "bills_userId_idx" ON "bills"("userId");

-- CreateIndex
CREATE INDEX "bills_userId_status_idx" ON "bills"("userId", "status");

-- CreateIndex
CREATE INDEX "extracted_medicines_userId_idx" ON "extracted_medicines"("userId");

-- CreateIndex
CREATE INDEX "extracted_medicines_prescriptionId_idx" ON "extracted_medicines"("prescriptionId");

-- CreateIndex
CREATE INDEX "extracted_medicines_billId_idx" ON "extracted_medicines"("billId");

-- CreateIndex
CREATE INDEX "extracted_medicines_userId_isConfirmed_idx" ON "extracted_medicines"("userId", "isConfirmed");

-- CreateIndex
CREATE INDEX "refill_logs_userId_idx" ON "refill_logs"("userId");

-- CreateIndex
CREATE INDEX "refill_logs_medicineId_idx" ON "refill_logs"("medicineId");

-- CreateIndex
CREATE INDEX "refill_logs_userId_refillReminderDate_idx" ON "refill_logs"("userId", "refillReminderDate");

-- CreateIndex
CREATE INDEX "adherence_snapshots_userId_idx" ON "adherence_snapshots"("userId");

-- CreateIndex
CREATE INDEX "adherence_snapshots_userId_snapshotDate_idx" ON "adherence_snapshots"("userId", "snapshotDate");

-- CreateIndex
CREATE INDEX "adherence_snapshots_userId_riskLevel_idx" ON "adherence_snapshots"("userId", "riskLevel");

-- CreateIndex
CREATE UNIQUE INDEX "adherence_snapshots_userId_snapshotDate_key" ON "adherence_snapshots"("userId", "snapshotDate");

-- AddForeignKey
ALTER TABLE "patient_profiles" ADD CONSTRAINT "patient_profiles_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "medicines" ADD CONSTRAINT "medicines_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "medicine_schedules" ADD CONSTRAINT "medicine_schedules_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "medicine_schedules" ADD CONSTRAINT "medicine_schedules_medicineId_fkey" FOREIGN KEY ("medicineId") REFERENCES "medicines"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dose_logs" ADD CONSTRAINT "dose_logs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dose_logs" ADD CONSTRAINT "dose_logs_medicineId_fkey" FOREIGN KEY ("medicineId") REFERENCES "medicines"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dose_logs" ADD CONSTRAINT "dose_logs_scheduleId_fkey" FOREIGN KEY ("scheduleId") REFERENCES "medicine_schedules"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_logs" ADD CONSTRAINT "notification_logs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prescriptions" ADD CONSTRAINT "prescriptions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bills" ADD CONSTRAINT "bills_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "extracted_medicines" ADD CONSTRAINT "extracted_medicines_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "extracted_medicines" ADD CONSTRAINT "extracted_medicines_prescriptionId_fkey" FOREIGN KEY ("prescriptionId") REFERENCES "prescriptions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "extracted_medicines" ADD CONSTRAINT "extracted_medicines_billId_fkey" FOREIGN KEY ("billId") REFERENCES "bills"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refill_logs" ADD CONSTRAINT "refill_logs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refill_logs" ADD CONSTRAINT "refill_logs_medicineId_fkey" FOREIGN KEY ("medicineId") REFERENCES "medicines"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "adherence_snapshots" ADD CONSTRAINT "adherence_snapshots_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
