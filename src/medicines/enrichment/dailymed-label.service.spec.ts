import { rmSync } from 'fs';
import { of, throwError } from 'rxjs';
import type { HttpService } from '@nestjs/axios';
import { DailyMedLabelService } from './dailymed-label.service';

describe('DailyMedLabelService', () => {
  beforeEach(() => {
    process.env.DAILYMED_MIN_INTERVAL_MS = '0';
    process.env.DAILYMED_CACHE_DIR = 'data/.test-cache/dailymed';
  });

  afterEach(() => {
    rmSync('data/.test-cache/dailymed', { recursive: true, force: true });
  });

  it('maps DailyMed SPL XML sections to sourced enrichment fields', () => {
    const service = new DailyMedLabelService({} as HttpService);

    const mapped = service.mapLabel({
      ingredient: 'Tafamidis',
      normalizedIngredient: 'tafamidis',
      rxCui: '1545063',
      setId: 'set-123',
      title: 'VYNDAMAX label',
      fetchedAt: '2026-07-05T00:00:00.000Z',
      sourceUrl:
        'https://dailymed.nlm.nih.gov/dailymed/services/v2/spls/set-123.xml',
      xml: `
        <document>
          <section><code displayName="INDICATIONS AND USAGE SECTION"/><text>Treats transthyretin-mediated amyloidosis.</text></section>
          <section><code displayName="DOSAGE AND ADMINISTRATION SECTION"/><text>Take once daily as directed.</text></section>
          <section><code displayName="ADVERSE REACTIONS SECTION"/><text>Headache. Nausea. Fatigue.</text></section>
          <section><code displayName="STORAGE AND HANDLING SECTION"/><text>Store at controlled room temperature.</text></section>
        </document>
      `,
    });

    expect(mapped.uses).toContain('transthyretin-mediated amyloidosis');
    expect(mapped.howToTake).toContain('once daily');
    expect(mapped.sideEffects).toEqual(
      expect.arrayContaining(['Headache', 'Nausea']),
    );
    expect(mapped.storage).toContain('controlled room temperature');
    expect(mapped.sourceRefs.uses?.[0]).toEqual(
      expect.objectContaining({
        sourceType: 'DailyMed',
        provider: 'DailyMed / National Library of Medicine',
        setId: 'set-123',
        rxCui: '1545063',
      }),
    );
  });

  it('rejects veterinary and non-human DailyMed labels', () => {
    const service = new DailyMedLabelService({} as HttpService);
    const mapped = service.mapLabel({
      ingredient: 'Domperidone',
      normalizedIngredient: 'domperidone',
      rxCui: '3626',
      setId: 'ovaprim-set',
      title: 'OVAPRIM (SGNRHA AND DOMPERIDONE) INJECTION, SOLUTION',
      fetchedAt: '2026-07-05T00:00:00.000Z',
      sourceUrl: 'https://dailymed.nlm.nih.gov/ovaprim.xml',
      xml: '<document><section><text>Not for use in humans. For use as a spawning aid in finfish broodstock.</text></section></document>',
    });

    expect(mapped).toEqual({ sourceRefs: {} });
  });

  it('tries fallback aliases when DailyMed has no exact salt-form match', async () => {
    const notFound = Object.assign(new Error('not found'), {
      response: { status: 404 },
    });
    const http = {
      get: jest
        .fn()
        .mockReturnValueOnce(throwError(() => notFound))
        .mockReturnValueOnce(
          of({
            data: {
              data: [{ setid: 'set-metformin', title: 'METFORMIN label' }],
            },
          }),
        )
        .mockReturnValueOnce(
          of({
            data: '<document><section><code displayName="INDICATIONS AND USAGE SECTION"/><text>Used for type 2 diabetes.</text></section></document>',
          }),
        ),
    };
    const service = new DailyMedLabelService(http as any);

    const result = await service.fetchLabel({
      ingredient: 'Metformin Hydrochloride',
      normalizedIngredient: 'metformin hydrochloride',
      aliasesTried: ['metformin hydrochloride', 'metformin'],
      refresh: true,
    });

    expect(http.get).toHaveBeenNthCalledWith(
      1,
      'https://dailymed.nlm.nih.gov/dailymed/services/v2/spls.json',
      expect.objectContaining({
        params: { drug_name: 'metformin hydrochloride' },
      }),
    );
    expect(http.get).toHaveBeenNthCalledWith(
      2,
      'https://dailymed.nlm.nih.gov/dailymed/services/v2/spls.json',
      expect.objectContaining({ params: { drug_name: 'metformin' } }),
    );
    expect(http.get).toHaveBeenNthCalledWith(
      3,
      'https://dailymed.nlm.nih.gov/dailymed/services/v2/spls/set-metformin.xml',
      expect.objectContaining({ responseType: 'text' }),
    );
    expect(result?.setId).toBe('set-metformin');
  });
});
