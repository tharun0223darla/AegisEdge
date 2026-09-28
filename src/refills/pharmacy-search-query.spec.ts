import { buildPharmacySearchQuery } from './pharmacy-search-query';

describe('buildPharmacySearchQuery', () => {
  it.each([
    [
      { name: 'Amocin 500mg', strength: '500mg', form: 'CAPSULE' },
      'Amocin 500mg capsule',
    ],
    [
      { name: 'Dolo 650', strength: '650mg', form: 'TABLET' },
      'Dolo 650 tablet',
    ],
    [
      { name: 'Calpol', strength: '650 mg', form: 'TABLET' },
      'Calpol 650 mg tablet',
    ],
    [
      {
        name: 'Augmentin 500mg/125mg Tablet',
        strength: '500mg/125mg',
        form: 'TABLET',
      },
      'Augmentin 500mg/125mg Tablet',
    ],
    [
      {
        name: '  Cefixime   Oral   Suspension ',
        strength: '100mg/5ml',
        form: 'ORAL_SUSPENSION',
      },
      'Cefixime Oral Suspension 100mg/5ml',
    ],
  ])('builds a concise provider query for %#', (identity, expected) => {
    expect(buildPharmacySearchQuery(identity)).toBe(expected);
  });
});
