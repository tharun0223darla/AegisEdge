import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import {
  NotificationChannel,
  NotificationDeliveryStatus,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

const BREVO_ENDPOINT = 'https://api.brevo.com/v3/smtp/email';
const DELIVERY_TIMEOUT_MS = 10_000;
const CLAIM_BATCH_SIZE = 50;
const MAX_ATTEMPTS = 5;
const STALE_CLAIM_MINUTES = 10;

export type EmailDeliveryResult = {
  provider: 'brevo';
  status: 'SENT' | 'SKIPPED' | 'FAILED' | 'QUEUED';
  recipientMasked?: string;
  providerMessageId?: string;
  reason?: string;
};

export type DirectEmailInput = {
  recipient: string;
  subject: string;
  body: string;
  actionLabel?: string;
  actionUrl?: string;
  tag: string;
};

export type NotificationCategory =
  | 'CAREGIVER_MISSED_DOSE'
  | 'CAREGIVER_DOSE_HELP_REQUEST'
  | 'MISSED_DOSE_ALERT'
  | 'LOW_STOCK_ALERT'
  | 'EMAIL_TEST'
  | 'PASSWORD_CHANGED'
  | 'GENERAL';

class EmailProviderError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'EmailProviderError';
  }
}

@Injectable()
export class EmailNotificationService {
  private readonly logger = new Logger(EmailNotificationService.name);

  constructor(private readonly prisma: PrismaService) {}

  isEnabled(): boolean {
    return process.env.EMAIL_NOTIFICATIONS_ENABLED === 'true';
  }

  isTransportReady(): boolean {
    return Boolean(
      process.env.BREVO_API_KEY?.trim() &&
      process.env.EMAIL_FROM_ADDRESS?.trim(),
    );
  }

