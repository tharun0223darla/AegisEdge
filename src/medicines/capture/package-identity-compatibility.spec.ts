import { packageIdentityCompatibility } from './package-identity-compatibility';

describe('packageIdentityCompatibility', () => {
  it('rejects the HP Kit to Pyloripan-DSR mismatch', () => {
    expect(
      packageIdentityCompatibility(
        {
          brandName: 'HP Kit',
          composition: 'Amoxicillin + Tinidazole + Omeprazole',
        },
        {
          brandName: 'Pyloripan-DSR',
          composition: 'Domperidone 30mg + Pantoprazole 40mg',
        },
      ),
    ).toEqual({ compatible: false, reason: 'composition_mismatch' });
  });

  it('accepts the same ingredients regardless of order or spelling alias', () => {
    expect(
      packageIdentityCompatibility(
        { composition: 'Amoxycillin + Tinidazole + Omeprazole' },
        {
          composition: 'Omeprazole 20mg + Amoxicillin 750mg + Tinidazole 500mg',
        },
      ),
    ).toEqual({ compatible: true, reason: 'composition_match' });
  });

  it('requires an exact normalized brand when composition evidence is absent', () => {
    expect(
      packageIdentityCompatibility(
        { brandName: 'Pylori' },
        { brandName: 'Pyloripan-DSR' },
      ),
    ).toEqual({ compatible: false, reason: 'brand_mismatch' });
  });

  it('rejects different strengths when both identities specify them', () => {
    expect(
      packageIdentityCompatibility(
        { composition: 'Cefpodoxime 200mg' },
        { composition: 'Cefpodoxime 100mg' },
      ),
    ).toEqual({ compatible: false, reason: 'composition_mismatch' });
  });
});
