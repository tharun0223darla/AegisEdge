import {
  CareEscalationStatus,
  CareEscalationKind,
  CarePermission,
  CareRelationshipStatus,
  DoseStatus,
  NotificationChannel,
} from '@prisma/client';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { CareEscalationService } from './care-escalation.service';

describe('CareEscalationService', () => {
  const now = new Date('2026-07-30T10:00:00.000Z');
  const prisma = {
    doseLog: { findMany: jest.fn(), findUnique: jest.fn() },
    careRelationship: { findMany: jest.fn() },
    careEscalation: {
      createMany: jest.fn(),
      findMany: jest.fn(),
      updateMany: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
    },
  };
  const notifications = {
    send: jest.fn(),
    sendOptionalEmail: jest.fn().mockResolvedValue(null),
  };
  const auditLogs = { log: jest.fn() };

  beforeEach(() => jest.clearAllMocks());

  function service() {
    return new CareEscalationService(
      prisma as unknown as PrismaService,
      notifications as unknown as NotificationsService,
      auditLogs as unknown as AuditLogsService,
    );
  }

  it('creates one idempotent escalation row per authorized relationship', async () => {
    prisma.doseLog.findMany.mockResolvedValue([
      {
        id: 'dose-1',
        userId: 'patient-1',
        status: DoseStatus.MISSED,
        scheduledAt: new Date('2026-07-30T09:00:00.000Z'),
      },
    ]);
    prisma.careRelationship.findMany.mockResolvedValue([
      {
        id: 'relationship-1',
        patientId: 'patient-1',
        patientConsentedAt: new Date('2026-07-01T00:00:00.000Z'),
      },
    ]);
    prisma.careEscalation.createMany.mockResolvedValue({ count: 1 });

    await expect(service().discoverEscalations(now)).resolves.toBe(1);
    expect(prisma.careEscalation.createMany).toHaveBeenCalledWith({
      data: [
        {
          relationshipId: 'relationship-1',
          doseLogId: 'dose-1',
          kind: CareEscalationKind.MISSED_DOSE,
          status: CareEscalationStatus.PENDING,
        },
      ],
      skipDuplicates: true,
    });
  });

  it('sends a privacy-safe deduplicated alert without names or medicine data', async () => {
    prisma.careEscalation.findMany.mockResolvedValue([
      { id: 'escalation-1', status: CareEscalationStatus.PENDING },
    ]);
    prisma.careEscalation.updateMany.mockResolvedValue({ count: 1 });
    prisma.careEscalation.findUnique.mockResolvedValue({
      id: 'escalation-1',
      doseLogId: 'dose-1',
      attempts: 1,
      kind: CareEscalationKind.MISSED_DOSE,
      relationship: {
        id: 'relationship-1',
        patientId: 'patient-1',
        caregiverId: 'caregiver-1',
        status: CareRelationshipStatus.ACTIVE,
        expiresAt: new Date('2026-08-30T00:00:00.000Z'),
        patientConsentedAt: new Date('2026-07-01T00:00:00.000Z'),
        permissions: [CarePermission.RECEIVE_MISSED_DOSE_ALERTS],
        caregiver: { id: 'caregiver-1', isActive: true },
      },
      doseLog: {
        id: 'dose-1',
        scheduledAt: new Date('2026-07-30T09:00:00.000Z'),
      },
    });
    let sentPayload: { title: string; body: string } | undefined;
    notifications.send.mockImplementation((payload: unknown) => {
      sentPayload = payload as { title: string; body: string };
      return Promise.resolve({ id: 'notification-1' });
    });
    prisma.careEscalation.update.mockResolvedValue({});
    auditLogs.log.mockResolvedValue(undefined);

    await expect(service().deliverEscalations(now)).resolves.toBe(1);
    expect(notifications.send).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'caregiver-1',
        channel: NotificationChannel.LOCAL,
        dedupeKey: 'care-missed:relationship-1:dose-1',
      }),
    );
    expect(notifications.sendOptionalEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'caregiver-1',
        dedupeKey: 'care-missed:relationship-1:dose-1',
      }),
      'CAREGIVER_MISSED_DOSE',
    );
    expect(
      `${sentPayload?.title ?? ''} ${sentPayload?.body ?? ''}`,
    ).not.toMatch(/patient-1|medicine|dolo|paracetamol/i);
  });

  it('queues one idempotent help request only for explicitly authorized caregivers', async () => {
    prisma.doseLog.findUnique.mockResolvedValue({
      id: 'dose-1',
      userId: 'patient-1',
      scheduledAt: new Date('2026-07-30T09:00:00.000Z'),
    });
    prisma.careRelationship.findMany.mockResolvedValue([
      { id: 'relationship-1' },
    ]);
    prisma.careEscalation.createMany.mockResolvedValue({ count: 1 });
    auditLogs.log.mockResolvedValue(undefined);

    await expect(
      service().requestDoseHelp('patient-1', 'dose-1', now),
    ).resolves.toEqual(
      expect.objectContaining({
        requested: true,
        eligibleCaregivers: 1,
        newlyQueued: 1,
        alreadyRequested: false,
      }),
    );
    expect(prisma.careRelationship.findMany).toHaveBeenCalledWith({
      where: {
        patientId: 'patient-1',
        status: CareRelationshipStatus.ACTIVE,
        permissions: { has: CarePermission.RECEIVE_DOSE_HELP_REQUESTS },
        patientConsentedAt: {
          lte: new Date('2026-07-30T09:00:00.000Z'),
        },
        OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
        caregiver: { isActive: true },
      },
      select: { id: true },
    });
    expect(prisma.careEscalation.createMany).toHaveBeenCalledWith({
      data: [
        {
          relationshipId: 'relationship-1',
          doseLogId: 'dose-1',
          kind: CareEscalationKind.DOSE_HELP_REQUEST,
          status: CareEscalationStatus.PENDING,
        },
      ],
      skipDuplicates: true,
    });
  });
});
