import { Module } from '@nestjs/common';
import { DoseLogsService } from './dose-logs.service';
import { DoseLogsController } from './dose-logs.controller';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';

@Module({
  imports: [AuditLogsModule],
  controllers: [DoseLogsController],
  providers: [DoseLogsService],
  exports: [DoseLogsService], // exported so DashboardService and NotificationScheduler can use it
})
export class DoseLogsModule {}
