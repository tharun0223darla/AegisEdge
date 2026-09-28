-- CreateEnum
CREATE TYPE "VisionJobStatus" AS ENUM ('QUEUED', 'PROCESSING', 'COMPLETED', 'FAILED', 'CANCELLED');

-- CreateTable
CREATE TABLE "prescription_vision_jobs" (
    "id" TEXT NOT NULL,
    "prescriptionId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" "VisionJobStatus" NOT NULL DEFAULT 'QUEUED',
    "progress" INTEGER NOT NULL DEFAULT 0,
    "stage" TEXT,
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "workerId" TEXT,
    "resultPath" TEXT,
    "resultJson" JSONB,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "startedAt" TIMESTAMP(3),
    "heartbeatAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "prescription_vision_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "prescription_vision_jobs_userId_status_idx" ON "prescription_vision_jobs"("userId", "status");

-- CreateIndex
CREATE INDEX "prescription_vision_jobs_prescriptionId_status_idx" ON "prescription_vision_jobs"("prescriptionId", "status");

-- CreateIndex
CREATE INDEX "prescription_vision_jobs_status_createdAt_idx" ON "prescription_vision_jobs"("status", "createdAt");

-- AddForeignKey
ALTER TABLE "prescription_vision_jobs" ADD CONSTRAINT "prescription_vision_jobs_prescriptionId_fkey" FOREIGN KEY ("prescriptionId") REFERENCES "prescriptions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prescription_vision_jobs" ADD CONSTRAINT "prescription_vision_jobs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
