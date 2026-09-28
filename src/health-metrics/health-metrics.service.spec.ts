import { PrismaService } from '../prisma/prisma.service';
import {
  NotificationsService,
  type SendNotificationParams,
} from '../notifications/notifications.service';
import { HealthMetricsService } from './health-metrics.service';
import { HealthObservationValidatorService } from './health-observation-validator.service';
import { HealthSafetyRulesService } from './health-safety-rules.service';

describe('HealthMetricsService hardened ingestion', () => {
  const createMetric = jest.fn(({ data }: { data: Record<string, unknown> }) =>
    Promise.resolve({
      id: 'metric-1',
      createdAt: new Date(),
      updatedAt: new Date(),
      ...data,
    }),
  );
  const findUniqueMetric = jest.fn<Promise<{ id: string } | null>, [unknown]>();
  const findFirstMetric = jest.fn<Promise<{ id: string } | null>, [unknown]>();
  const findManyMetric = jest.fn<
    Promise<Array<Record<string, unknown>>>,
    [unknown]
  >();
  const updateMetric = jest.fn<Promise<{ id: string }>, [unknown]>();
  const sendNotification = jest.fn((params: SendNotificationParams) => {
    void params;
    return Promise.resolve({
      id: 'notification-1',
      userId: 'user-1',
      title: 'Health alert',
      body: 'Review a reading',
      channel: 'LOCAL' as const,
      sentAt: new Date(),
    });
  });

  const prisma = {
    healthMetric: {
      create: createMetric,
      findUnique: findUniqueMetric,
      findFirst: findFirstMetric,
      findMany: findManyMetric,
      update: updateMetric,
    },
  } as unknown as PrismaService;
  const notifications = {
    send: sendNotification,
  } as unknown as NotificationsService;

  beforeEach(() => {
    jest.clearAllMocks();
    findUniqueMetric.mockResolvedValue(null);
    findFirstMetric.mockResolvedValue(null);
    findManyMetric.mockResolvedValue([]);
    updateMetric.mockResolvedValue({ id: 'metric-1' });
  });

  function createService() {
    return new HealthMetricsService(
      prisma,
      notifications,
      new HealthObservationValidatorService(),
      new HealthSafetyRulesService(),
    );
  }

  it('ignores a client-provided trusted source on the manual endpoint', async () => {
    await createService().create('user-1', {
      metricType: 'HEART_RATE',
      value: { heartRate: 72, context: 'RESTING' },
      recordedAt: '2026-01-14T10:00:00.000Z',
      source: 'BLUETOOTH_REAL',
    });

    const data = createMetric.mock.calls[0][0].data;
    expect(data.source).toBe('MANUAL');
    expect(data.quality).toBe('USER_REPORTED');
  });

  it('returns an existing record when a stable client record ID is replayed', async () => {
    const existing = { id: 'existing-metric' };
    findUniqueMetric.mockResolvedValue(existing);

    const result = await createService().create('user-1', {
      metricType: 'BLOOD_GLUCOSE',
      value: { glucose: 100, mealStatus: 'RANDOM' },
      recordedAt: '2026-01-14T10:00:00.000Z',
      clientRecordId: 'meter-record-42',
    });

    expect(result).toBe(existing);
    expect(createMetric).not.toHaveBeenCalled();
  });

  it('marks self-registered devices questionable and suppresses medical alerts', async () => {
    await createService().createFromDevice(
      'user-1',
      { id: 'device-1', trustLevel: 'UNVERIFIED' },
      {
        metricType: 'OXYGEN_SATURATION',
        value: { oxygenSaturation: 70 },
      },
    );

    const data = createMetric.mock.calls[0][0].data;
    expect(data.source).toBe('UNVERIFIED_DEVICE');
    expect(data.quality).toBe('QUESTIONABLE');
    expect(data.safetyAssessment).toEqual(
      expect.objectContaining({ status: 'VERIFY_READING' }),
    );
    expect(sendNotification).not.toHaveBeenCalled();
  });

  it('keeps lock-screen alert text free of the measurement value', async () => {
    await createService().create('user-1', {
      metricType: 'BLOOD_PRESSURE',
      value: { systolic: 190, diastolic: 125 },
      recordedAt: '2026-01-14T10:00:00.000Z',
    });

    expect(sendNotification).toHaveBeenCalledTimes(1);
    const notification = sendNotification.mock.calls[0][0];
    expect(notification.body).not.toContain('190');
    expect(notification.body).not.toContain('125');
    expect(notification.metadata?.ruleVersion).toBe('wellness-triage-v1');
  });

  it('imports Health Connect provenance as untrusted until app attestation exists', async () => {
    const result = await createService().importHealthConnectBatch('user-1', [
      {
        metricType: 'OXYGEN_SATURATION',
        value: { oxygenSaturation: 82 },
        recordedAt: '2026-01-14T10:00:00.000Z',
        unit: '%',
        clientRecordId: 'hc:record-1',
        originPackage: 'com.example.healthdevice',
        timezoneOffsetMinutes: 330,
      },
    ]);

    expect(result).toEqual(
      expect.objectContaining({
        received: 1,
        imported: 1,
        duplicates: 0,
        rejected: 0,
      }),
    );
    const data = createMetric.mock.calls[0][0].data;
    expect(data.source).toBe('HEALTH_CONNECT');
    expect(data.quality).toBe('QUESTIONABLE');
    expect(data.qualityFlags).toEqual(['UNATTESTED_MOBILE_CLIENT']);
    expect(data.sourceMetadata).toEqual({
      originPackage: 'com.example.healthdevice',
    });
    expect(data.safetyAssessment).toEqual(
      expect.objectContaining({ status: 'VERIFY_READING' }),
    );
    expect(sendNotification).not.toHaveBeenCalled();
  });

  it('reports an empty Health Connect batch without inventing readings', async () => {
    const result = await createService().importHealthConnectBatch('user-1', []);

    expect(result).toEqual({
      received: 0,
      imported: 0,
      duplicates: 0,
      rejected: 0,
      results: [],
    });
    expect(createMetric).not.toHaveBeenCalled();
  });

  it('reports duplicate and invalid Health Connect records without failing the batch', async () => {
    findUniqueMetric
      .mockResolvedValueOnce({ id: 'existing-health-connect-metric' })
      .mockResolvedValueOnce(null);

    const result = await createService().importHealthConnectBatch('user-1', [
      {
        metricType: 'HEART_RATE',
        value: { heartRate: 70 },
        recordedAt: '2026-01-14T10:00:00.000Z',
        unit: 'bpm',
        clientRecordId: 'hc:existing',
        originPackage: 'com.example.watch',
      },
      {
        metricType: 'BLOOD_PRESSURE',
        value: { systolic: 70, diastolic: 90 },
        recordedAt: '2026-01-14T10:01:00.000Z',
        unit: 'mmHg',
        clientRecordId: 'hc:invalid',
        originPackage: 'com.example.cuff',
      },
    ]);

    expect(result.duplicates).toBe(1);
    expect(result.rejected).toBe(1);
    expect(result.results.map((item) => item.status)).toEqual([
      'DUPLICATE',
      'REJECTED',
    ]);
    expect(createMetric).not.toHaveBeenCalled();
  });

  it('aggregates daily trends and keeps questionable-reading counts visible', async () => {
    findManyMetric.mockResolvedValue([
      {
        id: 'metric-1',
        recordedAt: '2026-01-01T23:30:00.000Z',
        timezoneOffsetMinutes: 330,
        value: { heartRate: 70 },
        quality: 'QUESTIONABLE',
      },
      {
        id: 'metric-2',
        recordedAt: '2026-01-02T08:00:00.000Z',
        timezoneOffsetMinutes: 330,
        value: { heartRate: 80 },
        quality: 'USER_REPORTED',
      },
      {
        id: 'metric-3',
        recordedAt: '2026-01-03T08:00:00.000Z',
        timezoneOffsetMinutes: 330,
        value: { heartRate: 82 },
        quality: 'USER_REPORTED',
      },
    ]);

    const result = await createService().getTrend('user-1', 'HEART_RATE', 14);

    expect(result.totalReadings).toBe(3);
    expect(result.questionableReadings).toBe(1);
    expect(result.qualityScope).toBe('ALL');
    expect(result.points).toEqual([
      expect.objectContaining({ date: '2026-01-02', average: 75, count: 2 }),
      expect.objectContaining({ date: '2026-01-03', average: 82, count: 1 }),
    ]);
    expect(result.direction).toBe('INSUFFICIENT_DATA');
  });

  it('requests only trusted readings for clinical or AI trend consumers', async () => {
    findManyMetric.mockResolvedValue([
      {
        id: 'metric-trusted',
        recordedAt: '2026-01-02T08:00:00.000Z',
        timezoneOffsetMinutes: 330,
        value: { heartRate: 80 },
        quality: 'USER_REPORTED',
      },
    ]);

    const result = await createService().getTrend(
      'user-1',
      'HEART_RATE',
      14,
      'TRUSTED_ONLY',
    );

    expect(findManyMetric.mock.calls[0]?.[0]).toMatchObject({
      where: {
        quality: { not: 'QUESTIONABLE' },
      },
    });
    expect(result.qualityScope).toBe('TRUSTED_ONLY');
    expect(result.questionableReadings).toBe(0);
  });
});
