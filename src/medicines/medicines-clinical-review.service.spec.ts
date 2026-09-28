import { MedicinesService } from './medicines.service';

describe('MedicinesService clinical detail review', () => {
  const auditLogs = { log: jest.fn() };
  const resolver = { classify: jest.fn() };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('writes selected trusted source refs per clinical field and closes the request', async () => {
    let savedSaltData: any;
    const review: any = {
      id: 'review-1',
      type: 'MISSING_CLINICAL_DETAILS',
      status: 'OPEN',
      normalizedKey: 'missing-clinical:salt-1',
      source: null,
      strength: null,
      form: null,
      rawName: 'Azathioprine 50mg',
      gtin: null,
      userStripImageUrl: null,
      billLine: null,
      demandCount: 3,
      payload: { missingFields: ['Warnings'] },
      notes: 'Patient requested missing clinical details.',
      adminNotes: null,
      submittedBy: { id: 'user-1', email: 'patient@example.com', role: 'PATIENT' },
      reviewedBy: null,
      reviewedAt: null,
      createdAt: new Date('2026-07-07T00:00:00Z'),
      updatedAt: new Date('2026-07-07T00:00:00Z'),
      medicinePackage: null,
      medicineMaster: null,
      saltProfile: {
        id: 'salt-1',
        saltKey: 'azathioprine-50mg',
        displayName: 'Azathioprine 50mg',
        ingredients: [],
        uses: 'Existing sourced use text',
        howToTake: null,
        whenToTake: null,
        sideEffects: [],
        warnings: null,
        substitutes: [],
        storage: null,
        sourceRefs: {
          uses: [
            {
              sourceType: 'DailyMed',
              provider: 'DailyMed',
              field: 'uses',
              title: 'DailyMed label',
              url: 'https://dailymed.nlm.nih.gov/example',
              fetchedAt: '2026-07-07T00:00:00.000Z',
            },
          ],
        },
        enrichmentStatus: 'PARTIAL',
        patientExplanations: [],
        isVerified: false,
        language: 'en',
      },
    };

    const prisma = {
      medicineDataReview: {
        findUnique: jest.fn().mockResolvedValue(review),
        update: jest.fn().mockImplementation(async ({ data }) => ({
          ...review,
          ...data,
          reviewedBy: { id: 'admin-1', email: 'admin@example.com', role: 'ADMIN' },
          saltProfile: {
            ...review.saltProfile,
            ...savedSaltData,
            patientExplanations: [],
          },
        })),
      },
      saltProfile: {
        update: jest.fn().mockImplementation(async ({ data }) => {
          savedSaltData = data;
          return { ...review.saltProfile, ...data };
        }),
      },
    };
    const patientExplanation = { generateForSaltProfile: jest.fn().mockResolvedValue({}) };
    const service = new MedicinesService(
      prisma as any,
      auditLogs as any,
      resolver as any,
      undefined,
      patientExplanation as any,
    );

    const result = await service.updateReviewClinicalDetails('admin-1', 'review-1', {
      warnings: 'May increase infection risk. Regular monitoring may be needed.',
      sourceType: 'NFI_IPC',
      sourceTitle: 'National Formulary of India 2021 - Azathioprine monograph',
      sourceUrl: 'NFI 2021, Azathioprine monograph',
      adminNotes: 'Checked NFI warnings section.',
    });

    expect(prisma.saltProfile.update).toHaveBeenCalledWith({
      where: { id: 'salt-1' },
      data: expect.objectContaining({
        warnings: 'May increase infection risk. Regular monitoring may be needed.',
        source: 'ADMIN',
        enrichmentStatus: 'PARTIAL',
        sourceRefs: expect.objectContaining({
          uses: review.saltProfile.sourceRefs.uses,
          warnings: [
            expect.objectContaining({
              sourceType: 'NFI_IPC',
              provider: 'Indian Pharmacopoeia Commission',
              field: 'warnings',
              title: 'National Formulary of India 2021 - Azathioprine monograph',
              url: 'NFI 2021, Azathioprine monograph',
              adminUserId: 'admin-1',
              verifiedByAdmin: true,
            }),
          ],
        }),
      }),
    });
    expect(patientExplanation.generateForSaltProfile).toHaveBeenCalledWith('salt-1', {
      language: 'en',
      dryRun: false,
    });
    expect(prisma.medicineDataReview.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'review-1' },
        data: expect.objectContaining({
          status: 'VERIFIED',
          reviewedById: 'admin-1',
          adminNotes: 'Checked NFI warnings section.',
        }),
      }),
    );
    expect(result).toMatchObject({
      id: 'review-1',
      status: 'VERIFIED',
      saltProfile: {
        id: 'salt-1',
        warnings: 'May increase infection risk. Regular monitoring may be needed.',
      },
    });
  });
  it('queues a missing clinical detail request directly from a medicine master preview', async () => {
    const master: any = {
      id: 'master-1',
      brandName: 'A-Art',
      saltProfile: {
        id: 'salt-arteether',
        saltKey: 'arteether-150mg',
        displayName: 'Arteether 150mg',
        ingredients: [],
        uses: null,
        howToTake: null,
        warnings: null,
        storage: null,
        sideEffects: [],
        substitutes: [],
        sourceRefs: {},
        enrichmentStatus: 'NEEDS_SOURCE',
        patientExplanations: [],
        isVerified: false,
        language: 'en',
      },
      packages: [
        { id: 'pack-1', medicineId: 'master-1', isDemo: false, packSize: 'ampoule of 2 ml Injection' },
      ],
    };
    const prisma = {
      medicineMaster: {
        findFirst: jest.fn().mockResolvedValue(master),
      },
      medicineDataReview: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: 'review-1', demandCount: 1 }),
      },
    };
    const service = new MedicinesService(prisma as any, auditLogs as any, resolver as any);

    const result = await service.requestMasterClinicalDetails('user-1', 'master-1', 'pack-1');

    expect(result).toMatchObject({
      queued: true,
      alreadyAvailable: false,
      reviewId: 'review-1',
      demandCount: 1,
      missingFields: [
        'Why it may be prescribed',
        'How to take',
        'Warnings',
        'Storage',
        'Possible side effects',
      ],
    });
    expect(prisma.medicineDataReview.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        type: 'MISSING_CLINICAL_DETAILS',
        submittedById: 'user-1',
        medicineMasterId: 'master-1',
        medicinePackageId: 'pack-1',
        saltProfileId: 'salt-arteether',
        normalizedKey: 'missing-clinical:salt-arteether',
        rawName: 'Arteether 150mg',
        payload: expect.objectContaining({
          requestedFromMasterId: 'master-1',
          requestedFromBrandName: 'A-Art',
          missingFields: expect.arrayContaining(['Warnings']),
        }),
      }),
    });
  });
});
