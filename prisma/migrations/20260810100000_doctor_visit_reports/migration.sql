-- CreateEnum
CREATE TYPE "DoctorReportSection" AS ENUM ('MEDICATIONS', 'ADHERENCE', 'ALLERGIES', 'SAFETY', 'REFILLS', 'VITALS');

-- CreateEnum
CREATE TYPE "DoctorReportAccessAction" AS ENUM ('VIEWED', 'DOWNLOADED');

-- AlterEnum
ALTER TYPE "AuditAction" ADD VALUE 'DOCTOR_REPORT_CREATED';
ALTER TYPE "AuditAction" ADD VALUE 'DOCTOR_REPORT_SHARE_CREATED';
ALTER TYPE "AuditAction" ADD VALUE 'DOCTOR_REPORT_SHARE_REVOKED';

-- CreateTable
CREATE TABLE "doctor_visit_reports" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "rangeStart" TIMESTAMP(3) NOT NULL,
    "rangeEnd" TIMESTAMP(3) NOT NULL,
    "sections" "DoctorReportSection"[],
    "snapshot" JSONB NOT NULL,
    "snapshotVersion" INTEGER NOT NULL DEFAULT 1,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "doctor_visit_reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "doctor_report_shares" (
    "id" TEXT NOT NULL,
    "reportId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "lastAccessedAt" TIMESTAMP(3),
    "accessCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "doctor_report_shares_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "doctor_report_share_accesses" (
    "id" TEXT NOT NULL,
    "shareId" TEXT NOT NULL,
    "action" "DoctorReportAccessAction" NOT NULL,
    "accessedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "doctor_report_share_accesses_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "doctor_visit_reports_userId_createdAt_idx" ON "doctor_visit_reports"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "doctor_visit_reports_userId_archivedAt_idx" ON "doctor_visit_reports"("userId", "archivedAt");

-- CreateIndex
CREATE UNIQUE INDEX "doctor_report_shares_tokenHash_key" ON "doctor_report_shares"("tokenHash");

-- CreateIndex
CREATE INDEX "doctor_report_shares_reportId_createdAt_idx" ON "doctor_report_shares"("reportId", "createdAt");

-- CreateIndex
CREATE INDEX "doctor_report_shares_expiresAt_revokedAt_idx" ON "doctor_report_shares"("expiresAt", "revokedAt");

-- CreateIndex
CREATE INDEX "doctor_report_share_accesses_shareId_accessedAt_idx" ON "doctor_report_share_accesses"("shareId", "accessedAt");

-- AddForeignKey
ALTER TABLE "doctor_visit_reports" ADD CONSTRAINT "doctor_visit_reports_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "doctor_report_shares" ADD CONSTRAINT "doctor_report_shares_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "doctor_visit_reports"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "doctor_report_share_accesses" ADD CONSTRAINT "doctor_report_share_accesses_shareId_fkey" FOREIGN KEY ("shareId") REFERENCES "doctor_report_shares"("id") ON DELETE CASCADE ON UPDATE CASCADE;
