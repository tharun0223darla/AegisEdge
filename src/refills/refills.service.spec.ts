import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { PrismaService } from '../prisma/prisma.service';
import { RefillsService } from './refills.service';

describe('RefillsService deterministic stock forecast', () => {
  const findMany = jest.fn<
    Promise<Array<Record<string, unknown>>>,
    [unknown]
  >();
  const prisma = {
    medicine: { findMany },
  } as unknown as PrismaService;
  const auditLogs = {
    log: jest.fn(),
  } as unknown as AuditLogsService;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('uses active schedules before refill-history estimates', async () => {
    findMany.mockResolvedValue([
      {
        id: 'medicine-1',
        name: 'Dolo 650',
        form: 'TABLET',
        strength: '650mg',
        unit: 'tablets',
        remainingQuantity: 20,
        totalQuantity: 30,
        refillThreshold: 5,
        schedules: [
          {
            frequency: 'DAILY',
            timesOfDay: ['08:00', '20:00'],
            daysOfWeek: [],
            startDate: new Date('2026-01-01T00:00:00.000Z'),
            endDate: null,
            dosesPerIntake: 1,
          },
        ],
        refillLogs: [
          {
            dailyUsage: 1,
            expectedFinishDate: new Date('2026-08-01T00:00:00.000Z'),
            refillReminderDate: new Date('2026-07-27T00:00:00.000Z'),
            totalQuantity: 30,
            createdAt: new Date('2026-07-01T00:00:00.000Z'),
          },
        ],
      },
    ]);

    const [forecast] = await new RefillsService(
      prisma,
      auditLogs,
    ).getStockSummary('user-1');

    expect(forecast).toMatchObject({
      medicineName: 'Dolo 650',
      dailyUsage: 2,
      estimatedDaysRemaining: 10,
      stockStatus: 'ADEQUATE',
      needsRefill: false,
      forecastBasis: 'ACTIVE_SCHEDULE',
      forecastConfidence: 'SCHEDULE_BASED',
      pharmacySearchQuery: 'Dolo 650 tablet',
      lastRefillDate: '2026-07-01',
    });
  });

  it('falls back to refill history when no predictable schedule exists', async () => {
    findMany.mockResolvedValue([
      {
        id: 'medicine-2',
        name: 'SOS medicine',
        form: 'TABLET',
        strength: null,
        unit: 'tablets',
        remainingQuantity: 6,
        totalQuantity: 10,
        refillThreshold: null,
        schedules: [
          {
            frequency: 'AS_NEEDED',
            timesOfDay: [],
            daysOfWeek: [],
            startDate: new Date('2026-01-01T00:00:00.000Z'),
            endDate: null,
            dosesPerIntake: 1,
          },
        ],
        refillLogs: [
          {
            dailyUsage: 1,
            expectedFinishDate: new Date('2026-08-01T00:00:00.000Z'),
            refillReminderDate: new Date('2026-07-27T00:00:00.000Z'),
            totalQuantity: 10,
            createdAt: new Date('2026-07-10T00:00:00.000Z'),
          },
        ],
      },
    ]);

    const [forecast] = await new RefillsService(
      prisma,
      auditLogs,
    ).getStockSummary('user-1');

    expect(forecast).toMatchObject({
      dailyUsage: 1,
      estimatedDaysRemaining: 6,
      stockStatus: 'LOW',
      needsRefill: true,
      forecastBasis: 'REFILL_HISTORY',
      forecastConfidence: 'HISTORY_BASED',
    });
  });

  it('does not invent a finish date when usage is unknown', async () => {
    findMany.mockResolvedValue([
      {
        id: 'medicine-3',
        name: 'Unscheduled medicine',
        form: 'CAPSULE',
        strength: '100mg',
        unit: 'capsules',
        remainingQuantity: 12,
        totalQuantity: 20,
        refillThreshold: null,
        schedules: [],
        refillLogs: [],
      },
    ]);

    const [forecast] = await new RefillsService(
      prisma,
      auditLogs,
    ).getStockSummary('user-1');

    expect(forecast).toMatchObject({
      dailyUsage: null,
      estimatedDaysRemaining: null,
      estimatedFinishDate: null,
      suggestedRefillDate: null,
      stockStatus: 'UNKNOWN',
      needsRefill: false,
      forecastBasis: 'NONE',
      forecastConfidence: 'LIMITED',
    });
  });

  it('treats missing stock as unknown instead of out of stock', async () => {
    findMany.mockResolvedValue([
      {
        id: 'medicine-4',
        name: 'Stock not entered',
        form: 'TABLET',
        strength: null,
        unit: 'tablets',
        remainingQuantity: null,
        totalQuantity: null,
        refillThreshold: 5,
        schedules: [
          {
            frequency: 'DAILY',
            timesOfDay: ['08:00'],
            daysOfWeek: [],
            startDate: new Date('2026-01-01T00:00:00.000Z'),
            endDate: null,
            dosesPerIntake: 1,
          },
        ],
        refillLogs: [],
      },
    ]);

    const [forecast] = await new RefillsService(
      prisma,
      auditLogs,
    ).getStockSummary('user-1');

    expect(forecast).toMatchObject({
      remainingQuantity: null,
      estimatedDaysRemaining: null,
      stockStatus: 'UNKNOWN',
      needsRefill: false,
    });
  });

  it('returns only allowlisted verified product links and labels searches separately', async () => {
    const checkedAt = new Date();
    findMany.mockResolvedValue([
      {
        id: 'medicine-5',
        medicinePackageId: 'package-15',
        medicinePackage: { id: 'package-15', packSize: 'strip of 15 tablets' },
        name: 'Dolo 650',
        form: 'TABLET',
        strength: '650mg',
        unit: 'tablets',
        remainingQuantity: 10,
        totalQuantity: 15,
        refillThreshold: 5,
        schedules: [],
        refillLogs: [],
        medicineMaster: {
          brandName: 'Dolo 650',
          composition: 'Paracetamol 650mg',
          manufacturer: 'Micro Labs Ltd',
          strength: '650mg',
          purchaseLinks: [
            {
              provider: 'TATA_1MG',
              productUrl: 'https://www.1mg.com/drugs/dolo-650mg-tablet-74467',
              verifiedAt: checkedAt,
              lastCheckedAt: checkedAt,
              medicinePackage: {
                id: 'package-15',
                packSize: 'strip of 15 tablets',
              },
            },
            {
              provider: 'PHARMEASY',
              productUrl: 'https://pharmeasy.in.attacker.example/dolo',
              verifiedAt: checkedAt,
              lastCheckedAt: checkedAt,
              medicinePackage: null,
            },
          ],
        },
      },
    ]);

    const [forecast] = await new RefillsService(
      prisma,
      auditLogs,
    ).getStockSummary('user-1');

    expect(forecast.purchaseOptions).toEqual([
      {
        provider: 'TATA_1MG',
        providerLabel: 'Tata 1mg',
        url: 'https://www.1mg.com/drugs/dolo-650mg-tablet-74467',
        matchType: 'VERIFIED_PRODUCT',
        queryPrefilled: true,
        packSize: 'strip of 15 tablets',
        verifiedAt: checkedAt.toISOString().slice(0, 10),
        matchScope: 'PACKAGE',
      },
      expect.objectContaining({
        provider: 'PHARMEASY',
        matchType: 'PROVIDER_SEARCH',
      }),
      expect.objectContaining({
        provider: 'NETMEDS',
        matchType: 'PROVIDER_SEARCH',
      }),
      expect.objectContaining({
        provider: 'APOLLO',
        matchType: 'PROVIDER_SEARCH',
        queryPrefilled: true,
        matchScope: null,
      }),
      expect.objectContaining({
        provider: 'MEDPLUS',
        matchType: 'PROVIDER_SEARCH',
        queryPrefilled: false,
        matchScope: null,
      }),
    ]);
    expect(forecast.pharmacyIdentity).toEqual({
      brandName: 'Dolo 650',
      composition: 'Paracetamol 650mg',
      manufacturer: 'Micro Labs Ltd',
      packSize: 'strip of 15 tablets',
      identityLevel: 'PACKAGE',
    });
    expect(
      forecast.purchaseOptions.some((option: { url: string }) =>
        option.url.includes('attacker.example'),
      ),
    ).toBe(false);
  });

  it('does not expose stale or different-package links as verified', async () => {
    const recent = new Date();
    const stale = new Date(Date.now() - 181 * 24 * 60 * 60 * 1000);
    findMany.mockResolvedValue([
      {
        id: 'medicine-6',
        medicinePackageId: 'package-10',
        medicinePackage: { id: 'package-10', packSize: 'strip of 10 tablets' },
        name: 'Dolo 650',
        form: 'TABLET',
        strength: '650mg',
        unit: 'tablets',
        remainingQuantity: 5,
        totalQuantity: 10,
        refillThreshold: 2,
        schedules: [],
        refillLogs: [],
        medicineMaster: {
          brandName: 'Dolo 650',
          composition: 'Paracetamol 650mg',
          manufacturer: 'Micro Labs Ltd',
          strength: '650mg',
          purchaseLinks: [
            {
              provider: 'TATA_1MG',
              productUrl: 'https://www.1mg.com/drugs/dolo-650mg-tablet-74467',
              verifiedAt: recent,
              lastCheckedAt: recent,
              medicinePackage: {
                id: 'package-15',
                packSize: 'strip of 15 tablets',
              },
            },
            {
              provider: 'APOLLO',
              productUrl:
                'https://www.apollopharmacy.in/otc/dolo-650mg-tablet-15-s',
              verifiedAt: stale,
              lastCheckedAt: stale,
              medicinePackage: null,
            },
          ],
        },
      },
    ]);

    const [forecast] = await new RefillsService(
      prisma,
      auditLogs,
    ).getStockSummary('user-1');

    expect(
      forecast.purchaseOptions.every(
        (option: { matchType: string }) =>
          option.matchType === 'PROVIDER_SEARCH',
      ),
    ).toBe(true);
  });
});
