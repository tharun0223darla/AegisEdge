import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { PrismaModule } from '../../prisma/prisma.module';
import { CleanupService } from './cleanup.service';

/**
 * Aggregates all platform-wide cron jobs (cleanup, retention).
 * Domain-specific schedulers (e.g. NotificationScheduler) live in their
 * own module — this one only owns infrastructure / housekeeping tasks.
 */
@Module({
  imports: [ScheduleModule.forRoot(), PrismaModule],
  providers: [CleanupService],
  exports: [CleanupService],
})
export class JobsModule {}
