import {
  CarePermission,
  CareRelationshipStatus,
  CareInvitationStatus,
} from '@prisma/client';
import { ForbiddenException } from '@nestjs/common';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { PrismaService } from '../prisma/prisma.service';
import { CareService } from './care.service';
import { EmailNotificationService } from '../notifications/email-notification.service';

function createPrismaMock() {
  const prisma = {
    user: { findUnique: jest.fn() },
    careRelationship: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      update: jest.fn(),
      upsert: jest.fn(),
    },
    careInvitation: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    careEscalation: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
    medicineSchedule: { findFirst: jest.fn() },
    doseLog: { findMany: jest.fn() },
    medicine: { findMany: jest.fn() },
    auditLog: { findMany: jest.fn() },
    $transaction: jest.fn((input: unknown) =>
      Array.isArray(input) ? Promise.all(input) : input,
    ),
  };
  return prisma;
}

describe('CareService', () => {
  const auditLogs = { log: jest.fn().mockResolvedValue(undefined) };
  const emailNotifications = {
    sendDirect: jest.fn().mockResolvedValue({
      provider: 'brevo',
      status: 'SENT',
      recipientMasked: 'ca***@example.com',
    }),
  };
  const originalFrontendUrl = process.env.FRONTEND_URL;

  afterEach(() => {
    jest.clearAllMocks();
    process.env.FRONTEND_URL = originalFrontendUrl;
  });

  it('stores only an invitation token hash and returns the secret in the URL fragment', async () => {
    const prisma = createPrismaMock();
    prisma.user.findUnique
      .mockResolvedValueOnce({
        id: 'patient-1',
        email: 'patient@example.com',
        isActive: true,
        patientProfile: { dateOfBirth: new Date('1990-01-01') },
      })
      .mockResolvedValueOnce({ id: 'caregiver-1', isActive: true });
    prisma.careRelationship.findUnique.mockResolvedValue(null);
    prisma.careRelationship.count.mockResolvedValue(0);
    prisma.careInvitation.count.mockResolvedValue(0);
    let storedTokenHash = '';
    prisma.careInvitation.create.mockImplementation((input: unknown) => {
      const data = (
        input as {
          data: Record<string, unknown> & { tokenHash: string };
        }
      ).data;
      storedTokenHash = data.tokenHash;
      return Promise.resolve({
        id: 'invite-1',
        status: CareInvitationStatus.PENDING,
        createdAt: new Date(),
        ...data,
      });
    });
    process.env.FRONTEND_URL = 'https://app.example.test';

    const service = new CareService(
      prisma as unknown as PrismaService,
      auditLogs as unknown as AuditLogsService,
      emailNotifications as unknown as EmailNotificationService,
    );
    const result = await service.createInvitation('patient-1', {
      email: 'caregiver@example.com',
      permissions: [CarePermission.VIEW_ADHERENCE],
      confirmAdult: true,
      consentAcknowledged: true,
      accessDurationDays: 90,
    });

    expect(storedTokenHash).toMatch(/^[a-f0-9]{64}$/);
    expect(result.inviteUrl).toContain(
      'https://app.example.test/care/invitations/accept#token=',
    );
    expect(result.inviteUrl).not.toContain(storedTokenHash);
    expect(JSON.stringify(auditLogs.log.mock.calls)).not.toContain('"token"');
  });

  it('allows an invitation to an email that has not registered yet', async () => {
    const prisma = createPrismaMock();
    prisma.user.findUnique
      .mockResolvedValueOnce({
        id: 'patient-1',
        email: 'patient@example.com',
        isActive: true,
        patientProfile: { dateOfBirth: new Date('1990-01-01') },
      })
      .mockResolvedValueOnce(null);
    prisma.careRelationship.count.mockResolvedValue(0);
    prisma.careInvitation.count.mockResolvedValue(0);
    prisma.careInvitation.create.mockResolvedValue({
      id: 'invite-new-account',
      invitedEmail: 'new-caregiver@example.com',
      status: CareInvitationStatus.PENDING,
      permissions: [CarePermission.VIEW_ADHERENCE],
      expiresAt: new Date(Date.now() + 60_000),
      createdAt: new Date(),
    });
    process.env.FRONTEND_URL = 'https://app.example.test';

    const service = new CareService(
      prisma as unknown as PrismaService,
      auditLogs as unknown as AuditLogsService,
      emailNotifications as unknown as EmailNotificationService,
    );
    const result = await service.createInvitation('patient-1', {
      email: 'new-caregiver@example.com',
      permissions: [CarePermission.VIEW_ADHERENCE],
      confirmAdult: true,
      consentAcknowledged: true,
      accessDurationDays: 90,
    });

    expect(result.invitation.invitedEmail).toBe('n***@example.com');
    expect(prisma.careRelationship.findUnique).not.toHaveBeenCalled();
    expect(prisma.careInvitation.create).toHaveBeenCalled();
  });

  it('denies a caregiver dashboard without an active relationship', async () => {
    const prisma = createPrismaMock();
    prisma.careRelationship.findUnique.mockResolvedValue(null);
    const service = new CareService(
      prisma as unknown as PrismaService,
      auditLogs as unknown as AuditLogsService,
      emailNotifications as unknown as EmailNotificationService,
    );

    await expect(
      service.getCaregiverDashboard('caregiver-1', 'patient-1'),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.doseLog.findMany).not.toHaveBeenCalled();
    expect(prisma.medicine.findMany).not.toHaveBeenCalled();
  });

  it('does not expose adherence events when only medicine access was granted', async () => {
    const prisma = createPrismaMock();
    prisma.careRelationship.findUnique.mockResolvedValue({
      id: 'relationship-1',
      patientId: 'patient-1',
      caregiverId: 'caregiver-1',
      status: CareRelationshipStatus.ACTIVE,
      permissions: [CarePermission.VIEW_MEDICATIONS],
      expiresAt: new Date(Date.now() + 60_000),
      patient: {
        id: 'patient-1',
        email: 'patient@example.com',
        isActive: true,
        patientProfile: { firstName: 'Patient', lastName: 'One' },
      },
    });
    prisma.medicineSchedule.findFirst.mockResolvedValue({ timezone: 'UTC' });
    prisma.medicine.findMany.mockResolvedValue([
      {
        id: 'medicine-1',
        name: 'Shared medicine',
        genericName: null,
        strength: '10mg',
        form: 'TABLET',
        unit: 'tablet',
      },
    ]);
    const service = new CareService(
      prisma as unknown as PrismaService,
      auditLogs as unknown as AuditLogsService,
      emailNotifications as unknown as EmailNotificationService,
    );

    const result = await service.getCaregiverDashboard(
      'caregiver-1',
      'patient-1',
    );

    expect(result.adherence).toBeNull();
    expect(result.doses).toBeNull();
    expect(result.medicines).toHaveLength(1);
    expect(result.refills).toBeNull();
    expect(prisma.doseLog.findMany).not.toHaveBeenCalled();
  });
});
