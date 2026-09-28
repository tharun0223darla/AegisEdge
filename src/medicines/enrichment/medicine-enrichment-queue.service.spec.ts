import { MedicineEnrichmentQueueService } from './medicine-enrichment-queue.service';

describe('MedicineEnrichmentQueueService', () => {
  const originalConcurrency = process.env.MEDICINE_ENRICH_ON_SEARCH_CONCURRENCY;
  const originalCooldown = process.env.MEDICINE_ENRICH_ON_SEARCH_COOLDOWN_MS;

  afterEach(() => {
    if (originalConcurrency === undefined) delete process.env.MEDICINE_ENRICH_ON_SEARCH_CONCURRENCY;
    else process.env.MEDICINE_ENRICH_ON_SEARCH_CONCURRENCY = originalConcurrency;

    if (originalCooldown === undefined) delete process.env.MEDICINE_ENRICH_ON_SEARCH_COOLDOWN_MS;
    else process.env.MEDICINE_ENRICH_ON_SEARCH_COOLDOWN_MS = originalCooldown;

    jest.clearAllMocks();
  });

  it('dedupes duplicate salt ids before running enrichment', async () => {
    process.env.MEDICINE_ENRICH_ON_SEARCH_CONCURRENCY = '2';
    const prisma = {
      saltProfile: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'salt-1',
          saltKey: 'rare-salt-1mg',
          enrichmentStatus: 'NEEDS_SOURCE',
          lastEnrichmentAttemptAt: null,
        }),
      },
    };
    const enrichment = {
      enrichSaltProfile: jest.fn().mockResolvedValue({
        saltKey: 'rare-salt-1mg',
        status: 'NEEDS_SOURCE',
      }),
      markEnrichmentFailure: jest.fn(),
    };
    const queue = new MedicineEnrichmentQueueService(prisma as any, enrichment as any);

    queue.enqueueSaltProfiles([
      { id: 'salt-1', enrichmentStatus: 'NEEDS_SOURCE' },
      { id: 'salt-1', enrichmentStatus: 'NEEDS_SOURCE' },
    ]);
    await flushPromises();
    await flushPromises();

    expect(enrichment.enrichSaltProfile).toHaveBeenCalledTimes(1);
  });

  it('skips salts inside the persisted cooldown window', async () => {
    process.env.MEDICINE_ENRICH_ON_SEARCH_COOLDOWN_MS = String(7 * 24 * 60 * 60 * 1000);
    const prisma = {
      saltProfile: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'salt-2',
          saltKey: 'recent-miss-1mg',
          enrichmentStatus: 'NEEDS_SOURCE',
          lastEnrichmentAttemptAt: new Date(),
        }),
      },
    };
    const enrichment = {
      enrichSaltProfile: jest.fn(),
      markEnrichmentFailure: jest.fn(),
    };
    const queue = new MedicineEnrichmentQueueService(prisma as any, enrichment as any);

    queue.enqueueSaltProfiles([{ id: 'salt-2', enrichmentStatus: 'NEEDS_SOURCE' }]);
    await flushPromises();
    await flushPromises();

    expect(enrichment.enrichSaltProfile).not.toHaveBeenCalled();
  });

  it('honors the concurrency cap', async () => {
    process.env.MEDICINE_ENRICH_ON_SEARCH_CONCURRENCY = '1';
    const first = deferred();
    const prisma = {
      saltProfile: {
        findUnique: jest.fn(async ({ where }: any) => ({
          id: where.id,
          saltKey: where.id,
          enrichmentStatus: 'NEEDS_SOURCE',
          lastEnrichmentAttemptAt: null,
        })),
      },
    };
    const enrichment = {
      enrichSaltProfile: jest
        .fn()
        .mockReturnValueOnce(first.promise)
        .mockResolvedValueOnce({ saltKey: 'salt-2', status: 'PARTIAL' }),
      markEnrichmentFailure: jest.fn(),
    };
    const queue = new MedicineEnrichmentQueueService(prisma as any, enrichment as any);

    queue.enqueueSaltProfiles([
      { id: 'salt-1', enrichmentStatus: 'NEEDS_SOURCE' },
      { id: 'salt-2', enrichmentStatus: 'NEEDS_SOURCE' },
    ]);
    await flushPromises();

    expect(enrichment.enrichSaltProfile).toHaveBeenCalledTimes(1);

    first.resolve({ saltKey: 'salt-1', status: 'PARTIAL' });
    await flushPromises();
    await flushPromises();

    expect(enrichment.enrichSaltProfile).toHaveBeenCalledTimes(2);
  });
});

function flushPromises() {
  return new Promise((resolve) => setImmediate(resolve));
}

function deferred<T = any>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}
