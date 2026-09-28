import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';

import { PrismaModule } from './prisma/prisma.module';
import { HealthModule } from './health/health.module';

import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { PatientsModule } from './patients/patients.module';
import { MedicinesModule } from './medicines/medicines.module';
import { SchedulesModule } from './schedules/schedules.module';
import { DoseLogsModule } from './dose-logs/dose-logs.module';
import { OcrModule } from './ocr/ocr.module';
import { PrescriptionsModule } from './prescriptions/prescriptions.module';
import { BillsModule } from './bills/bills.module';
import { RefillsModule } from './refills/refills.module';
import { RemindersModule } from './remainders/remainder.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { NotificationsModule } from './notifications/notifications.module';
import { AiModule } from './ai/ai.module';
import { HealthMetricsModule } from './health-metrics/health-metrics.module';
import { AiVoiceModule } from './ai-voice/ai-voice.module';
import { DevicesModule } from './devices/devices.module';
import { CareModule } from './care/care.module';
import { MedicationSafetyModule } from './medication-safety/medication-safety.module';
import { DoctorReportsModule } from './doctor-reports/doctor-reports.module';
import { EmergencyModule } from './emergency/emergency.module';
import { VaccinationsModule } from './vaccinations/vaccinations.module';

import { AppLoggerModule } from './common/logger/logger.module';
import { JobsModule } from './common/jobs/jobs.module';
import { throttlerConfig } from './common/config/throttler.config';
import { validateEnv } from './common/config/env.validation';
import { ThrottlerBehindProxyGuard } from './common/guards/throttler-behind-proxy.guard';

@Module({
  imports: [
    // ── Infrastructure ────────────────────────────────────────
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      validate: validateEnv,
    }),
    AppLoggerModule,
    ThrottlerModule.forRoot(throttlerConfig),
    JobsModule,
    AiModule,

    // ── Core ──────────────────────────────────────────────────
    PrismaModule,
    HealthModule,

    // ── Domain ────────────────────────────────────────────────
    AuthModule,
    UsersModule,
    PatientsModule,
    MedicinesModule,
    SchedulesModule,
    DoseLogsModule,
    OcrModule,
    PrescriptionsModule,
    BillsModule,
    RefillsModule,
    RemindersModule,
    DashboardModule,
    NotificationsModule,
    HealthMetricsModule,
    AiVoiceModule,
    DevicesModule,
    CareModule,
    MedicationSafetyModule,
    DoctorReportsModule,
    EmergencyModule,
    VaccinationsModule,
  ],
  providers: [
    // Global rate-limiter (proxy-aware). Per-route overrides via @Throttle().
    {
      provide: APP_GUARD,
      useClass: ThrottlerBehindProxyGuard,
    },
  ],
})
export class AppModule {}
