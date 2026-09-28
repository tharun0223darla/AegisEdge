import { MedicinesService } from './medicines.service';

describe('MedicinesService barcode capture', () => {
  const auditLogs = { log: jest.fn() };
  const resolver = { classify: jest.fn() };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('looks up a verified GTIN deterministically and returns the package', async () => {
    const pack: any = {
      id: 'pack-1',
      medicineId: 'master-1',
      gtin: '8901234567890',
      barcodeType: 'GTIN_13',
      packSize: 'strip of 15',
      isDemo: false,
      isVerified: true,
      medicine: {
        id: 'master-1',
        brandName: 'Dolo 650',
        genericName: 'Paracetamol',
        composition: 'Paracetamol 650mg',
        strength: '650mg',
        manufacturer: 'Micro Labs',
        type: 'tablet',
        isArchived: false,
        packages: [],
        saltProfile: null,
      },
    };
    pack.medicine.packages = [pack];
    const prisma = {
      medicinePackage: {
        findMany: jest.fn().mockResolvedValue([pack]),
      },
    };
    const service = new MedicinesService(prisma as any, auditLogs as any, resolver as any);

    const result = await service.findByBarcode('8901234567890');

    expect(prisma.medicinePackage.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          gtin: '8901234567890',
          isDemo: false,
          isVerified: true,
        }),
      }),
    );
    expect(resolver.classify).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      found: true,
      gtin: '8901234567890',
      master: { id: 'master-1', brandName: 'Dolo 650' },
      package: { id: 'pack-1', gtin: '8901234567890' },
      packages: [
        {
          master: { id: 'master-1', brandName: 'Dolo 650' },
          package: { id: 'pack-1', gtin: '8901234567890' },
        },
      ],
    });
  });

  it('queues an unknown GTIN for admin review with the raw code stored', async () => {
    const prisma = {
      medicineDataReview: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: 'review-1' }),
      },
    };
    const service = new MedicinesService(prisma as any, auditLogs as any, resolver as any);

    const result = await service.reportUnknownBarcode('user-1', ' 8900000000001 ', {
      userStripImageUrl: '/uploads/review/photo.jpg',
    });

    expect(result).toEqual({
      queued: true,
      gtin: '8900000000001',
      message: 'Unknown barcode queued for admin verification.',
    });
    expect(prisma.medicineDataReview.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        type: 'UNKNOWN_BARCODE',
        submittedById: 'user-1',
        normalizedKey: 'barcode:8900000000001',
        source: 'BARCODE',
        gtin: '8900000000001',
        userStripImageUrl: '/uploads/review/photo.jpg',
      }),
    });
  });
});
