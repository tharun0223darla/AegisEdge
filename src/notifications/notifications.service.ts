import { Injectable, Logger } from '@nestjs/common';
import {
  AuditAction,
  NotificationChannel,
  NotificationLog,
  Prisma,
} from '@prisma/client';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { PrismaService } from '../prisma/prisma.service';
import { UpdateNotificationPreferencesDto } from './dto/update-notification-preferences.dto';
import {
  EmailNotificationService,
  type NotificationCategory,
} from './email-notification.service';
import {
  PhoneNotificationService,
  type PhoneDeliveryResult,
} from './phone-notification.service';

type DeliveryMetadata = Prisma.InputJsonObject;

export interface SendNotificationParams {
  userId: string;
  title: string;
  body: string;
  channel?: NotificationChannel;
  metadata?: Prisma.InputJsonObject;
  dedupeKey?: string;
}

export interface NotificationResult {
  id: string;
  userId: string;
  title: string;
  body: string;
  channel: NotificationChannel;
  sentAt: Date;
}

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly phoneNotifications: PhoneNotificationService,
    private readonly emailNotifications: EmailNotificationService,
    private readonly auditLogs: AuditLogsService,
  ) {}

  async send(params: SendNotificationParams): Promise<NotificationResult> {
    const channel = params.channel ?? NotificationChannel.LOCAL;
    const baseMetadata = params.metadata ?? {};
    const dedupeKey = params.dedupeKey
      ? `${channel}:${params.dedupeKey}`
      : null;

    let log: NotificationLog;
    try {
      log = await this.prisma.notificationLog.create({
        data: {
          userId: params.userId,
          title: params.title,
          body: params.body,
          channel,
          metadata: baseMetadata,
          dedupeKey,
        },
      });
    } catch (error) {
      if (
        dedupeKey &&
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        const existing = await this.prisma.notificationLog.findUnique({
          where: { dedupeKey },
        });
        if (existing) {
          return {
            id: existing.id,
            userId: existing.userId,
            title: existing.title,
            body: existing.body,
            channel: existing.channel,
            sentAt: existing.sentAt,
          };
        }
      }
      throw error;
    }

    const delivery =
      channel === NotificationChannel.EMAIL
        ? await this.emailNotifications.enqueueAndDeliver(log.id)
        : await this.sendViaChannel(channel, {
            userId: params.userId,
            title: params.title,
            body: params.body,
            metadata: baseMetadata,
          });

    if (delivery) {
      await this.prisma.notificationLog.update({
        where: { id: log.id },
        data: {
          metadata: {
            ...baseMetadata,
            delivery,
          },
        },
      });
    }

    this.logger.log(
      `[${channel}] Notification sent -> userId: ${params.userId} | "${params.title}"`,
    );

    return {
      id: log.id,
      userId: log.userId,
      title: log.title,
      body: log.body,
      channel: log.channel,
      sentAt: log.sentAt,
    };
  }

  async sendDoseReminder(params: {
    userId: string;
    medicineName: string;
    doseTime: string;
    scheduleId: string;
    doseLogId: string;
    dosesPerIntake: number;
    unit: string;
  }): Promise<void> {
    const doseText =
      params.dosesPerIntake !== 1
        ? `${params.dosesPerIntake} ${params.unit}s`
        : `1 ${params.unit}`;

    const metadata = {
      type: 'DOSE_REMINDER',
      scheduleId: params.scheduleId,
      doseLogId: params.doseLogId,
      doseTime: params.doseTime,
      medicineName: params.medicineName,
    };

    const title = 'Time to take your medicine';
    const body = `${params.medicineName} - ${doseText} scheduled for ${params.doseTime}`;

    await this.send({
      userId: params.userId,
      title,
      body,
      channel: NotificationChannel.LOCAL,
      metadata,
      dedupeKey: `dose:${params.doseLogId}`,
    });

    await this.sendPhoneIfEnabled({
      userId: params.userId,
      title,
      body,
      metadata,
      dedupeKey: `dose:${params.doseLogId}`,
    });
  }

  async sendSnoozedDoseReminder(params: {
    userId: string;
    medicineName: string;
    scheduleId: string;
    doseLogId: string;
    snoozeRetriggerKey: string;
  }): Promise<void> {
    const title = 'Snoozed reminder - time to take your medicine';
    const body = `${params.medicineName} was snoozed and is now due. Please take it now.`;
    const metadata = {
      type: 'SNOOZE_RETRIGGERED',
      doseLogId: params.doseLogId,
      scheduleId: params.scheduleId,
      medicineName: params.medicineName,
      snoozeRetriggerKey: params.snoozeRetriggerKey,
    };

    await this.send({
      userId: params.userId,
      title,
      body,
      channel: NotificationChannel.LOCAL,
      metadata,
      dedupeKey: params.snoozeRetriggerKey,
    });

    await this.sendPhoneIfEnabled({
      userId: params.userId,
      title,
      body,
      metadata,
      dedupeKey: params.snoozeRetriggerKey,
    });
  }

  async sendMissedDoseAlert(params: {
    userId: string;
    medicineName: string;
    scheduledAt: Date;
    dedupeKey: string;
  }): Promise<void> {
    const timeStr = params.scheduledAt.toLocaleTimeString('en-IN', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
    });

    const title = 'Missed dose recorded';
    const body =
      `You missed ${params.medicineName} at ${timeStr}. ` +
      'Please consult your doctor if you consistently miss doses.';
    const metadata = {
      type: 'MISSED_DOSE_ALERT',
      medicineName: params.medicineName,
      scheduledAt: params.scheduledAt.toISOString(),
    };

    await this.send({
      userId: params.userId,
      title,
      body,
      channel: NotificationChannel.LOCAL,
      metadata,
      dedupeKey: params.dedupeKey,
    });

    await this.sendOptionalEmail(
      {
        userId: params.userId,
        title,
        body,
        metadata,
        dedupeKey: params.dedupeKey,
      },
      'MISSED_DOSE_ALERT',
    );

    await this.sendPhoneIfEnabled({
      userId: params.userId,
      title,
      body,
      metadata,
      dedupeKey: params.dedupeKey,
    });
  }

  async sendLowStockAlert(params: {
    userId: string;
    medicineId: string;
    medicineName: string;
    remainingQuantity: number;
    alertLevel: string;
  }): Promise<void> {
    const title = 'Low medicine stock';
    const body =
      `Only ${params.remainingQuantity} dose(s) of ${params.medicineName} remaining. ` +
      'Please arrange a refill.';
    const metadata = {
      type: 'LOW_STOCK_ALERT',
      medicineId: params.medicineId,
      medicineName: params.medicineName,
      remainingQuantity: params.remainingQuantity,
      alertLevel: params.alertLevel,
      actionUrl: '/refills',
    };

    await this.send({
      userId: params.userId,
      title,
      body,
      channel: NotificationChannel.LOCAL,
      metadata,
      dedupeKey: `stock:${params.medicineId}:${params.alertLevel}`,
    });

    await this.sendPhoneIfEnabled({
      userId: params.userId,
      title,
      body,
      metadata,
      dedupeKey: `stock:${params.medicineId}:${params.alertLevel}`,
    });

    await this.sendOptionalEmail(
      {
        userId: params.userId,
        title,
        body,
        metadata,
        dedupeKey: `stock:${params.medicineId}:${params.alertLevel}`,
      },
      'LOW_STOCK_ALERT',
    );
  }

  async sendPhoneTest(userId: string) {
    const result = await this.send({
      userId,
      title: 'MediTrack phone notification test',
      body: 'Phone notifications are connected for this registered number.',
      channel: NotificationChannel.SMS,
      metadata: { type: 'PHONE_TEST' },
    });

    const log = await this.prisma.notificationLog.findUnique({
      where: { id: result.id },
      select: { id: true, channel: true, metadata: true, sentAt: true },
    });

    return {
      notificationId: result.id,
      channel: result.channel,
      sentAt: result.sentAt,
      delivery:
        (log?.metadata as { delivery?: PhoneDeliveryResult } | null)
          ?.delivery ?? null,
    };
  }

  async sendEmailTest(userId: string) {
    const eligible = await this.emailNotifications.isEligible(
      userId,
      'EMAIL_TEST',
    );
    if (!eligible) {
      return {
        notificationId: null,
        channel: NotificationChannel.EMAIL,
        delivery: {
          provider: 'brevo',
          status: 'SKIPPED',
          reason:
            'Enable email notifications and verify your email before testing.',
        },
      };
    }
    const result = await this.send({
      userId,
      title: 'MediTrack email notification test',
      body: 'Email notifications are connected for this verified account.',
      channel: NotificationChannel.EMAIL,
      metadata: { type: 'EMAIL_TEST', actionUrl: '/settings' },
    });
    const delivery = await this.prisma.notificationDelivery.findUnique({
      where: { notificationLogId: result.id },
      select: {
        provider: true,
        status: true,
        recipientMasked: true,
        providerMessageId: true,
        lastErrorCode: true,
      },
    });
    return {
      notificationId: result.id,
      channel: result.channel,
      sentAt: result.sentAt,
      delivery,
    };
  }

  async getPreferences(userId: string) {
    return this.prisma.notificationPreference.upsert({
      where: { userId },
      create: { userId },
      update: {},
      select: {
        emailEnabled: true,
        missedDoseEmails: true,
        refillEmails: true,
        includeMedicineNames: true,
        updatedAt: true,
      },
    });
  }

  async updatePreferences(
    userId: string,
    dto: UpdateNotificationPreferencesDto,
  ) {
    const before = await this.getPreferences(userId);
    const updated = await this.prisma.notificationPreference.update({
      where: { userId },
      data: dto,
      select: {
        emailEnabled: true,
        missedDoseEmails: true,
        refillEmails: true,
        includeMedicineNames: true,
        updatedAt: true,
      },
    });
    await this.auditLogs.log({
      userId,
      action: AuditAction.UPDATED,
      entityType: 'NotificationPreference',
      entityId: userId,
      oldValues: before,
      newValues: updated,
    });
    return updated;
  }

  async sendOptionalEmail(
    params: SendNotificationParams,
    category: NotificationCategory,
  ) {
    try {
      if (
        !(await this.emailNotifications.isEligible(params.userId, category))
      ) {
        return null;
      }
      return await this.send({
        ...params,
        channel: NotificationChannel.EMAIL,
      });
    } catch (error) {
      this.logger.warn(
        `Optional email could not be queued for user ${params.userId} (${error instanceof Error ? error.name : 'UnknownError'})`,
      );
      return null;
    }
  }

  async markAsRead(notificationId: string, userId: string): Promise<void> {
    await this.prisma.notificationLog.updateMany({
      where: { id: notificationId, userId },
      data: { isRead: true },
    });
  }

  async markAllAsRead(userId: string): Promise<void> {
    await this.prisma.notificationLog.updateMany({
      where: { userId, isRead: false },
      data: { isRead: true },
    });
  }

  async findAll(userId: string, page = 1, limit = 20, unreadOnly = false) {
    const skip = (page - 1) * limit;
    const where = { userId, ...(unreadOnly ? { isRead: false } : {}) };

    const [total, notifications] = await Promise.all([
      this.prisma.notificationLog.count({ where }),
      this.prisma.notificationLog.findMany({
        where,
        skip,
        take: Math.min(limit, 50),
        orderBy: { sentAt: 'desc' },
      }),
    ]);

    const unreadCount = await this.prisma.notificationLog.count({
      where: { userId, isRead: false },
    });

    return {
      data: notifications,
      unreadCount,
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }

  async getNotifications(userId: string) {
    return this.prisma.notificationLog.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getUnreadCount(userId: string) {
    const count = await this.prisma.notificationLog.count({
      where: { userId, isRead: false },
    });

    return { unread: count, count };
  }

  private async sendPhoneIfEnabled(
    params: SendNotificationParams,
  ): Promise<void> {
    if (!this.phoneNotifications.isEnabled()) return;
    await this.send({ ...params, channel: NotificationChannel.SMS });
  }

  private async sendViaChannel(
    channel: NotificationChannel,
    payload: {
      userId: string;
      title: string;
      body: string;
      metadata?: Prisma.InputJsonObject;
    },
  ): Promise<DeliveryMetadata | undefined> {
    switch (channel) {
      case NotificationChannel.LOCAL:
        this.logger.debug(`[LOCAL] queued: "${payload.title}"`);
        return { provider: 'local', status: 'QUEUED' };
      case NotificationChannel.SMS:
        return this.toDeliveryMetadata(
          await this.phoneNotifications.sendToUser(payload),
        );
      case NotificationChannel.PUSH:
        this.logger.warn('[PUSH] FCM not configured yet');
        return {
          provider: 'push',
          status: 'SKIPPED',
          reason: 'FCM is not configured',
        };
      case NotificationChannel.EMAIL:
        return undefined;
      default:
        this.logger.warn('Unknown notification channel');
        return { provider: 'unknown', status: 'SKIPPED' };
    }
  }

  private toDeliveryMetadata(
    result: PhoneDeliveryResult,
  ): Prisma.InputJsonObject {
    return {
      provider: result.provider,
      status: result.status,
      ...(result.recipientMasked
        ? { recipientMasked: result.recipientMasked }
        : {}),
      ...(result.providerMessageId
        ? { providerMessageId: result.providerMessageId }
        : {}),
      ...(result.reason ? { reason: result.reason } : {}),
      ...(result.error ? { error: result.error } : {}),
    };
  }
}
