import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { AuditAction } from '@prisma/client';
import { createHash, randomBytes } from 'crypto';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { PrismaService } from '../prisma/prisma.service';
import { VerificationEmailTransport } from './verification-email.transport';

const TOKEN_LIFETIME_MS = 30 * 60 * 1_000;
const RESEND_COOLDOWN_MS = 60 * 1_000;

type AuditContext = {
  ipAddress?: string;
  userAgent?: string;
};

type IssueVerificationInput = {
  userId: string;
  email: string;
  careInvitationToken?: string;
  enforceCooldown?: boolean;
  auditContext?: AuditContext;
};

@Injectable()
export class EmailVerificationService {
  private readonly logger = new Logger(EmailVerificationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly transport: VerificationEmailTransport,
    private readonly auditLogs: AuditLogsService,
  ) {}

  assertDeliveryReady(): void {
    this.transport.assertReady();
  }

  async issue(input: IssueVerificationInput) {
    const now = new Date();
    if (input.enforceCooldown) {
      const recent = await this.prisma.emailVerificationToken.findFirst({
        where: {
          userId: input.userId,
          usedAt: null,
          createdAt: { gt: new Date(now.getTime() - RESEND_COOLDOWN_MS) },
        },
        select: { id: true },
      });
      if (recent) {
        return { status: 'COOLDOWN' as const };
      }
    }

    const token = randomBytes(32).toString('base64url');
    const tokenHash = this.hashToken(token);
    const expiresAt = new Date(now.getTime() + TOKEN_LIFETIME_MS);
    const created = await this.createToken(
      input.userId,
      tokenHash,
      expiresAt,
      now,
    );

    try {
      const delivery = await this.transport.send({
        email: input.email,
        token,
        careInvitationToken: input.careInvitationToken,
      });
      await this.auditLogs.log({
        userId: input.userId,
        action: AuditAction.EMAIL_VERIFICATION_SENT,
        entityType: 'EmailVerificationToken',
        entityId: created.id,
        newValues: {
          provider: delivery.provider,
          expiresAt: expiresAt.toISOString(),
        },
        ...input.auditContext,
      });
      return { status: 'SENT' as const };
    } catch {
      await this.prisma.emailVerificationToken.deleteMany({
        where: { id: created.id, usedAt: null },
      });
      this.logger.warn(
        `Verification delivery was not completed for user ${input.userId}`,
      );
      return { status: 'FAILED' as const };
    }
  }

  private createToken(
    userId: string,
    tokenHash: string,
    expiresAt: Date,
    now: Date,
  ) {
    return this.prisma.$transaction(async (tx) => {
      await tx.emailVerificationToken.updateMany({
        where: { userId, usedAt: null },
        data: { usedAt: now },
      });
      return tx.emailVerificationToken.create({
        data: { userId, tokenHash, expiresAt },
        select: { id: true },
      });
    });
  }

  async verify(token: string, auditContext: AuditContext = {}) {
    const now = new Date();
    const tokenHash = this.hashToken(token);
    const result = await this.prisma.$transaction(async (tx) => {
      const record = await tx.emailVerificationToken.findUnique({
        where: { tokenHash },
        select: {
          id: true,
          userId: true,
          expiresAt: true,
          usedAt: true,
          user: { select: { email: true, isActive: true } },
        },
      });
      if (
        !record ||
        record.usedAt ||
        record.expiresAt <= now ||
        !record.user.isActive
      ) {
        throw new BadRequestException(
          'This verification link is invalid or has expired.',
        );
      }

      const claimed = await tx.emailVerificationToken.updateMany({
        where: {
          id: record.id,
          usedAt: null,
          expiresAt: { gt: now },
        },
        data: { usedAt: now },
      });
      if (claimed.count !== 1) {
        throw new BadRequestException(
          'This verification link has already been used.',
        );
      }

      await tx.user.update({
        where: { id: record.userId },
        data: { isVerified: true },
      });
      await tx.emailVerificationToken.updateMany({
        where: { userId: record.userId, usedAt: null },
        data: { usedAt: now },
      });
      return { userId: record.userId, email: record.user.email };
    });

    await this.auditLogs.log({
      userId: result.userId,
      action: AuditAction.EMAIL_VERIFIED,
      entityType: 'User',
      entityId: result.userId,
      newValues: { emailVerified: true },
      ...auditContext,
    });

    return {
      verified: true,
      email: this.maskEmail(result.email),
      message: 'Email verified. You can now sign in.',
    };
  }

  private hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  private maskEmail(email: string): string {
    const separator = email.lastIndexOf('@');
    const local = separator > 0 ? email.slice(0, separator) : email;
    const domain = separator > 0 ? email.slice(separator + 1) : 'unknown';
    return `${local.slice(0, 2)}***@${domain}`;
  }
}
