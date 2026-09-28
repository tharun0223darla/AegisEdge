import { of } from 'rxjs';
import { TrustedWebSourceAssistService } from './trusted-web-source-assist.service';

describe('TrustedWebSourceAssistService cache automation', () => {
  it('reuses a persisted salt-query cache instead of searching Tavily again', async () => {
    const cacheRows = new Map<string, any>();
    const prisma = {
      webSourceAssistCache: {
        findUnique: jest.fn(async ({ where }: any) => cacheRows.get(where.queryHash) ?? null),
        upsert: jest.fn(async ({ where, create, update }: any) => {
          const existing = cacheRows.get(where.queryHash);
          const now = new Date();
          const row = {
            id: existing?.id ?? 'cache-1',
            searchedAt: update?.searchedAt ?? now,
            expiresAt: create?.expiresAt ?? update?.expiresAt ?? null,
            ...(existing ?? {}),
            ...(existing ? update : create),
          };
          cacheRows.set(where.queryHash, row);
          return row;
        }),
      },
    };

    const http = {
      post: jest
        .fn()
        .mockReturnValueOnce(
          of({
            data: {
              results: [
                {
                  title: 'DailyMed - Acebrophylline label',
                  url: 'https://dailymed.nlm.nih.gov/dailymed/drugInfo.cfm?setid=ace',
                  content: 'Acebrophylline indications and usage dosage side effects warnings storage',
                  score: 0.95,
                },
              ],
            },
          }),
        )
        .mockReturnValueOnce(
          of({
            data: {
              results: [
                {
                  url: 'https://dailymed.nlm.nih.gov/dailymed/drugInfo.cfm?setid=ace',
                  raw_content:
                    'Indications and Usage Acebrophylline is used for bronchial asthma and COPD. Dosage and Administration Acebrophylline 100 mg twice daily. Adverse reactions include nausea and headache. Warnings and Precautions review cardiovascular warnings. Storage store at room temperature.',
                },
              ],
            },
          }),
        ),
    };

    const config = {
      get: jest.fn((key: string) => {
        if (key === 'TAVILY_API_KEY') return 'test-key';
        if (key === 'WEB_SOURCE_ASSIST_CACHE_TTL_MS') return String(7 * 24 * 60 * 60 * 1000);
        if (key === 'WEB_SOURCE_SEARCH_MAX_RESULTS') return '5';
        return undefined;
      }),
    };

    const service = new TrustedWebSourceAssistService(http as any, config as any, prisma as any);
    const input = {
      reviewId: 'review-1',
      saltProfile: {
        id: 'salt-1',
        saltKey: 'acebrophylline-100mg',
        displayName: 'Acebrophylline 100mg',
        ingredients: [{ name: 'Acebrophylline', strength: '100mg' }],
      },
      rawName: 'Acebrophylline',
      composition: 'Acebrophylline 100mg',
    };

    const fresh = await service.assist(input);
    const cached = await service.assist(input);

    expect(fresh.cached).toBe(false);
    expect(cached.cached).toBe(true);
    expect(prisma.webSourceAssistCache.upsert).toHaveBeenCalledTimes(1);
    expect(http.post).toHaveBeenCalledTimes(2);
    expect(cached.sources[0].title).toContain('Acebrophylline');
  });
});