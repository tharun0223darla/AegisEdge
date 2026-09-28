import { BadRequestException } from '@nestjs/common';
import { createHash } from 'crypto';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { PrismaService } from '../prisma/prisma.service';
import { EmailVerificationService } from './email-verification.service';
import {
  VerificationEmailTransport,
  type VerificationEmailInput,
} from './verification-email.transport';

function createPrismaMock() {
  const prisma = {
    emailVerificationToken: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      updateMany: jest.fn(),
      create: jest.fn(),
      deleteMany: jest.fn(),
    },
    user: { update: jest.fn() },
    $transaction: jest.fn(),
  };
  prisma.$transaction.mockImplementation(
    async (callback: (tx: typeof prisma) => Promise<unknown>) =>
      callback(prisma),
  );
  return prisma;
}

describe('EmailVerificationService', () => {
  const auditLogs = { log: jest.fn().mockResolvedValue(undefined) };
  const transport = {
    assertReady: jest.fn(),
    send: jest.fn(),
  };

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('stores only a token hash and sends the raw token once', async () => {
    const prisma = createPrismaMock();
    prisma.emailVerificationToken.updateMany.mockResolvedValue({ count: 0 });
    let storedTokenHash = '';
    prisma.emailVerificationToken.create.mockImplementation(
      (input: { data: { tokenHash: string } }) => {
        storedTokenHash = input.data.tokenHash;
        return Promise.resolve({ id: 'token-1' });
      },
    );
    let delivered: VerificationEmailInput | undefined;
    transport.send.mockImplementation((input: VerificationEmailInput) => {
      delivered = input;
      return Promise.resolve({ provider: 'brevo', messageId: 'message-1' });
    });
    const service = new EmailVerificationService(
      prisma as unknown as PrismaService,
      transport as unknown as VerificationEmailTransport,
      auditLogs as unknown as AuditLogsService,
    );

    const result = await service.issue({
      userId: 'user-1',
      email: 'caregiver@example.com',
      careInvitationToken: 'care-invitation-secret',
    });

    expect(result.status).toBe('SENT');
    expect(delivered?.token).toBeDefined();
    expect(storedTokenHash).toMatch(/^[a-f0-9]{64}$/);
    expect(storedTokenHash).not.toBe(delivered?.token);
    expect(storedTokenHash).toBe(
      createHash('sha256').update(delivered!.token).digest('hex'),
    );
    expect(delivered?.careInvitationToken).toBe('care-invitation-secret');
    expect(JSON.stringify(auditLogs.log.mock.calls)).not.toContain(
      delivered!.token,
    );
  });

  it('marks the email verified after atomically claiming a valid token', async () => {
    const prisma = createPrismaMock();
    const token = 'verification-token-that-is-long-enough';
    prisma.emailVerificationToken.findUnique.mockResolvedValue({
      id: 'token-1',
      userId: 'user-1',
      expiresAt: new Date(Date.now() + 60_000),
      usedAt: null,
      user: { email: 'patient@example.com', isActive: true },
    });
    prisma.emailVerificationToken.updateMany.mockResolvedValue({ count: 1 });
    prisma.user.update.mockResolvedValue({ id: 'user-1' });
    const service = new EmailVerificationService(
      prisma as unknown as PrismaService,
      transport as unknown as VerificationEmailTransport,
      auditLogs as unknown as AuditLogsService,
    );

    const result = await service.verify(token);

    expect(prisma.emailVerificationToken.findUnique).toHaveBeenCalledTimes(1);
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 'user-1' },
      data: { isVerified: true },
    });
    expect(result).toEqual(
      expect.objectContaining({ verified: true, email: 'pa***@example.com' }),
    );
  });

  it('rejects expired tokens without activating the account', async () => {
    const prisma = createPrismaMock();
    prisma.emailVerificationToken.findUnique.mockResolvedValue({
      id: 'token-1',
      userId: 'user-1',
      expiresAt: new Date(Date.now() - 1_000),
      usedAt: null,
      user: { email: 'patient@example.com', isActive: true },
    });
    const service = new EmailVerificationService(
      prisma as unknown as PrismaService,
      transport as unknown as VerificationEmailTransport,
      auditLogs as unknown as AuditLogsService,
    );

    await expect(
      service.verify('expired-verification-token-value'),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('silently applies the resend cooldown without revealing the account', async () => {
    const prisma = createPrismaMock();
    prisma.emailVerificationToken.findFirst.mockResolvedValue({
      id: 'recent-token',
    });
    const service = new EmailVerificationService(
      prisma as unknown as PrismaService,
      transport as unknown as VerificationEmailTransport,
      auditLogs as unknown as AuditLogsService,
    );

    const result = await service.issue({
      userId: 'user-1',
      email: 'patient@example.com',
      enforceCooldown: true,
    });

    expect(result.status).toBe('COOLDOWN');
    expect(transport.send).not.toHaveBeenCalled();
    expect(prisma.emailVerificationToken.create).not.toHaveBeenCalled();
  });
});
