-- CreateEnum
CREATE TYPE "MetricType" AS ENUM ('BLOOD_PRESSURE', 'BLOOD_GLUCOSE', 'HEART_RATE', 'SLEEP_HOURS');

-- CreateEnum
CREATE TYPE "MetricSource" AS ENUM ('MANUAL', 'BLUETOOTH_SIMULATED', 'BLUETOOTH_REAL', 'SMARTWATCH');

-- CreateEnum
CREATE TYPE "DeviceType" AS ENUM ('BP_METER', 'GLUCOSE_METER', 'SMARTWATCH', 'SMART_CAP');

-- CreateTable
CREATE TABLE "health_metrics" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "metricType" "MetricType" NOT NULL,
    "value" JSONB NOT NULL,
    "recordedAt" TIMESTAMP(3) NOT NULL,
    "source" "MetricSource" NOT NULL DEFAULT 'MANUAL',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "health_metrics_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_voice_logs" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "sessionDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "transcript" JSONB NOT NULL,
    "summary" TEXT,
    "extractedVitals" JSONB,
    "sentimentScore" DOUBLE PRECISION,
    "recoveryProgress" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_voice_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "device_registries" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "deviceName" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "deviceType" "DeviceType" NOT NULL,
    "isPaired" BOOLEAN NOT NULL DEFAULT true,
    "lastSyncedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "device_registries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "health_metrics_userId_idx" ON "health_metrics"("userId");

-- CreateIndex
CREATE INDEX "health_metrics_userId_metricType_recordedAt_idx" ON "health_metrics"("userId", "metricType", "recordedAt");

-- CreateIndex
CREATE INDEX "ai_voice_logs_userId_idx" ON "ai_voice_logs"("userId");

-- CreateIndex
CREATE INDEX "device_registries_userId_idx" ON "device_registries"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "device_registries_userId_deviceId_key" ON "device_registries"("userId", "deviceId");

-- AddForeignKey
ALTER TABLE "health_metrics" ADD CONSTRAINT "health_metrics_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_voice_logs" ADD CONSTRAINT "ai_voice_logs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "device_registries" ADD CONSTRAINT "device_registries_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
