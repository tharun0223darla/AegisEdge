import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { createTransport, type Transporter } from 'nodemailer';
import type SMTPPool from 'nodemailer/lib/smtp-pool';

const BREVO_ENDPOINT = 'https://api.brevo.com/v3/smtp/email';
const DELIVERY_TIMEOUT_MS = 10_000;
const SMTP_SOCKET_TIMEOUT_MS = 15_000;

type VerificationEmailProvider = 'brevo' | 'smtp' | 'console';

export type VerificationEmailInput = {
  email: string;
  token: string;
  careInvitationToken?: string;
};

export type VerificationEmailDelivery = {
  provider: VerificationEmailProvider;
  messageId?: string;
};

@Injectable()
export class VerificationEmailTransport {
  private readonly logger = new Logger(VerificationEmailTransport.name);
  private smtpTransport?: Transporter<
    SMTPPool.SentMessageInfo,
    SMTPPool.Options
  >;

  assertReady(): void {
    if (process.env.EMAIL_VERIFICATION_ENABLED === 'false') {
      throw new ServiceUnavailableException(
        'Email verification is temporarily unavailable.',
      );
    }
    const provider = this.provider();
    if (provider === 'console' && process.env.NODE_ENV !== 'production') return;
    if (
      provider === 'brevo' &&
      process.env.BREVO_API_KEY?.trim() &&
      process.env.EMAIL_FROM_ADDRESS?.trim()
    ) {
      return;
    }
    if (
      provider === 'smtp' &&
      process.env.SMTP_HOST?.trim() &&
      this.smtpPort() &&
      process.env.SMTP_USER?.trim() &&
      process.env.SMTP_PASSWORD?.trim() &&
      process.env.EMAIL_FROM_ADDRESS?.trim()
    ) {
      this.smtpSecure();
      return;
    }
    throw new ServiceUnavailableException(
      'Email verification is not configured.',
    );
  }

  async send(
    input: VerificationEmailInput,
  ): Promise<VerificationEmailDelivery> {
    this.assertReady();
    const verificationUrl = this.buildVerificationUrl(input);
    if (this.provider() === 'console') {
      this.logger.warn(
        `[development only] Verify ${this.maskEmail(input.email)}: ${verificationUrl}`,
      );
      return { provider: 'console' };
    }
    return this.provider() === 'smtp'
      ? this.sendWithSmtp(input.email, verificationUrl)
      : this.sendWithBrevo(input.email, verificationUrl);
  }

  private async sendWithSmtp(
    email: string,
    verificationUrl: string,
  ): Promise<VerificationEmailDelivery> {
    try {
      const result = await this.getSmtpTransport().sendMail({
        from: {
          name: process.env.EMAIL_FROM_NAME?.trim() || 'MediTrack AI',
          address: process.env.EMAIL_FROM_ADDRESS!.trim(),
        },
        to: email,
        subject: 'Verify your MediTrack email',
        text: this.textContent(verificationUrl),
        html: this.htmlContent(verificationUrl),
      });
      const accepted = result.accepted.map((recipient) =>
        recipient.toLowerCase(),
      );
      if (!accepted.includes(email.toLowerCase())) {
        throw new Error('SMTP server did not accept the recipient');
      }
      this.logger.log(
        `Verification email accepted for ${this.maskEmail(email)} via SMTP`,
      );
      return { provider: 'smtp', messageId: result.messageId };
    } catch (error) {
      this.handleDeliveryError(email, error);
    }
  }

