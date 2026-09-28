import { PhoneNotificationService } from './phone-notification.service';

describe('PhoneNotificationService', () => {
  const originalEnv = process.env;
  const prisma = {
    user: {
      findUnique: jest.fn(),
    },
  } as any;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env = { ...originalEnv };
    delete process.env.PHONE_NOTIFICATIONS_ENABLED;
    delete process.env.PHONE_NOTIFICATION_PROVIDER;
    delete process.env.PHONE_NOTIFICATION_DEFAULT_COUNTRY_CODE;
    delete process.env.PHONE_NOTIFICATION_REQUIRE_VERIFIED_USER;
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('skips without looking up the user when phone notifications are disabled', async () => {
    const service = new PhoneNotificationService(prisma);

    const result = await service.sendToUser({
      userId: 'user-1',
      title: 'Test',
      body: 'Test body',
      metadata: { type: 'PHONE_TEST' },
    });

    expect(result.status).toBe('SKIPPED');
    expect(result.reason).toContain('disabled');
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });

  it('sends through the console provider to the registered phone', async () => {
    process.env.PHONE_NOTIFICATIONS_ENABLED = 'true';
    process.env.PHONE_NOTIFICATION_PROVIDER = 'console';
    process.env.PHONE_NOTIFICATION_DEFAULT_COUNTRY_CODE = '+91';
    prisma.user.findUnique.mockResolvedValue({
      phone: '9876543210',
      isActive: true,
      isVerified: false,
    });

    const service = new PhoneNotificationService(prisma);
    const result = await service.sendToUser({
      userId: 'user-1',
      title: 'Reminder',
      body: 'Dolo 650 - 1 tablet scheduled for 08:00 AM',
      metadata: { type: 'DOSE_REMINDER', doseTime: '08:00 AM' },
    });

    expect(result.status).toBe('SENT');
    expect(result.provider).toBe('console');
    expect(result.recipientMasked).toBe('+91***210');
  });

  it('skips unverified users when the verified-user guard is enabled', async () => {
    process.env.PHONE_NOTIFICATIONS_ENABLED = 'true';
    process.env.PHONE_NOTIFICATION_REQUIRE_VERIFIED_USER = 'true';
    prisma.user.findUnique.mockResolvedValue({
      phone: '+919876543210',
      isActive: true,
      isVerified: false,
    });

    const service = new PhoneNotificationService(prisma);
    const result = await service.sendToUser({
      userId: 'user-1',
      title: 'Reminder',
      body: 'Reminder body',
      metadata: { type: 'DOSE_REMINDER' },
    });

    expect(result.status).toBe('SKIPPED');
    expect(result.reason).toContain('not verified');
  });
});