  async isEligible(userId: string, category: NotificationCategory) {
    if (!this.isEnabled() || !this.isTransportReady()) return false;
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        isActive: true,
        isVerified: true,
        notificationPreference: {
          select: {
            emailEnabled: true,
            missedDoseEmails: true,
            refillEmails: true,
          },
        },
      },
    });
    if (!user?.isActive || !user.isVerified) return false;
    if (category === 'PASSWORD_CHANGED') return true;
    const preferences = user.notificationPreference;
    if (!preferences?.emailEnabled) return false;
    if (
      category === 'MISSED_DOSE_ALERT' ||
      category === 'CAREGIVER_MISSED_DOSE' ||
      category === 'CAREGIVER_DOSE_HELP_REQUEST'
    ) {
      return preferences.missedDoseEmails;
    }
    if (category === 'LOW_STOCK_ALERT') return preferences.refillEmails;
    return true;
  }

  async enqueueAndDeliver(
    notificationLogId: string,
  ): Promise<EmailDeliveryResult> {
    if (!this.isEnabled()) {
      return {
        provider: 'brevo',
        status: 'SKIPPED',
        reason: 'Email notifications are disabled',
      };
    }
    await this.ensureDelivery(notificationLogId);
    return this.claimAndDeliver(notificationLogId, new Date());
  }

  async sendDirect(input: DirectEmailInput): Promise<EmailDeliveryResult> {
    if (!this.isTransportReady()) {
      return {
        provider: 'brevo',
        status: 'SKIPPED',
        reason: 'Email transport is not configured',
      };
    }
    try {
      const providerMessageId = await this.sendWithBrevo(input);
      return {
        provider: 'brevo',
        status: 'SENT',
        recipientMasked: this.maskEmail(input.recipient),
        ...(providerMessageId ? { providerMessageId } : {}),
      };
    } catch (error) {
      const code = this.safeErrorCode(error);
      this.logger.warn(
        `Direct email failed for ${this.maskEmail(input.recipient)} (${code})`,
      );
      return {
        provider: 'brevo',
        status: 'FAILED',
        recipientMasked: this.maskEmail(input.recipient),
        reason: code,
      };
    }
  }

  @Cron(CronExpression.EVERY_MINUTE)
  async processPendingEmails(): Promise<number> {
    if (!this.isEnabled() || !this.isTransportReady()) return 0;
    const now = new Date();
    await this.discoverOrphanedEmailLogs();
    const staleBefore = new Date(
      now.getTime() - STALE_CLAIM_MINUTES * 60 * 1000,
    );
    const candidates = await this.prisma.notificationDelivery.findMany({
      where: {
        channel: NotificationChannel.EMAIL,
        attempts: { lt: MAX_ATTEMPTS },
        OR: [
          {
            status: NotificationDeliveryStatus.PENDING,
            OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }],
          },
          {
            status: NotificationDeliveryStatus.FAILED,
            nextAttemptAt: { lte: now },
          },
          {
            status: NotificationDeliveryStatus.PROCESSING,
            claimedAt: { lte: staleBefore },
          },
        ],
      },
      select: { id: true },
      orderBy: { createdAt: 'asc' },
      take: CLAIM_BATCH_SIZE,
    });

    let sent = 0;
    for (const candidate of candidates) {
      const result = await this.claimAndDeliver(candidate.id, now, true);
      if (result.status === 'SENT') sent += 1;
    }
    return sent;
  }

  private async discoverOrphanedEmailLogs() {
    const logs = await this.prisma.notificationLog.findMany({
      where: { channel: NotificationChannel.EMAIL, delivery: null },
      select: { id: true },
      orderBy: { createdAt: 'asc' },
      take: CLAIM_BATCH_SIZE,
    });
    if (!logs.length) return;
    await this.prisma.notificationDelivery.createMany({
      data: logs.map((log) => ({
        notificationLogId: log.id,
        channel: NotificationChannel.EMAIL,
        maxAttempts: MAX_ATTEMPTS,
      })),
      skipDuplicates: true,
    });
  }

  private async ensureDelivery(notificationLogId: string) {
    return this.prisma.notificationDelivery.upsert({
      where: { notificationLogId },
      create: {
        notificationLogId,
        channel: NotificationChannel.EMAIL,
        maxAttempts: MAX_ATTEMPTS,
      },
      update: {},
    });
  }

  private async claimAndDeliver(
    idOrNotificationLogId: string,
    now: Date,
    idIsDelivery = false,
  ): Promise<EmailDeliveryResult> {
    const delivery = await this.prisma.notificationDelivery.findUnique({
      where: idIsDelivery
        ? { id: idOrNotificationLogId }
        : { notificationLogId: idOrNotificationLogId },
      select: { id: true, status: true, attempts: true, maxAttempts: true },
    });
    if (!delivery) {
      return {
        provider: 'brevo',
        status: 'FAILED',
        reason: 'DELIVERY_RECORD_MISSING',
      };
    }
    if (delivery.status === NotificationDeliveryStatus.SENT) {
      return { provider: 'brevo', status: 'SENT' };
    }
    if (delivery.status === NotificationDeliveryStatus.SKIPPED) {
      return { provider: 'brevo', status: 'SKIPPED' };
    }
    if (delivery.attempts >= delivery.maxAttempts) {
      return {
        provider: 'brevo',
        status: 'FAILED',
        reason: 'MAX_ATTEMPTS_REACHED',
      };
    }

    const claimed = await this.prisma.notificationDelivery.updateMany({
      where: {
        id: delivery.id,
        status: delivery.status,
        attempts: delivery.attempts,
      },
      data: {
        status: NotificationDeliveryStatus.PROCESSING,
        claimedAt: now,
        attempts: { increment: 1 },
      },
    });
    if (!claimed.count) {
      return { provider: 'brevo', status: 'QUEUED', reason: 'ALREADY_CLAIMED' };
    }
    return this.deliverOne(delivery.id, now);
  }

  private async deliverOne(
    deliveryId: string,
    now: Date,
  ): Promise<EmailDeliveryResult> {
    const delivery = await this.prisma.notificationDelivery.findUnique({
      where: { id: deliveryId },
      include: {
        notificationLog: {
          include: {
            user: {
              select: {
                email: true,
                isActive: true,
                isVerified: true,
                notificationPreference: true,
              },
            },
          },
        },
      },
    });
    if (!delivery) {
      return {
        provider: 'brevo',
        status: 'FAILED',
        reason: 'DELIVERY_RECORD_MISSING',
      };
    }

    const log = delivery.notificationLog;
    const category = this.category(log.metadata);
    if (!this.canDeliver(log.user, category)) {
      await this.prisma.notificationDelivery.update({
        where: { id: delivery.id },
        data: {
          status: NotificationDeliveryStatus.SKIPPED,
          claimedAt: null,
          nextAttemptAt: null,
          provider: 'brevo',
          recipientMasked: this.maskEmail(log.user.email),
          lastErrorCode: 'NOT_ELIGIBLE',
        },
      });
      return { provider: 'brevo', status: 'SKIPPED', reason: 'NOT_ELIGIBLE' };
    }

    try {
      const providerMessageId = await this.sendWithBrevo({
        recipient: log.user.email,
        subject: log.title,
        body: this.privacySafeBody(
          category,
          log.body,
          log.user.notificationPreference?.includeMedicineNames ?? false,
        ),
        actionLabel: 'Open MediTrack',
        actionUrl: this.actionUrl(log.metadata),
        tag: this.tag(category),
      });
      await this.prisma.notificationDelivery.update({
        where: { id: delivery.id },
        data: {
          status: NotificationDeliveryStatus.SENT,
          claimedAt: null,
          nextAttemptAt: null,
          provider: 'brevo',
          providerMessageId,
          recipientMasked: this.maskEmail(log.user.email),
          lastErrorCode: null,
          sentAt: new Date(),
        },
      });
      this.logger.log(
        `Email accepted for ${this.maskEmail(log.user.email)} (${category})`,
      );
      return {
        provider: 'brevo',
        status: 'SENT',
        recipientMasked: this.maskEmail(log.user.email),
        ...(providerMessageId ? { providerMessageId } : {}),
      };
    } catch (error) {
      const code = this.safeErrorCode(error);
      const canRetry = delivery.attempts < delivery.maxAttempts;
      const retryMinutes = Math.min(60, 2 ** delivery.attempts);
      await this.prisma.notificationDelivery.update({
        where: { id: delivery.id },
        data: {
          status: NotificationDeliveryStatus.FAILED,
          claimedAt: null,
          nextAttemptAt: canRetry
            ? new Date(now.getTime() + retryMinutes * 60 * 1000)
            : null,
          provider: 'brevo',
          recipientMasked: this.maskEmail(log.user.email),
          lastErrorCode: code,
        },
      });
      this.logger.warn(
        `Email delivery ${delivery.id} failed for ${this.maskEmail(log.user.email)} (${code})`,
      );
      return {
        provider: 'brevo',
        status: 'FAILED',
        recipientMasked: this.maskEmail(log.user.email),
        reason: code,
      };
    }
  }

  private canDeliver(
    user: {
      isActive: boolean;
      isVerified: boolean;
      notificationPreference: {
        emailEnabled: boolean;
        missedDoseEmails: boolean;
        refillEmails: boolean;
      } | null;
    },
    category: NotificationCategory,
  ) {
    if (!this.isEnabled() || !user.isActive || !user.isVerified) return false;
    if (category === 'PASSWORD_CHANGED') return true;
    const preferences = user.notificationPreference;
    if (!preferences?.emailEnabled) return false;
    if (
      category === 'MISSED_DOSE_ALERT' ||
      category === 'CAREGIVER_MISSED_DOSE' ||
      category === 'CAREGIVER_DOSE_HELP_REQUEST'
    ) {
      return preferences.missedDoseEmails;
    }
    if (category === 'LOW_STOCK_ALERT') return preferences.refillEmails;
    return true;
  }

  private async sendWithBrevo(
    input: DirectEmailInput,
  ): Promise<string | undefined> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), DELIVERY_TIMEOUT_MS);
    try {
      const response = await fetch(BREVO_ENDPOINT, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          accept: 'application/json',
          'api-key': process.env.BREVO_API_KEY!.trim(),
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          sender: {
            name: process.env.EMAIL_FROM_NAME?.trim() || 'MediTrack AI',
            email: process.env.EMAIL_FROM_ADDRESS!.trim(),
          },
          to: [{ email: input.recipient }],
          subject: input.subject,
          htmlContent: this.htmlContent(input),
          textContent: `${input.body}${input.actionUrl ? `\n\n${input.actionLabel ?? 'Open MediTrack'}: ${input.actionUrl}` : ''}`,
          tags: [input.tag],
        }),
      });
      const body = await this.readJson(response);
      if (!response.ok) {
        throw new EmailProviderError(
          `BREVO_${response.status}`,
          'Brevo rejected the email',
        );
      }
      return typeof body.messageId === 'string' ? body.messageId : undefined;
    } catch (error) {
      if (error instanceof EmailProviderError) throw error;
      if (error instanceof Error && error.name === 'AbortError') {
        throw new EmailProviderError('TIMEOUT', 'Email request timed out');
      }
      throw new EmailProviderError(
        'NETWORK_ERROR',
        'Email provider could not be reached',
      );
    } finally {
      clearTimeout(timeout);
    }
  }

  private category(metadata: Prisma.JsonValue | null): NotificationCategory {
    if (!metadata || Array.isArray(metadata) || typeof metadata !== 'object') {
      return 'GENERAL';
    }
    const value = metadata.type;
    return typeof value === 'string' &&
      [
        'CAREGIVER_MISSED_DOSE',
        'CAREGIVER_DOSE_HELP_REQUEST',
        'MISSED_DOSE_ALERT',
        'LOW_STOCK_ALERT',
        'EMAIL_TEST',
        'PASSWORD_CHANGED',
      ].includes(value)
      ? (value as NotificationCategory)
      : 'GENERAL';
  }

  private privacySafeBody(
    category: NotificationCategory,
    original: string,
    includeMedicineNames: boolean,
  ) {
    if (includeMedicineNames) return original;
    if (category === 'LOW_STOCK_ALERT') {
      return 'One of your medicines is running low. Open MediTrack to confirm current stock and review refill options.';
    }
    if (category === 'MISSED_DOSE_ALERT') {
      return 'A scheduled dose was recorded as missed. Open MediTrack to review your dose log.';
    }
    return original;
  }

  private actionUrl(metadata: Prisma.JsonValue | null): string | undefined {
    if (!metadata || Array.isArray(metadata) || typeof metadata !== 'object') {
      return undefined;
    }
    const path = metadata.actionUrl;
    if (
      typeof path !== 'string' ||
      !path.startsWith('/') ||
      path.startsWith('//')
    ) {
      return undefined;
    }
    const origin = process.env.FRONTEND_URL?.split(',')[0]?.trim();
    if (!origin) return undefined;
    try {
      return new URL(path, origin).toString();
    } catch {
      return undefined;
    }
  }

  private htmlContent(input: DirectEmailInput) {
    const action =
      input.actionUrl && input.actionLabel
        ? `<p><a href="${this.escapeHtml(input.actionUrl)}">${this.escapeHtml(input.actionLabel)}</a></p>`
        : '';
    return `<!doctype html><html lang="en"><body><h1>${this.escapeHtml(input.subject)}</h1><p>${this.escapeHtml(input.body)}</p>${action}<p>This message supports medication coordination and is not medical advice or emergency monitoring.</p></body></html>`;
  }

  private tag(category: NotificationCategory) {
    return category.toLowerCase().replaceAll('_', '-').slice(0, 50);
  }

  private async readJson(response: Response): Promise<Record<string, unknown>> {
    const text = (await response.text()).slice(0, 2_000);
    if (!text) return {};
    try {
      const parsed = JSON.parse(text) as unknown;
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : {};
    } catch {
      return {};
    }
  }

  private safeErrorCode(error: unknown) {
    return error instanceof EmailProviderError ? error.code : 'UNKNOWN_ERROR';
  }

  private maskEmail(email: string) {
    const separator = email.lastIndexOf('@');
    const local = separator > 0 ? email.slice(0, separator) : email;
    const domain = separator > 0 ? email.slice(separator + 1) : 'unknown';
    return `${local.slice(0, 2)}***@${domain}`;
  }

  private escapeHtml(value: string) {
    return value
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll(String.fromCharCode(39), '&#039;');
  }
}