  private async sendWithBrevo(
    email: string,
    verificationUrl: string,
  ): Promise<VerificationEmailDelivery> {
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
          to: [{ email }],
          subject: 'Verify your MediTrack email',
          htmlContent: this.htmlContent(verificationUrl),
          tags: ['email-verification'],
        }),
      });
      const body = (await this.readJson(response)) as {
        messageId?: string;
        message?: string;
      };
      if (!response.ok) {
        throw new Error(
          `Brevo rejected verification email (${response.status}): ${body.message ?? 'unknown error'}`,
        );
      }
      this.logger.log(
        `Verification email accepted for ${this.maskEmail(email)}`,
      );
      return { provider: 'brevo', messageId: body.messageId };
    } catch (error) {
      this.handleDeliveryError(email, error);
    } finally {
      clearTimeout(timeout);
    }
  }

  private handleDeliveryError(email: string, error: unknown): never {
    const reason =
      error instanceof Error && error.name === 'AbortError'
        ? 'delivery timed out'
        : error instanceof Error
          ? error.message
          : 'unknown delivery error';
    this.logger.error(
      `Verification email failed for ${this.maskEmail(email)}: ${reason}`,
    );
    throw new ServiceUnavailableException(
      'Verification email could not be sent. Please try again.',
    );
  }

  private provider(): VerificationEmailProvider {
    const configured = process.env.EMAIL_VERIFICATION_PROVIDER?.toLowerCase();
    if (configured === 'console' && process.env.NODE_ENV !== 'production') {
      return 'console';
    }
    if (configured === 'brevo' || configured === 'smtp') return configured;
    if (!configured && process.env.NODE_ENV !== 'production') return 'console';
    throw new ServiceUnavailableException(
      'Email verification provider is not configured.',
    );
  }

  private getSmtpTransport(): Transporter<
    SMTPPool.SentMessageInfo,
    SMTPPool.Options
  > {
    if (this.smtpTransport) return this.smtpTransport;
    const secure = this.smtpSecure();
    this.smtpTransport = createTransport({
      pool: true,
      maxConnections: 2,
      maxMessages: 50,
      host: process.env.SMTP_HOST!.trim(),
      port: this.smtpPort(),
      secure,
      requireTLS: !secure,
      auth: {
        user: process.env.SMTP_USER!.trim(),
        pass: process.env.SMTP_PASSWORD!.trim(),
      },
      connectionTimeout: DELIVERY_TIMEOUT_MS,
      greetingTimeout: DELIVERY_TIMEOUT_MS,
      socketTimeout: SMTP_SOCKET_TIMEOUT_MS,
      tls: {
        minVersion: 'TLSv1.2',
        rejectUnauthorized: true,
      },
    });
    return this.smtpTransport;
  }

  private smtpPort(): number {
    const port = Number(process.env.SMTP_PORT);
    if (!Number.isInteger(port) || port < 1 || port > 65_535) {
      throw new ServiceUnavailableException(
        'Email verification SMTP port is invalid.',
      );
    }
    return port;
  }

  private smtpSecure(): boolean {
    const value = process.env.SMTP_SECURE?.trim().toLowerCase();
    if (value === 'true') return true;
    if (value === 'false') return false;
    throw new ServiceUnavailableException(
      'Email verification SMTP security setting is invalid.',
    );
  }

  private buildVerificationUrl(input: VerificationEmailInput): string {
    const frontendOrigin = process.env.FRONTEND_URL?.split(',')[0]?.trim();
    if (!frontendOrigin) {
      throw new ServiceUnavailableException(
        'Email verification URL is not configured.',
      );
    }
    const url = new URL('/verify-email', frontendOrigin);
    const fragment = new URLSearchParams({ token: input.token });
    if (input.careInvitationToken) {
      fragment.set('careInvite', input.careInvitationToken);
    }
    url.hash = fragment.toString();
    return url.toString();
  }

  private htmlContent(url: string): string {
    const safeUrl = this.escapeHtml(url);
    return `<!doctype html><html lang="en"><body>
<h1>Verify your MediTrack email</h1>
<p>Confirm that this email belongs to you before accessing MediTrack.</p>
<p><a href="${safeUrl}">Verify email</a></p>
<p>This single-use link expires in 30 minutes. If you did not create or accept a MediTrack account, ignore this message.</p>
</body></html>`;
  }

  private textContent(url: string): string {
    return [
      'Verify your MediTrack email',
      '',
      'Confirm that this email belongs to you before accessing MediTrack:',
      url,
      '',
      'This single-use link expires in 30 minutes.',
      'If you did not create or accept a MediTrack account, ignore this message.',
    ].join('\n');
  }

  private escapeHtml(value: string): string {
    return value
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');
  }

  private async readJson(response: Response): Promise<unknown> {
    const text = (await response.text()).slice(0, 2_000);
    if (!text) return {};
    try {
      return JSON.parse(text) as unknown;
    } catch {
      return {};
    }
  }

  private maskEmail(email: string): string {
    const separator = email.lastIndexOf('@');
    const local = separator > 0 ? email.slice(0, separator) : email;
    const domain = separator > 0 ? email.slice(separator + 1) : 'unknown';
    return `${local.slice(0, 2)}***@${domain}`;
  }
}
