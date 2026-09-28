import { MedicinesService } from './medicines.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { AuditLogsService } from '../audit-logs/audit-logs.service';
import type { MedicineResolverService } from './capture/medicine-resolver.service';

type MasterSearchResult = Awaited<
  ReturnType<MedicinesService['searchMaster']>
>[number];

type PackageSearchAccess = {
  searchMasterByCompositionIngredients: (
    ingredients: string[],
    limit: number,
  ) => Promise<MasterSearchResult[]>;
};

function master(overrides: Record<string, unknown>) {
  return {
    id: String(overrides.id),
    brandName: String(overrides.brandName),
    normalizedName: String(overrides.brandName ?? '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ''),
    genericName: null,
    composition: null,
    strength: null,
    manufacturer: null,
    type: 'tablet',
    isDiscontinued: false,
    prescriptionRequired: true,
    saltProfileId: null,
    saltProfile: null,
    packages: [],
    ...overrides,
  };
}

describe('MedicinesService master search relevance', () => {
  const auditLogs = { log: jest.fn() };
  const resolver = { classify: jest.fn() };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('ranks exact salt/composition matches above fuzzy brand matches for molecule queries', async () => {
    const ruxolitinibSalts = [
      { id: 'salt-rux-5' },
      { id: 'salt-rux-10' },
      { id: 'salt-rux-15' },
      { id: 'salt-rux-20' },
    ];
    const jakaviRows = [
      master({
        id: 'jakavi-5',
        brandName: 'JakAVI 5mg',
        composition: 'Ruxolitinib (5mg)',
        manufacturer: 'Novartis India Ltd',
        saltProfileId: 'salt-rux-5',
        saltProfile: {
          id: 'salt-rux-5',
          saltKey: 'ruxolitinib-5mg',
          displayName: 'Ruxolitinib 5mg',
          ingredients: [
            { ingredient: 'ruxolitinib', strength: '5', unit: 'mg' },
          ],
        },
      }),
      master({
        id: 'jakavi-10',
        brandName: 'JakAVI 10mg',
        composition: 'Ruxolitinib (10mg)',
        manufacturer: 'Novartis India Ltd',
        saltProfileId: 'salt-rux-10',
        saltProfile: {
          id: 'salt-rux-10',
          saltKey: 'ruxolitinib-10mg',
          displayName: 'Ruxolitinib 10mg',
          ingredients: [
            { ingredient: 'ruxolitinib', strength: '10', unit: 'mg' },
          ],
        },
      }),
      master({
        id: 'jakavi-15',
        brandName: 'JakAVI 15mg',
        composition: 'Ruxolitinib (15mg)',
        manufacturer: 'Novartis India Ltd',
        saltProfileId: 'salt-rux-15',
        saltProfile: {
          id: 'salt-rux-15',
          saltKey: 'ruxolitinib-15mg',
          displayName: 'Ruxolitinib 15mg',
          ingredients: [
            { ingredient: 'ruxolitinib', strength: '15', unit: 'mg' },
          ],
        },
      }),
      master({
        id: 'jakavi-20',
        brandName: 'JakAVI 20mg',
        composition: 'Ruxolitinib (20mg)',
        manufacturer: 'Novartis India Ltd',
        saltProfileId: 'salt-rux-20',
        saltProfile: {
          id: 'salt-rux-20',
          saltKey: 'ruxolitinib-20mg',
          displayName: 'Ruxolitinib 20mg',
          ingredients: [
            { ingredient: 'ruxolitinib', strength: '20', unit: 'mg' },
          ],
        },
      }),
    ];
    const fuzzyBrandRows = [
      master({
        id: 'ruxocap',
        brandName: 'Ruxocap',
        composition: 'Indomethacin (25mg)',
        saltProfile: {
          id: 'salt-indomethacin',
          saltKey: 'indomethacin-25mg',
          displayName: 'Indomethacin 25mg',
          ingredients: [
            { ingredient: 'indomethacin', strength: '25', unit: 'mg' },
          ],
        },
      }),
      master({
        id: 'ruxomet',
        brandName: 'Ruxomet',
        composition: 'Metformin (500mg)',
        saltProfile: {
          id: 'salt-metformin',
          saltKey: 'metformin-500mg',
          displayName: 'Metformin 500mg',
          ingredients: [
            { ingredient: 'metformin', strength: '500', unit: 'mg' },
          ],
        },
      }),
    ];
    const prisma = {
      saltProfile: {
        findMany: jest.fn().mockResolvedValue(ruxolitinibSalts),
      },
      medicineMaster: {
        findMany: jest
          .fn()
          .mockResolvedValueOnce(jakaviRows)
          .mockResolvedValueOnce(fuzzyBrandRows),
      },
    };
    const enrichmentQueue = { enqueueSaltProfiles: jest.fn() };
    const service = new MedicinesService(
      prisma as any,
      auditLogs as any,
      resolver as any,
      enrichmentQueue as any,
    );

    const results = await service.searchMaster('ruxolitinib', 6);

    expect(results.slice(0, 4).map((result) => result.brandName)).toEqual([
      'JakAVI 10mg',
      'JakAVI 15mg',
      'JakAVI 20mg',
      'JakAVI 5mg',
    ]);
    expect(
      results
        .slice(0, 4)
        .every((result) => result.matchReason === 'composition'),
    ).toBe(true);
    expect(
      results
        .slice(0, 4)
        .every((result) => result.composition?.includes('Ruxolitinib')),
    ).toBe(true);

    const ruxocapIndex = results.findIndex(
      (result) => result.brandName === 'Ruxocap',
    );
    const ruxometIndex = results.findIndex(
      (result) => result.brandName === 'Ruxomet',
    );
    expect(ruxocapIndex === -1 || ruxocapIndex > 3).toBe(true);
    expect(ruxometIndex === -1 || ruxometIndex > 3).toBe(true);
  });

  it('never promotes a composition-only package match as the photographed brand', async () => {
    const compositionMatch = {
      ...master({
        id: 'a2b-h',
        brandName: 'A2B H',
        composition: 'Amlodipine + Valsartan + Hydrochlorothiazide',
      }),
      score: 0.99,
      matchReason: 'composition',
    } as unknown as MasterSearchResult;
    const classify = jest
      .fn()
      .mockReturnValue({ kind: 'UNKNOWN', needsConfirm: true });
    const service = new MedicinesService(
      {} as unknown as PrismaService,
      {} as unknown as AuditLogsService,
      { classify } as unknown as MedicineResolverService,
      undefined,
    );
    const searchMaster = jest
      .spyOn(service, 'searchMaster')
      .mockResolvedValue([compositionMatch]);
    jest
      .spyOn(
        service as unknown as PackageSearchAccess,
        'searchMasterByCompositionIngredients',
      )
      .mockResolvedValue([compositionMatch]);

    const result = await service.resolvePackageImageCandidate(
      {
        rawName: 'NOFORGEHCT',
        extractedStrength: '10mg/160mg/25mg',
        extractedPack: '10 Film coated tablets',
        ocrConfidence: 0.78,
        weak: false,
        fullText: '',
        allLines: [],
        alternatives: [],
        composition: {
          displayName: 'Amlodipine + Valsartan + Hydrochlorothiazide',
          ingredients: ['Amlodipine', 'Valsartan', 'Hydrochlorothiazide'],
          rawLine: '',
          sourceLines: [],
          confidence: 0.99,
          searchTerms: [],
        },
      },
      '/api/medicines/package-image/example.jpg',
    );

    expect(classify).toHaveBeenCalledWith(
      expect.objectContaining({ possibleMasterMatches: [] }),
    );
    expect(searchMaster).toHaveBeenCalledWith('NOFORGEHCT', 6, {
      enqueueEnrichment: false,
    });
    expect(result.resolverOutcome.kind).toBe('UNKNOWN');
    expect(result.confidence).toBe(0);
  });

  it('selects a database-backed alternate OCR brand instead of the first noisy line', async () => {
    const expectedMatch = {
      ...master({
        id: 'novel-brand',
        brandName: 'Novelyxa 40',
        composition: 'Fictizole 40mg',
        strength: '40mg',
      }),
      score: 0.98,
      matchReason: 'brand',
    } as unknown as MasterSearchResult;
    const classify = jest
      .fn()
      .mockReturnValue({ kind: 'STRONG', needsConfirm: true });
    const service = new MedicinesService(
      {} as unknown as PrismaService,
      {} as unknown as AuditLogsService,
      { classify } as unknown as MedicineResolverService,
      undefined,
    );
    jest
      .spyOn(service, 'searchMaster')
      .mockImplementation((query) =>
        Promise.resolve(
          query.toLowerCase().includes('novely') ? [expectedMatch] : [],
        ),
      );

    const result = await service.resolvePackageImageCandidate(
      {
        rawName: 'MANUFACTURED FOR',
        ocrLine: 'MANUFACTURED FOR',
        extractedStrength: '40mg',
        ocrConfidence: 0.72,
        weak: false,
        fullText: '',
        allLines: [],
        brandCandidates: [
          {
            name: 'MANUFACTURED FOR',
            ocrLine: 'MANUFACTURED FOR',
            confidence: 0.8,
            parserScore: 0.75,
          },
          {
            name: 'NOVELYA 40',
            ocrLine: 'NOVELYA 40',
            confidence: 0.72,
            parserScore: 0.68,
          },
        ],
      },
      '/api/medicines/package-image/unseen.jpg',
    );

    expect(result.rawName).toBe('Novelyxa 40');
    expect(result.displayName).toBe('Novelyxa 40');
    expect(result.resolverOutcome.kind).toBe('STRONG');
    expect(classify).toHaveBeenCalledWith(
      expect.objectContaining({
        rawName: 'NOVELYA 40',
        possibleMasterMatches: [{ masterId: 'novel-brand', score: 0.98 }],
      }),
    );
  });

  it('matches tokenized brand and strength even when OCR extracted combined token and master has separated fields', async () => {
    const tolperitasMaster = master({
      id: 'tolp-150',
      brandName: 'Tolperitas',
      strength: '150mg',
      composition: 'Tolperisone (150mg)',
      manufacturer: 'Intas Pharmaceuticals Ltd',
    });

    const prisma = {
      medicineMaster: {
        findMany: jest.fn().mockResolvedValue([tolperitasMaster]),
      },
      saltProfile: {
        findMany: jest.fn().mockResolvedValue([]),
      },
    } as unknown as PrismaService;

    const enrichmentQueue = { enqueueSaltProfiles: jest.fn() };
    const service = new MedicinesService(
      prisma,
      auditLogs as unknown as AuditLogsService,
      resolver as unknown as MedicineResolverService,
      enrichmentQueue as any,
    );

    const matches = await service.searchMaster('Tolperitas 150', 6);
    expect(matches.length).toBeGreaterThan(0);
    expect(matches[0].id).toBe('tolp-150');
    expect(matches[0].score).toBe(1);
  });

  it('matches master medicine with high confidence when OCR has letter substitution/homoglyph typo', async () => {
    const doxolinMaster = master({
      id: 'dox-400',
      brandName: 'DOXOLIN',
      strength: '400mg',
      composition: 'Doxofylline (400mg)',
      manufacturer: 'German Remedies',
    });

    const prisma = {
      medicineMaster: {
        findMany: jest.fn().mockResolvedValue([doxolinMaster]),
      },
      saltProfile: {
        findMany: jest.fn().mockResolvedValue([]),
      },
    } as unknown as PrismaService;

    const enrichmentQueue = { enqueueSaltProfiles: jest.fn() };
    const service = new MedicinesService(
      prisma,
      auditLogs as unknown as AuditLogsService,
      resolver as unknown as MedicineResolverService,
      enrichmentQueue as any,
    );

    // OCR reads zero instead of O: D0XOLIN 400
    const matches = await service.searchMaster('D0XOLIN 400', 6);
    expect(matches.length).toBeGreaterThan(0);
    expect(matches[0].id).toBe('dox-400');
    expect(matches[0].score).toBeGreaterThanOrEqual(0.95);
  });

  it('corrects Selexipcg 200 OCR typo to Selexipag 200 and returns canonical master entity', async () => {
    const selexipagMaster = master({
      id: 'selex-200',
      brandName: 'Selexipag',
      strength: '200mcg',
      composition: 'Selexipag (200mcg)',
      manufacturer: 'Actelion Pharmaceuticals',
    });

    const prisma = {
      medicineMaster: {
        findMany: jest.fn().mockResolvedValue([selexipagMaster]),
        findUnique: jest.fn().mockResolvedValue(selexipagMaster),
      },
      saltProfile: {
        findMany: jest.fn().mockResolvedValue([]),
      },
    } as unknown as PrismaService;

    const enrichmentQueue = { enqueueSaltProfiles: jest.fn() };
    const aliasCache = { learn: jest.fn(), lookup: jest.fn().mockReturnValue(null) };
    const service = new MedicinesService(
      prisma,
      auditLogs as unknown as AuditLogsService,
      resolver as unknown as MedicineResolverService,
      enrichmentQueue as any,
      undefined,
      undefined,
      undefined,
      undefined,
      aliasCache as any,
    );

    // 1. Search Master matches with high score
    const matches = await service.searchMaster('Selexipcg 200', 6);
    expect(matches.length).toBeGreaterThan(0);
    expect(matches[0].id).toBe('selex-200');
    expect(matches[0].score).toBeGreaterThanOrEqual(0.95);

    // 2. Resolve Candidate substitutes canonical verified text
    const result = await service.resolvePackageImageCandidate(
      {
        rawName: 'Selexipcg 200',
        ocrLine: 'Selexipcg 200 mcg',
        extractedStrength: '200mcg',
        ocrConfidence: 0.82,
        weak: false,
        fullText: '',
        allLines: [],
        brandCandidates: [
          {
            name: 'Selexipcg 200',
            ocrLine: 'Selexipcg 200 mcg',
            confidence: 0.82,
            parserScore: 0.78,
          },
        ],
      },
      '/api/medicines/package-image/selexipag.jpg',
    );

    expect(result.rawName).toBe('Selexipag');
    expect(result.displayName).toBe('Selexipag');
    expect(result.extractedStrength).toBe('200mcg');
    expect(result.isAutoCorrected).toBe(true);
    expect(result.originalOcrText).toBe('Selexipcg 200 mcg');
    expect(aliasCache.learn).toHaveBeenCalledWith(
      'Selexipcg 200',
      'selex-200',
      'Selexipag',
      '200mcg',
    );
  });
});
