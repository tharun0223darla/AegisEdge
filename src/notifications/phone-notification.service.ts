import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export type PhoneDeliveryStatus = 'SENT' | 'SKIPPED' | 'FAILED';

export interface PhoneNotificationPayload {
  userId: string;
  title: string;
  body: string;
  metadata?: Record<string, unknown>;
}

export interface PhoneDeliveryResult {
  provider: string;
  status: PhoneDeliveryStatus;
  recipientMasked?: string;
  providerMessageId?: string;
  reason?: string;
  error?: string;
}

@Injectable()
export class PhoneNotificationService {
  private readonly logger = new Logger(PhoneNotificationService.name);

  constructor(private readonly prisma: PrismaService) {}

  isEnabled(): boolean {
    return this.readBool('PHONE_NOTIFICATIONS_ENABLED', false);
  }

  async sendToUser(payload: PhoneNotificationPayload): Promise<PhoneDeliveryResult> {
    const provider = this.provider();

    if (!this.isEnabled()) {
      return { provider, status: 'SKIPPED', reason: 'Phone notifications are disabled' };
    }

    const user = await this.prisma.user.findUnique({
      where: { id: payload.userId },
      select: { phone: true, isActive: true, isVerified: true },
    });

    if (!user?.isActive) {
      return { provider, status: 'SKIPPED', reason: 'User is inactive or missing' };
    }

    if (!user.phone) {
      return { provider, status: 'SKIPPED', reason: 'User has no registered phone number' };
    }

    if (this.requireVerifiedUser() && !user.isVerified) {
      return { provider, status: 'SKIPPED', reason: 'User is not verified for phone notifications' };
    }

    const recipient = this.normalizePhone(user.phone);
    if (!recipient) {
      return { provider, status: 'SKIPPED', reason: 'Registered phone number is not in a sendable format' };
    }

    const message = this.buildMessage(payload);

    try {
      switch (provider) {
        case 'console':
          return this.sendConsole(recipient, message);
        case 'twilio':
          return await this.sendTwilio(recipient, message);
        case 'generic-webhook':
          return await this.sendGenericWebhook(recipient, message, payload);
        default:
          return { provider, status: 'SKIPPED', reason: `Unsupported phone notification provider: ${provider}` };
      }
    } catch (error) {
      const messageText = error instanceof Error ? error.message : String(error);
      this.logger.error(`Phone notification failed: ${messageText}`);
      return {
        provider,
        status: 'FAILED',
        recipientMasked: this.maskPhone(recipient),
        error: messageText,
      };
    }
  }

  private sendConsole(recipient: string, message: string): PhoneDeliveryResult {
    this.logger.log(`[PHONE console] ${this.maskPhone(recipient)} <- ${message}`);
    return {
      provider: 'console',
      status: 'SENT',
      recipientMasked: this.maskPhone(recipient),
      providerMessageId: `console-${Date.now()}`,
    };
  }

