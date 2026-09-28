import { ForbiddenException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { UserRole } from '../common/enums/userrole.enum';
import { PrismaService } from '../prisma/prisma.service';
import { AuthService } from './auth.service';
import { EmailVerificationService } from './email-verification.service';
import { NotificationsService } from '../notifications/notifications.service';

const notifications = {
  sendOptionalEmail: jest.fn().mockResolvedValue(null),
} as unknown as NotificationsService;

describe('AuthService email verification gate', () => {
  it('does not create a session for a valid password until email verification', async () => {
    const passwordHash = await bcrypt.hash('StrongPassword!23', 4);
    const prisma = {
      user: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'user-1',
          email: 'patient@example.com',
          phone: null,
          passwordHash,
          role: UserRole.PATIENT,
          isActive: true,
          isVerified: false,
          lastLoginAt: null,
        }),
        update: jest.fn(),
      },
    };
    const jwtService = { signAsync: jest.fn() };
    const auditLogs = { log: jest.fn() };
    const emailVerification = { assertDeliveryReady: jest.fn() };
    const service = new AuthService(
      prisma as unknown as PrismaService,
      jwtService as unknown as JwtService,
      auditLogs as unknown as AuditLogsService,
      emailVerification as unknown as EmailVerificationService,
      notifications,
    );

    await expect(
      service.login({
        email: 'patient@example.com',
        password: 'StrongPassword!23',
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.user.update).not.toHaveBeenCalled();
    expect(jwtService.signAsync).not.toHaveBeenCalled();
    expect(auditLogs.log).not.toHaveBeenCalled();
  });

  it('keeps resend responses generic when a supplied care token is invalid', async () => {
    const prisma = {
      user: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'user-1',
          email: 'patient@example.com',
          isActive: true,
          isVerified: false,
        }),
      },
      careInvitation: { findUnique: jest.fn().mockResolvedValue(null) },
    };
    const emailVerification = {
      assertDeliveryReady: jest.fn(),
      issue: jest.fn().mockResolvedValue({ status: 'SENT' }),
    };
    const service = new AuthService(
      prisma as unknown as PrismaService,
      { signAsync: jest.fn() } as unknown as JwtService,
      { log: jest.fn() } as unknown as AuditLogsService,
      emailVerification as unknown as EmailVerificationService,
      notifications,
    );

    const result = await service.resendEmailVerification(
      'patient@example.com',
      'invalid-care-invitation-token-that-is-long-enough',
    );

    expect(result.accepted).toBe(true);
    expect(emailVerification.issue).toHaveBeenCalledWith({
      userId: 'user-1',
      email: 'patient@example.com',
      careInvitationToken: undefined,
      enforceCooldown: true,
      auditContext: {},
    });
  });
});

describe('AuthService account mode switching', () => {
  function createService(currentRole: UserRole, verified = true) {
    const baseUser = {
      id: 'user-1',
      email: 'person@example.com',
      phone: null,
      role: currentRole,
      isActive: true,
      isVerified: verified,
      lastLoginAt: null,
      createdAt: new Date('2026-08-15T00:00:00.000Z'),
    };
    const prisma = {
      user: {
        findUnique: jest.fn().mockResolvedValue(baseUser),
        update: jest
          .fn()
          .mockResolvedValue({ ...baseUser, role: UserRole.PATIENT }),
      },
    };
    const jwtService = {
      signAsync: jest
        .fn()
        .mockResolvedValueOnce('new-access-token')
        .mockResolvedValueOnce('new-refresh-token'),
    };
    const auditLogs = { log: jest.fn().mockResolvedValue(undefined) };
    const service = new AuthService(
      prisma as unknown as PrismaService,
      jwtService as unknown as JwtService,
      auditLogs as unknown as AuditLogsService,
      { assertDeliveryReady: jest.fn() } as unknown as EmailVerificationService,
      notifications,
    );
    return { service, prisma, jwtService, auditLogs };
  }

  it('switches a caregiver to patient mode and rotates both tokens', async () => {
    const { service, prisma, jwtService, auditLogs } = createService(
      UserRole.CAREGIVER,
    );

    const result = await service.switchAccountMode('user-1', UserRole.PATIENT, {
      ipAddress: '127.0.0.1',
    });

    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'user-1' },
        data: { role: UserRole.PATIENT },
      }),
    );
    expect(result.accessToken).toBe('new-access-token');
    expect(result.refreshToken).toBe('new-refresh-token');
    expect(result.user.role).toBe(UserRole.PATIENT);
    expect(jwtService.signAsync).toHaveBeenCalledTimes(2);
    expect(auditLogs.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'UPDATED',
        oldValues: { role: UserRole.CAREGIVER },
        newValues: { role: UserRole.PATIENT },
      }),
    );
  });

  it('returns a fresh session without writing when the requested mode is active', async () => {
    const { service, prisma, auditLogs } = createService(UserRole.PATIENT);

    const result = await service.switchAccountMode('user-1', UserRole.PATIENT);

    expect(result.user.role).toBe(UserRole.PATIENT);
    expect(prisma.user.update).not.toHaveBeenCalled();
    expect(auditLogs.log).not.toHaveBeenCalled();
  });

  it('does not allow administrator accounts to switch into patient mode', async () => {
    const { service, prisma, jwtService } = createService(UserRole.ADMIN);

    await expect(
      service.switchAccountMode('user-1', UserRole.PATIENT),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.user.update).not.toHaveBeenCalled();
    expect(jwtService.signAsync).not.toHaveBeenCalled();
  });
});
