import { of } from 'rxjs';
import { RxNormService } from './rxnorm.service';

describe('RxNormService', () => {
  it('resolves Paracetamol through the acetaminophen normalizer', async () => {
    const http = {
      get: jest.fn().mockReturnValue(of({ data: { idGroup: { rxnormId: ['161'] } } })),
    };
    const service = new RxNormService(http as any);

    const result = await service.resolveIngredient('Paracetamol');

    expect(http.get).toHaveBeenCalledWith(
      'https://rxnav.nlm.nih.gov/REST/rxcui.json',
      expect.objectContaining({
        params: { name: 'acetaminophen', search: 2 },
      }),
    );
    expect(result).toEqual(
      expect.objectContaining({
        ingredient: 'Paracetamol',
        normalizedIngredient: 'acetaminophen',
        rxCui: '161',
      }),
    );
  });

  it('tries base-ingredient fallback aliases when the salt form has no RxCUI', async () => {
    const http = {
      get: jest
        .fn()
        .mockReturnValueOnce(of({ data: { idGroup: {} } }))
        .mockReturnValueOnce(of({ data: { idGroup: { rxnormId: ['6809'] } } })),
    };
    const service = new RxNormService(http as any);

    const result = await service.resolveIngredient('Metformin Hydrochloride');

    expect(http.get).toHaveBeenNthCalledWith(
      1,
      'https://rxnav.nlm.nih.gov/REST/rxcui.json',
      expect.objectContaining({ params: { name: 'metformin hydrochloride', search: 2 } }),
    );
    expect(http.get).toHaveBeenNthCalledWith(
      2,
      'https://rxnav.nlm.nih.gov/REST/rxcui.json',
      expect.objectContaining({ params: { name: 'metformin', search: 2 } }),
    );
    expect(result.normalizedIngredient).toBe('metformin');
    expect(result.rxCui).toBe('6809');
    expect(result.aliasesTried).toEqual(expect.arrayContaining(['metformin hydrochloride', 'metformin']));
  });
});