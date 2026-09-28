import {
  NotificationChannel,
  NotificationDeliveryStatus,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { EmailNotificationService } from './email-notification.service';

function createPrismaMock() {
  return {
    user: { findUnique: jest.fn() },
    notificationLog: { findMany: jest.fn() },
    notificationDelivery: {
      upsert: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
      createMany: jest.fn(),
      updateMany: jest.fn(),
      update: jest.fn<Promise<unknown>, [unknown]>(),
    },
  };
}

function lastDeliveryUpdate(prisma: ReturnType<typeof createPrismaMock>) {
  return prisma.notificationDelivery.update.mock.calls.at(-1)?.[0];
}

describe('EmailNotificationService', () => {
  const originalEnv = { ...process.env };
  const originalFetch = global.fetch;

  beforeEach(() => {
    process.env.EMAIL_NOTIFICATIONS_ENABLED = 'true';
    process.env.BREVO_API_KEY = 'test-key';
    process.env.EMAIL_FROM_ADDRESS = 'verified@example.com';
    process.env.FRONTEND_URL = 'https://app.example.test';
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('sends a privacy-safe low-stock email and records provider acceptance', async () => {
    const prisma = createPrismaMock();
    prisma.notificationDelivery.upsert.mockResolvedValue({ id: 'delivery-1' });
    prisma.notificationDelivery.findUnique
      .mockResolvedValueOnce({
        id: 'delivery-1',
        status: NotificationDeliveryStatus.PENDING,
        attempts: 0,
        maxAttempts: 5,
      })
      .mockResolvedValueOnce({
        id: 'delivery-1',
        attempts: 1,
        maxAttempts: 5,
        notificationLog: {
          title: 'Low medicine stock',
          body: 'Only 2 doses of Dolo 650 remain.',
          metadata: { type: 'LOW_STOCK_ALERT', actionUrl: '/refills' },
          user: {
            email: 'patient@example.com',
            isActive: true,
            isVerified: true,
            notificationPreference: {
              emailEnabled: true,
              missedDoseEmails: false,
              refillEmails: true,
              includeMedicineNames: false,
            },
          },
        },
      });
    prisma.notificationDelivery.updateMany.mockResolvedValue({ count: 1 });
    prisma.notificationDelivery.update.mockResolvedValue({});
    const fetchMock = jest
      .fn<ReturnType<typeof fetch>, Parameters<typeof fetch>>()
      .mockResolvedValue(
        new Response(JSON.stringify({ messageId: 'brevo-1' }), {
          status: 201,
        }),
      );
    global.fetch = fetchMock;
    const service = new EmailNotificationService(
      prisma as unknown as PrismaService,
    );

    await expect(service.enqueueAndDeliver('log-1')).resolves.toMatchObject({
      status: 'SENT',
      providerMessageId: 'brevo-1',
    });
    const requestBody = fetchMock.mock.calls[0]?.[1]?.body;
    if (typeof requestBody !== 'string') {
      throw new Error('Expected a JSON request body');
    }
    const request: unknown = JSON.parse(requestBody);
    if (
      !request ||
      typeof request !== 'object' ||
      !('textContent' in request) ||
      typeof request.textContent !== 'string'
    ) {
      throw new Error('Expected textContent in the Brevo request');
    }
    expect(request.textContent).not.toContain('Dolo 650');
    expect(request.textContent).toContain('One of your medicines');
    expect(lastDeliveryUpdate(prisma)).toMatchObject({
      data: {
        status: NotificationDeliveryStatus.SENT,
        providerMessageId: 'brevo-1',
      },
    });
  });

  it('skips delivery when the verified user has not opted in', async () => {
    const prisma = createPrismaMock();
    prisma.notificationDelivery.upsert.mockResolvedValue({ id: 'delivery-1' });
    prisma.notificationDelivery.findUnique
      .mockResolvedValueOnce({
        id: 'delivery-1',
        status: NotificationDeliveryStatus.PENDING,
        attempts: 0,
        maxAttempts: 5,
      })
      .mockResolvedValueOnce({
        id: 'delivery-1',
        attempts: 1,
        maxAttempts: 5,
        notificationLog: {
          title: 'Care check-in requested',
          body: 'A person you support has a missed dose.',
          metadata: { type: 'CAREGIVER_MISSED_DOSE' },
          user: {
            email: 'caregiver@example.com',
            isActive: true,
            isVerified: true,
            notificationPreference: {
              emailEnabled: false,
              missedDoseEmails: false,
              refillEmails: false,
              includeMedicineNames: false,
            },
          },
        },
      });
    prisma.notificationDelivery.updateMany.mockResolvedValue({ count: 1 });
    prisma.notificationDelivery.update.mockResolvedValue({});
    const fetchMock = jest.fn<
      ReturnType<typeof fetch>,
      Parameters<typeof fetch>
    >();
    global.fetch = fetchMock;
    const service = new EmailNotificationService(
      prisma as unknown as PrismaService,
    );

    await expect(service.enqueueAndDeliver('log-1')).resolves.toMatchObject({
      status: 'SKIPPED',
      reason: 'NOT_ELIGIBLE',
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(lastDeliveryUpdate(prisma)).toMatchObject({
      data: {
        status: NotificationDeliveryStatus.SKIPPED,
      },
    });
  });

  it('records a bounded retry after a transient provider failure', async () => {
    const prisma = createPrismaMock();
    prisma.notificationDelivery.upsert.mockResolvedValue({ id: 'delivery-1' });
    prisma.notificationDelivery.findUnique
      .mockResolvedValueOnce({
        id: 'delivery-1',
        status: NotificationDeliveryStatus.PENDING,
        attempts: 0,
        maxAttempts: 5,
      })
      .mockResolvedValueOnce({
        id: 'delivery-1',
        attempts: 1,
        maxAttempts: 5,
        channel: NotificationChannel.EMAIL,
        notificationLog: {
          title: 'Email test',
          body: 'Email test body',
          metadata: { type: 'EMAIL_TEST' },
          user: {
            email: 'patient@example.com',
            isActive: true,
            isVerified: true,
            notificationPreference: {
              emailEnabled: true,
              missedDoseEmails: false,
              refillEmails: false,
              includeMedicineNames: false,
            },
          },
        },
      });
    prisma.notificationDelivery.updateMany.mockResolvedValue({ count: 1 });
    prisma.notificationDelivery.update.mockResolvedValue({});
    global.fetch = jest
      .fn<ReturnType<typeof fetch>, Parameters<typeof fetch>>()
      .mockRejectedValue(new TypeError('network unavailable'));
    const service = new EmailNotificationService(
      prisma as unknown as PrismaService,
    );

    await expect(service.enqueueAndDeliver('log-1')).resolves.toMatchObject({
      status: 'FAILED',
      reason: 'NETWORK_ERROR',
    });
    const update = lastDeliveryUpdate(prisma);
    expect(update).toMatchObject({
      data: {
        status: NotificationDeliveryStatus.FAILED,
        lastErrorCode: 'NETWORK_ERROR',
      },
    });
    if (
      !update ||
      typeof update !== 'object' ||
      !('data' in update) ||
      !update.data ||
      typeof update.data !== 'object' ||
      !('nextAttemptAt' in update.data)
    ) {
      throw new Error('Expected retry scheduling data');
    }
    expect(update.data.nextAttemptAt).toBeInstanceOf(Date);
  });
});
