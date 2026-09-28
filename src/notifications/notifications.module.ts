import { DashboardModule } from '../dashboard/dashboard.module';
import { Module } from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { NotificationSchedulerService } from './notification-scheduler.service';
import { NotificationsController } from './notifications.controller';
import { PhoneNotificationService } from './phone-notification.service';
import { SchedulesModule } from '../schedules/schedules.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { EmailNotificationService } from './email-notification.service';

@Module({
  imports: [AuditLogsModule, DashboardModule, SchedulesModule],
  controllers: [NotificationsController],
  providers: [
    NotificationsService,
    NotificationSchedulerService,
    PhoneNotificationService,
    EmailNotificationService,
  ],
  exports: [NotificationsService, EmailNotificationService],
})
export class NotificationsModule {}