  private async sendTwilio(recipient: string, message: string): Promise<PhoneDeliveryResult> {
    const sid = process.env.TWILIO_ACCOUNT_SID;
    const token = process.env.TWILIO_AUTH_TOKEN;
    const from = process.env.TWILIO_FROM_NUMBER;

    if (!sid || !token || !from) {
      return { provider: 'twilio', status: 'SKIPPED', reason: 'Twilio credentials are not configured' };
    }

    const form = new URLSearchParams();
    form.set('To', recipient);
    form.set('From', from);
    form.set('Body', message);

    const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString('base64')}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: form.toString(),
    });

    const text = await response.text();
    let data: { sid?: string; message?: string } = {};
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      data = { message: text };
    }

    if (!response.ok) {
      return {
        provider: 'twilio',
        status: 'FAILED',
        recipientMasked: this.maskPhone(recipient),
        error: data.message || `Twilio returned ${response.status}`,
      };
    }

    return {
      provider: 'twilio',
      status: 'SENT',
      recipientMasked: this.maskPhone(recipient),
      providerMessageId: data.sid,
    };
  }

  private async sendGenericWebhook(
    recipient: string,
    message: string,
    payload: PhoneNotificationPayload,
  ): Promise<PhoneDeliveryResult> {
    const url = process.env.PHONE_NOTIFICATION_WEBHOOK_URL;
    if (!url) {
      return { provider: 'generic-webhook', status: 'SKIPPED', reason: 'Webhook URL is not configured' };
    }

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(process.env.PHONE_NOTIFICATION_WEBHOOK_API_KEY
          ? { Authorization: `Bearer ${process.env.PHONE_NOTIFICATION_WEBHOOK_API_KEY}` }
          : {}),
      },
      body: JSON.stringify({
        to: recipient,
        message,
        title: payload.title,
        metadata: payload.metadata ?? {},
      }),
    });

    const text = await response.text();
    if (!response.ok) {
      return {
        provider: 'generic-webhook',
        status: 'FAILED',
        recipientMasked: this.maskPhone(recipient),
        error: text || `Webhook returned ${response.status}`,
      };
    }

    return {
      provider: 'generic-webhook',
      status: 'SENT',
      recipientMasked: this.maskPhone(recipient),
      providerMessageId: text.slice(0, 120) || undefined,
    };
  }

  private buildMessage(payload: PhoneNotificationPayload): string {
    const type = String(payload.metadata?.type ?? '').toUpperCase();
    const includeMedicineName = this.readBool('PHONE_NOTIFICATION_INCLUDE_MEDICINE_NAME', false);

    let message: string;
    if (type === 'DOSE_REMINDER') {
      const doseTime = typeof payload.metadata?.doseTime === 'string' ? payload.metadata.doseTime : undefined;
      message = includeMedicineName
        ? `MediTrack reminder: ${payload.body}`
        : `MediTrack reminder: It is time to take your scheduled medicine${doseTime ? ` at ${doseTime}` : ''}. Open MediTrack to confirm.`;
    } else if (type === 'SNOOZE_RETRIGGERED') {
      message = includeMedicineName
        ? `MediTrack reminder: ${payload.body}`
        : 'MediTrack reminder: A snoozed medicine is due now. Open MediTrack to confirm.';
    } else if (type === 'MISSED_DOSE_ALERT') {
      message = includeMedicineName
        ? `MediTrack alert: ${payload.body}`
        : 'MediTrack alert: A scheduled dose may have been missed. Open MediTrack to review.';
    } else if (type === 'LOW_STOCK_ALERT') {
      message = includeMedicineName
        ? `MediTrack alert: ${payload.body}`
        : 'MediTrack alert: Your medicine stock may be low. Open MediTrack to review refills.';
    } else if (type === 'PHONE_TEST') {
      message = 'MediTrack test: phone notifications are connected for this registered number.';
    } else {
      message = `MediTrack: ${payload.title}. Open MediTrack for details.`;
    }

    return this.compact(message).slice(0, 320);
  }

  private normalizePhone(raw: string): string | null {
    const cleaned = raw.replace(/[\s().-]/g, '');
    if (/^\+[1-9]\d{7,14}$/.test(cleaned)) return cleaned;

    const defaultCountryCode = process.env.PHONE_NOTIFICATION_DEFAULT_COUNTRY_CODE?.trim();
    if (defaultCountryCode && /^\+\d{1,4}$/.test(defaultCountryCode) && /^[1-9]\d{7,14}$/.test(cleaned)) {
      return `${defaultCountryCode}${cleaned}`;
    }

    return null;
  }

  private maskPhone(phone: string): string {
    if (phone.length <= 5) return '***';
    return `${phone.slice(0, 3)}***${phone.slice(-3)}`;
  }

  private compact(value: string): string {
    return value.replace(/\s+/g, ' ').trim();
  }

  private provider(): string {
    return (process.env.PHONE_NOTIFICATION_PROVIDER || 'console').trim().toLowerCase();
  }

  private requireVerifiedUser(): boolean {
    const defaultValue = process.env.NODE_ENV === 'production';
    return this.readBool('PHONE_NOTIFICATION_REQUIRE_VERIFIED_USER', defaultValue);
  }

  private readBool(name: string, fallback: boolean): boolean {
    const value = process.env[name];
    if (value === undefined || value === '') return fallback;
    return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
  }
}
