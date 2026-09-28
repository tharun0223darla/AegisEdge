import { of } from 'rxjs';
import { MedlinePlusConnectService } from './medlineplus-connect.service';

describe('MedlinePlusConnectService', () => {
  it('returns a patient education link for an RxCUI response', async () => {
    const http = {
      get: jest.fn().mockReturnValue(
        of({
          data: {
            feed: {
              entry: [
                {
                  title: 'Tafamidis: MedlinePlus Drug Information',
                  link: [{ href: 'https://medlineplus.gov/druginfo/meds/example.html' }],
                  summary: 'Patient-friendly information.',
                },
              ],
            },
          },
        }),
      ),
    };
    const service = new MedlinePlusConnectService(http as any);

    const result = await service.fetchLink({
      ingredient: 'tafamidis',
      normalizedIngredient: 'tafamidis',
      rxCui: '1545063',
      refresh: true,
    });

    expect(result).toEqual(
      expect.objectContaining({
        title: 'Tafamidis: MedlinePlus Drug Information',
        url: 'https://medlineplus.gov/druginfo/meds/example.html',
        rxCui: '1545063',
      }),
    );
    expect(service.sourceRef(result!)).toEqual(
      expect.objectContaining({
        sourceType: 'MedlinePlus',
        provider: 'MedlinePlus Connect / National Library of Medicine',
        rxCui: '1545063',
      }),
    );
  });
});
