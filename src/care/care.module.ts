import { Module } from '@nestjs/common';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { CareController } from './care.controller';
import { CareEscalationService } from './care-escalation.service';
import { CareService } from './care.service';

@Module({
  imports: [AuditLogsModule, NotificationsModule],
  controllers: [CareController],
  providers: [CareService, CareEscalationService],
  exports: [CareService, CareEscalationService],
})
export class CareModule {}
