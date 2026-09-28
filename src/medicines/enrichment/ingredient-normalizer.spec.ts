import { IngredientNormalizer } from './ingredient-normalizer';

describe('IngredientNormalizer', () => {
  it('normalizes Indian ingredient names to US label/RxNorm names', () => {
    const normalizer = new IngredientNormalizer();

    expect(normalizer.normalize('Paracetamol').normalized).toBe('acetaminophen');
    expect(normalizer.normalize('Amoxycillin').normalized).toBe('amoxicillin');
    expect(normalizer.normalize('Metformin HCl').normalized).toBe('metformin hydrochloride');
    expect(normalizer.normalize('Salbutamol').normalized).toBe('albuterol');
    expect(normalizer.normalize('Levosalbutamol').normalized).toBe('levalbuterol');
    expect(normalizer.normalize('Adrenaline NA').normalized).toBe('epinephrine');
    expect(normalizer.normalize('Beclometasone').normalized).toBe('beclomethasone');
    expect(normalizer.normalize('Ursodeoxycholic Acid').normalized).toBe('ursodiol');
    expect(normalizer.normalize('Progesterone Natural Micronized').normalized).toBe('progesterone');
  });

  it('adds base-ingredient fallback aliases for salt forms and strengths', () => {
    const normalizer = new IngredientNormalizer();

    expect(normalizer.normalize('Metformin Hydrochloride 500mg').aliasesTried).toEqual(
      expect.arrayContaining(['metformin hydrochloride', 'metformin']),
    );
    expect(normalizer.normalize('Chlorpheniramine Maleate 2mg').aliasesTried).toEqual(
      expect.arrayContaining(['chlorpheniramine maleate', 'chlorpheniramine']),
    );
    expect(normalizer.normalize('Diclofenac Sodium 50mg').aliasesTried).toEqual(
      expect.arrayContaining(['diclofenac sodium', 'diclofenac']),
    );
  });
});