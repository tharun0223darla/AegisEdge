export interface NormalizedIngredient {
  original: string;
  normalized: string;
  aliasesTried: string[];
}

const INDIAN_TO_US_ALIASES: Record<string, string> = {
  paracetamol: 'acetaminophen',
  acetaminophen: 'acetaminophen',
  amoxycillin: 'amoxicillin',
  amoxicillin: 'amoxicillin',
  'metformin hcl': 'metformin hydrochloride',
  'metformin hydrochloride': 'metformin hydrochloride',
  metformin: 'metformin',
  'clavulanate potassium': 'clavulanic acid',
  'potassium clavulanate': 'clavulanic acid',
  clavulanate: 'clavulanic acid',
  'vit d3': 'cholecalciferol',
  'vitamin d3': 'cholecalciferol',
  cholecalciferol: 'cholecalciferol',
  'vit c': 'ascorbic acid',
  'vitamin c': 'ascorbic acid',
  salbutamol: 'albuterol',
  levosalbutamol: 'levalbuterol',
  adrenaline: 'epinephrine',
  noradrenaline: 'norepinephrine',
  beclometasone: 'beclomethasone',
  'ursodeoxycholic acid': 'ursodiol',
  'progesterone natural micronized': 'progesterone',
};

const TRAILING_SALT_FORMS = new Set([
  'acetate',
  'besilate',
  'besylate',
  'bitartrate',
  'calcium',
  'citrate',
  'dihydrochloride',
  'dipotassium',
  'disodium',
  'fumarate',
  'gluconate',
  'hydrobromide',
  'hydrochloride',
  'maleate',
  'mesylate',
  'nitrate',
  'oxalate',
  'phosphate',
  'potassium',
  'sodium',
  'succinate',
  'sulfate',
  'sulphate',
  'tartrate',
]);

export class IngredientNormalizer {
  normalize(value: string): NormalizedIngredient {
    const original = value.trim();
    const cleaned = this.cleanIngredient(original);
    const normalized = this.alias(cleaned);
    const baseIngredient = this.baseIngredient(cleaned);
    const normalizedBase = baseIngredient ? this.alias(baseIngredient) : '';
    const aliasesTried = Array.from(
      new Set(
        [
          normalized,
          normalizedBase,
          cleaned,
          baseIngredient,
          original.toLowerCase(),
        ]
          .map((item) => item.trim())
          .filter(Boolean),
      ),
    );

    return { original, normalized, aliasesTried };
  }

  private alias(value: string) {
    return INDIAN_TO_US_ALIASES[value] ?? value;
  }

  private baseIngredient(value: string) {
    const words = value.split(/\s+/).filter(Boolean);
    if (words.length < 2) return value;

    const last = words[words.length - 1];
    if (!TRAILING_SALT_FORMS.has(last)) return value;

    const base = words.slice(0, -1).join(' ').trim();
    return base || value;
  }

  private cleanIngredient(value: string) {
    return value
      .toLowerCase()
      .replace(/\bh\.?c\.?l\.?\b/g, ' hydrochloride ')
      .replace(/\bn\/?a\b/g, ' ')
      .replace(/\b(?:tab|tabs|tablet|tablets|cap|caps|capsule|capsules|oral|syrup|inj|injection)\b/g, ' ')
      .replace(/\b\d+(?:\.\d+)?\s*(?:mg|mcg|g|gm|ml|iu|units?|%|%w\/w|%w\/v|%ww|%wv)\b/gi, ' ')
      .replace(/\bper\s+\d+\s*ml\b/g, ' ')
      .replace(/[^a-z0-9 ]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }
}