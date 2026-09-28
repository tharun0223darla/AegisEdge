import { rmSync } from 'fs';
import { of, throwError } from 'rxjs';
import type { HttpService } from '@nestjs/axios';
import { OpenFdaLabelService } from './openfda-label.service';

describe('OpenFdaLabelService', () => {
  beforeEach(() => {
    process.env.OPENFDA_MIN_INTERVAL_MS = '0';
    process.env.OPENFDA_CACHE_DIR = 'data/.test-cache/openfda';
  });

  afterEach(() => {
    rmSync('data/.test-cache/openfda', { recursive: true, force: true });
  });

  it('maps openFDA label sections to sourced enrichment fields', () => {
    const service = new OpenFdaLabelService({} as HttpService);

    const mapped = service.mapLabel({
      ingredient: 'Paracetamol',
      normalizedIngredient: 'acetaminophen',
      rxCui: '161',
      fetchedAt: '2026-07-03T00:00:00.000Z',
      sourceUrl:
        'https://api.fda.gov/drug/label.json?search=openfda.generic_name',
      label: {
        set_id: 'set-1',
        effective_time: '20260101',
        indications_and_usage: [
          'Used for temporary relief of minor aches and pains.',
        ],
        dosage_and_administration: [
          'Use as directed on the label or by a doctor.',
        ],
        adverse_reactions: ['Nausea. Rash. Allergic reaction.'],
        warnings: ['Liver warning: severe liver damage may occur.'],
        storage_and_handling: ['Store at room temperature.'],
      },
    });

    expect(mapped.uses).toContain('temporary relief');
    expect(mapped.howToTake).toContain('Use as directed');
    expect(mapped.sideEffects).toEqual(
      expect.arrayContaining(['Nausea', 'Rash']),
    );
    expect(mapped.warnings).toContain('Liver warning');
    expect(mapped.storage).toContain('room temperature');
    expect(mapped.sourceRefs.uses?.[0]).toEqual(
      expect.objectContaining({
        sourceType: 'openFDA',
        sourceField: 'indications_and_usage',
        normalizedIngredient: 'acetaminophen',
        rxCui: '161',
      }),
    );
  });

  it('rejects injection-only labels from generic ingredient enrichment', () => {
    const service = new OpenFdaLabelService({} as HttpService);
    const mapped = service.mapLabel({
      ingredient: 'Pantoprazole',
      normalizedIngredient: 'pantoprazole',
      fetchedAt: '2026-07-03T00:00:00.000Z',
      sourceUrl: 'https://api.fda.gov/drug/label.json',
      label: {
        openfda: { route: ['INTRAVENOUS'] },
        indications_and_usage: [
          'Pantoprazole Sodium for Injection is indicated for GERD.',
        ],
        dosage_and_administration: [
          'Administer by intravenous infusion for 15 minutes.',
        ],
      },
    });

    expect(mapped).toEqual({ sourceRefs: {} });
  });

  it('tries fallback aliases when the exact generic name is not found', async () => {
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
              results: [
                {
                  set_id: 'set-metformin',
                  indications_and_usage: [
                    'Used with diet and exercise for type 2 diabetes.',
                  ],
                },
              ],
            },
          }),
        ),
    };
    const service = new OpenFdaLabelService(http as any);

    const result = await service.fetchLabel({
      ingredient: 'Metformin Hydrochloride',
      normalizedIngredient: 'metformin hydrochloride',
      aliasesTried: ['metformin hydrochloride', 'metformin'],
      refresh: true,
    });

    expect(http.get).toHaveBeenNthCalledWith(
      1,
      'https://api.fda.gov/drug/label.json',
      expect.objectContaining({
        params: expect.objectContaining({
          search: 'openfda.generic_name:"metformin hydrochloride"',
        }),
      }),
    );
    expect(http.get).toHaveBeenNthCalledWith(
      2,
      'https://api.fda.gov/drug/label.json',
      expect.objectContaining({
        params: expect.objectContaining({
          search: 'openfda.generic_name:"metformin"',
        }),
      }),
    );
    expect(result?.normalizedIngredient).toBe('metformin');
    expect(result?.label).toMatchObject({ set_id: 'set-metformin' });
  });
});
