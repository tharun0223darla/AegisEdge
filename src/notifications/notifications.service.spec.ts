import { NotificationChannel, type NotificationLog } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  PhoneNotificationService,
  type PhoneDeliveryResult,
  type PhoneNotificationPayload,
} from './phone-notification.service';
import { NotificationsService } from './notifications.service';
import { EmailNotificationService } from './email-notification.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';

interface NotificationCreateCall {
  data: {
    userId: string;
    title: string;
    body: string;
    channel: NotificationChannel;
    dedupeKey: string | null;
  };
}

describe('NotificationsService phone fan-out', () => {
  const notificationLog = {
    create: jest.fn<Promise<NotificationLog>, [NotificationCreateCall]>(),
    update: jest.fn(),
    findUnique: jest.fn(),
    updateMany: jest.fn(),
    findMany: jest.fn(),
    count: jest.fn(),
  };
  const prisma = { notificationLog } as unknown as PrismaService;
  const phoneNotifications = {
    isEnabled: jest.fn<boolean, []>(),
    sendToUser: jest.fn<
      Promise<PhoneDeliveryResult>,
      [PhoneNotificationPayload]
    >(),
  };
  const phoneService =
    phoneNotifications as unknown as PhoneNotificationService;
  const emailNotifications = {
    isEligible: jest.fn().mockResolvedValue(false),
    enqueueAndDeliver: jest.fn(),
  } as unknown as EmailNotificationService;
  const auditLogs = {
    log: jest.fn().mockResolvedValue(undefined),
  } as unknown as AuditLogsService;

  beforeEach(() => {
    jest.clearAllMocks();
    let id = 0;
    notificationLog.create.mockImplementation(({ data }) => {
      const now = new Date('2026-07-09T08:00:00.000Z');
      return Promise.resolve({
        id: `log-${++id}`,
        userId: data.userId,
        title: data.title,
        body: data.body,
        channel: data.channel,
        dedupeKey: data.dedupeKey,
        sentAt: now,
        createdAt: now,
        isRead: false,
        metadata: null,
      });
    });
    notificationLog.update.mockResolvedValue({});
    phoneNotifications.sendToUser.mockResolvedValue({
      provider: 'console',
      status: 'SENT',
      recipientMasked: '+91***210',
    });
  });

  it('sends dose reminders locally and by SMS when phone notifications are enabled', async () => {
    phoneNotifications.isEnabled.mockReturnValue(true);
    const service = new NotificationsService(
      prisma,
      phoneService,
      emailNotifications,
      auditLogs,
    );

    await service.sendDoseReminder({
      userId: 'user-1',
      medicineName: 'Dolo 650',
      doseTime: '08:00 AM',
      scheduleId: 'schedule-1',
      doseLogId: 'dose-1',
      dosesPerIntake: 1,
      unit: 'tablet',
    });

    expect(notificationLog.create).toHaveBeenCalledTimes(2);
    expect(notificationLog.create.mock.calls[0][0].data).toMatchObject({
      channel: NotificationChannel.LOCAL,
      dedupeKey: 'LOCAL:dose:dose-1',
    });
    expect(notificationLog.create.mock.calls[1][0].data).toMatchObject({
      channel: NotificationChannel.SMS,
      dedupeKey: 'SMS:dose:dose-1',
    });
    expect(phoneNotifications.sendToUser).toHaveBeenCalledTimes(1);
    expect(phoneNotifications.sendToUser.mock.calls[0][0].metadata?.type).toBe(
      'DOSE_REMINDER',
    );
  });

  it('keeps dose reminders local-only when phone notifications are disabled', async () => {
    phoneNotifications.isEnabled.mockReturnValue(false);
    const service = new NotificationsService(
      prisma,
      phoneService,
      emailNotifications,
      auditLogs,
    );

    await service.sendDoseReminder({
      userId: 'user-1',
      medicineName: 'Dolo 650',
      doseTime: '08:00 AM',
      scheduleId: 'schedule-1',
      doseLogId: 'dose-1',
      dosesPerIntake: 1,
      unit: 'tablet',
    });

    expect(notificationLog.create).toHaveBeenCalledTimes(1);
    expect(notificationLog.create.mock.calls[0][0].data.channel).toBe(
      NotificationChannel.LOCAL,
    );
    expect(phoneNotifications.sendToUser).not.toHaveBeenCalled();
  });
});
