export interface CanonicalIngredient {
  ingredient: string;
  strength?: string;
  unit?: string;
  raw: string;
}

export interface CanonicalSaltProfile {
  saltKey: string;
  displayName: string;
  ingredients: CanonicalIngredient[];
}

const INGREDIENT_ALIASES: Record<string, string> = {
  acetaminophen: 'paracetamol',
  pcm: 'paracetamol',
  metformin: 'metformin hydrochloride',
  'metformin hcl': 'metformin hydrochloride',
  'metformin hydrochloride': 'metformin hydrochloride',
  amoxycillin: 'amoxicillin',
  amoxycilline: 'amoxicillin',
  'clavulanate potassium': 'clavulanic acid',
  'potassium clavulanate': 'clavulanic acid',
  clavulanate: 'clavulanic acid',
  'vit c': 'ascorbic acid',
  'vitamin c': 'ascorbic acid',
  'd-biotin': 'biotin',
  'vitamin b7': 'biotin',
  'vitamin h': 'biotin',
  'coenzyme q10': 'coenzyme q10',
  ubiquinone: 'coenzyme q10',
  mecobalamin: 'methylcobalamin',
  'vitamin b12': 'cyanocobalamin',
  'vitamin d3': 'cholecalciferol',
  folate: 'folic acid',
  'vitamin b9': 'folic acid',
};

const BASE_MOLECULE_ALIASES: Record<string, string> = {
  'choline fenofibrate': 'fenofibrate',
  'fenofibric acid': 'fenofibrate',
  'pantoprazole sodium': 'pantoprazole',
  'rabeprazole sodium': 'rabeprazole',
  'omeprazole magnesium': 'omeprazole',
  'esomeprazole magnesium': 'esomeprazole',
  'atorvastatin calcium': 'atorvastatin',
  'rosuvastatin calcium': 'rosuvastatin',
  'amlodipine besylate': 'amlodipine',
  'amlodipine maleate': 'amlodipine',
  'losartan potassium': 'losartan',
  'montelukast sodium': 'montelukast',
  'levocetirizine dihydrochloride': 'levocetirizine',
  'cetirizine dihydrochloride': 'cetirizine',
  'ciprofloxacin hydrochloride': 'ciprofloxacin',
  'levofloxacin hemihydrate': 'levofloxacin',
  'azithromycin dihydrate': 'azithromycin',
  'clopidogrel bisulfate': 'clopidogrel',
  'metoprolol succinate': 'metoprolol',
  'metoprolol tartrate': 'metoprolol',
  'sildenafil citrate': 'sildenafil',
  'sildenabl citrate': 'sildenafil',
  'sildenabl': 'sildenafil',
  'sacubitril sodium': 'sacubitril',
  'valsartan sodium': 'valsartan',
  'tolperisone hydrochloride': 'tolperisone',
  'tolperisone hcl': 'tolperisone',
  'tolperisone': 'tolperisone',
  'folic acid': 'folic acid',
  'clavulanic acid': 'clavulanic acid',
  'salicylic acid': 'salicylic acid',
  'valproic acid': 'valproic acid',
  'ascorbic acid': 'ascorbic acid',
  'tranexamic acid': 'tranexamic acid',
  'mefenamic acid': 'mefenamic acid',
  'fusidic acid': 'fusidic acid',
  'azelaic acid': 'azelaic acid',
  'ursodeoxycholic acid': 'ursodeoxycholic acid',
  'isosorbide mononitrate': 'isosorbide mononitrate',
  'isosorbide dinitrate': 'isosorbide dinitrate',
  'ferrous ascorbate': 'ferrous ascorbate',
};

const MANUFACTURER_ALIASES: Record<string, string> = {
  gsk: 'glaxosmithkline',
  'glaxo-smith-kline': 'glaxosmithkline',
  glaxosmithkline: 'glaxosmithkline',
};

const UNIT_ALIASES: Record<string, string> = {
  gm: 'g',
  gms: 'g',
  gram: 'g',
  grams: 'g',
  milligram: 'mg',
  milligrams: 'mg',
  microgram: 'mcg',
  micrograms: 'mcg',
  ug: 'mcg',
  mcg: 'mcg',
  mg: 'mg',
  g: 'g',
  ml: 'ml',
  iu: 'iu',
  units: 'iu',
  unit: 'iu',
  'million spores': 'million-spores',
  'million spore': 'million-spores',
  spores: 'spores',
  spore: 'spores',
  '%': '%',
  '%ww': '%ww',
  '%wv': '%wv',
};

const UNIT_PATTERN =
  'mg|milligrams?|g|gm|gms|grams?|mcg|micrograms?|ug|ml|iu|units?|million spores?|spores?|%';
const DENOMINATOR_UNIT_PATTERN =
  'mg|milligrams?|g|gm|gms|grams?|mcg|micrograms?|ug|ml|iu|units?';
const COMPLEX_STRENGTH_RE = new RegExp(
  `(\\d+(?:\\.\\d+)?)\\s*(${UNIT_PATTERN})\\s*(?:/|per)\\s*(\\d+(?:\\.\\d+)?)?\\s*(${DENOMINATOR_UNIT_PATTERN})\\b`,
  'i',
);
const PERCENT_STRENGTH_RE = /(\d+(?:\.\d+)?)\s*%\s*(ww|wv|w\s*\/\s*w|w\s*\/\s*v)/i;
const STRENGTH_RE = new RegExp(
  `(\\d+(?:\\.\\d+)?)\\s*(${UNIT_PATTERN})(?:\\b|$)`,
  'i',
);
const TRAILING_NUMBER_RE = /(\d+(?:\.\d+)?)\s*$/;

export class SaltCanonicalizer {
  canonicalizeComposition(input: string): CanonicalSaltProfile {
    const source = this.cleanInput(input);
    const parts = this.splitIngredients(source);
    const ingredients = parts
      .map((part) => this.parseIngredient(part))
      .filter((ingredient) => ingredient.ingredient.length > 0)
      .sort((a, b) => this.keyPart(a).localeCompare(this.keyPart(b)));

    if (!ingredients.length) {
      throw new Error('Composition did not contain a readable ingredient.');
    }

    return {
      saltKey: ingredients.map((ingredient) => this.keyPart(ingredient)).join('+'),
      displayName: ingredients.map((ingredient) => this.displayPart(ingredient)).join(' + '),
      ingredients,
    };
  }

  buildDedupeKey(input: {
    brandName: string;
    strength?: string | null;
    manufacturer?: string | null;
  }) {
    return this.slug(
      [input.brandName, input.strength, input.manufacturer]
        .filter(Boolean)
        .join('|'),
    );
  }

  normalizeBrand(value: string) {
    return this.slug(value).replace(/-/g, '');
  }

  normalizeManufacturer(value?: string | null) {
    if (!value) return undefined;

    const cleaned = value
      .toLowerCase()
      .replace(/\b(?:pharmaceuticals?|pharma|private|pvt|limited|ltd|inc|llp|company|co)\b\.?/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    const slugged = this.slug(cleaned);
    const compact = slugged.replace(/-/g, '');

    return MANUFACTURER_ALIASES[slugged] ?? MANUFACTURER_ALIASES[compact] ?? slugged;
  }

  normalizePackSize(value?: string | null) {
    if (!value) return undefined;

    return this.slug(
      value
        .toLowerCase()
        .replace(/\b(?:of|tablets?|tabs?|capsules?|caps?)\b/g, ' ')
        .replace(/\s+/g, ' ')
        .trim(),
    );
  }

  normalizeStrengthText(value?: string | null) {
    if (!value) return undefined;

    const cleaned = this.cleanInput(value);
    const match =
      cleaned.match(PERCENT_STRENGTH_RE) ??
      cleaned.match(COMPLEX_STRENGTH_RE) ??
      cleaned.match(STRENGTH_RE) ??
      cleaned.match(TRAILING_NUMBER_RE);

    if (!match) return this.slug(cleaned);

    const normalized = this.normalizeStrengthMatch(match);
    return `${normalized.value}${normalized.unit}`;
  }

  buildEquivalentIdentityKey(input: {
    brandName?: string | null;
    saltKey?: string | null;
    manufacturer?: string | null;
  }) {
    return [
      input.brandName ? this.normalizeBrand(input.brandName) : undefined,
      input.saltKey || undefined,
      this.normalizeManufacturer(input.manufacturer),
    ]
      .filter(Boolean)
      .join('|');
  }

  private parseIngredient(part: string): CanonicalIngredient {
    const raw = part.trim();
    const match =
      raw.match(PERCENT_STRENGTH_RE) ??
      raw.match(COMPLEX_STRENGTH_RE) ??
      raw.match(STRENGTH_RE) ??
      raw.match(TRAILING_NUMBER_RE);
    const ingredientText = match
      ? raw.slice(0, match.index).trim() || raw.replace(match[0], '').trim()
      : raw;
    const normalizedIngredient = this.normalizeIngredient(ingredientText);

    if (!match) {
      return { ingredient: normalizedIngredient, raw };
    }

    const normalizedStrength = this.normalizeStrengthMatch(match);

    return {
      ingredient: normalizedIngredient,
      strength: normalizedStrength.value,
      unit: normalizedStrength.unit,
      raw,
    };
  }

  private normalizeStrengthMatch(match: RegExpMatchArray) {
    if (PERCENT_STRENGTH_RE.test(match[0])) {
      const percentUnit = `%${match[2].toLowerCase().replace(/\s*\/\s*/g, '').replace(/\s+/g, '')}`;
      return this.normalizeStrength(match[1], percentUnit);
    }

    if (COMPLEX_STRENGTH_RE.test(match[0])) {
      const numerator = this.normalizeStrength(match[1], match[2]);
      const denominatorValue = match[3] ? this.formatNumber(Number(match[3])) : '';
      const denominatorUnit =
        UNIT_ALIASES[match[4].toLowerCase()] ?? match[4].toLowerCase();

      return {
        value: numerator.value,
        unit: `${numerator.unit}-per-${denominatorValue}${denominatorUnit}`,
      };
    }

    return this.normalizeStrength(match[1], match[2] ?? 'mg');
  }

  private normalizeStrength(value: string, unitValue: string) {
    const unit = UNIT_ALIASES[unitValue.toLowerCase()] ?? unitValue.toLowerCase();
    const numeric = Number(value);

    if (Number.isFinite(numeric) && unit === 'g') {
      return { value: this.formatNumber(numeric * 1000), unit: 'mg' };
    }

    return {
      value: this.formatNumber(numeric),
      unit,
    };
  }

  private formatNumber(value: number) {
    if (Number.isInteger(value)) return String(value);
    return String(value).replace(/\.?0+$/, '');
  }

  private splitIngredients(value: string) {
    const normalized = this.protectConcentrationSlashes(value)
      .replace(/\s*(?:\+|&|\/)\s*/g, ' + ')
      .replace(/\s+with\s+/gi, ' + ');

    const plusParts = normalized
      .split(/\s+\+\s+/)
      .map((part) => part.trim())
      .filter(Boolean);

    if (plusParts.length > 1) return plusParts;

    const commaParts = normalized
      .split(/\s*,\s*/)
      .map((part) => part.trim())
      .filter(Boolean);

    if (
      commaParts.length > 1 &&
      commaParts.every(
        (part) =>
          PERCENT_STRENGTH_RE.test(part) ||
          COMPLEX_STRENGTH_RE.test(part) ||
          STRENGTH_RE.test(part),
      )
    ) {
      return commaParts;
    }

    return [normalized.trim()];
  }

  private protectConcentrationSlashes(value: string) {
    return value
      .replace(/%\s*w\s*\/\s*w/gi, '%ww')
      .replace(/%\s*w\s*\/\s*v/gi, '%wv')
      .replace(
        new RegExp(
          `(\\d+(?:\\.\\d+)?\\s*(?:${UNIT_PATTERN}))\\s*/\\s*(\\d+(?:\\.\\d+)?\\s*)?(${DENOMINATOR_UNIT_PATTERN})\\b`,
          'gi',
        ),
        (_match, numerator, denominatorValue = '', denominatorUnit) =>
          `${numerator} per ${denominatorValue}${denominatorUnit}`,
      );
  }

  normalizeBaseIngredient(ingredient: string): string {
    const direct = this.normalizeIngredient(ingredient);
    if (BASE_MOLECULE_ALIASES[direct]) {
      return BASE_MOLECULE_ALIASES[direct];
    }
    if (INGREDIENT_ALIASES[direct]) {
      return INGREDIENT_ALIASES[direct];
    }

    // Strip standard pharmaceutical salt counter-ions and prodrug wrappers
    const stripped = direct
      .replace(/^(?:choline|levo|dextro|elemental)\s+/g, '')
      .replace(/\s+(?:hydrochloride|dihydrochloride|monohydrochloride|hcl|besylate|maleate|succinate|tartrate|fumarate|citrate|phosphate|sulfate|sulphate|bisulfate|mesylate|valerate|propionate|dipropionate|acetate|dihydrate|trihydrate|monohydrate|hemihydrate|gluconate|zinc|calcium|sodium|potassium|magnesium|hydrate|acid)$/g, '')
      .trim();

    return (
      BASE_MOLECULE_ALIASES[stripped] ??
      INGREDIENT_ALIASES[stripped] ??
      stripped
    );
  }

  private normalizeIngredient(value: string) {
    const cleaned = value
      .toLowerCase()
      .replace(
        /\b(?:tab|tabs|tablet|tablets|cap|caps|capsule|capsules|syrup|inj|injection|oral|solution|drops?|cream|ointment|gel|film[- ]?coated|uncoated)\b/g,
        ' ',
      )
      .replace(/\b(?:ip|i\.?p\.?|usp|bp|ep|jp|j\.?p\.?|nf|ih)\b/g, ' ')
      .replace(/\bh\.?c\.?l\.?\b/g, ' hydrochloride ')
      .replace(/\s+/g, ' ')
      .replace(/[^a-z0-9 ]+/g, ' ')
      .trim();

    return INGREDIENT_ALIASES[cleaned] ?? cleaned;
  }

  private cleanInput(value: string) {
    return value
      .replace(/\uFEFF/g, '')
      .replace(/\u00C2?\u00B5/g, 'u')
      .replace(/[()]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private keyPart(ingredient: CanonicalIngredient) {
    return [
      this.slug(ingredient.ingredient),
      ingredient.strength && ingredient.unit
        ? `${ingredient.strength}${ingredient.unit}`
        : undefined,
    ]
      .filter(Boolean)
      .join('-');
  }

  private displayPart(ingredient: CanonicalIngredient) {
    const title = ingredient.ingredient
      .split(/\s+/)
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');

    const unit = ingredient.unit
      ?.replace('%ww', '%w/w')
      .replace('%wv', '%w/v')
      .replace(/-per-/g, '/');

    return ingredient.strength && unit
      ? `${title} ${ingredient.strength}${unit}`
      : title;
  }

  private slug(value: string) {
    return value
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9%]+/g, '-')
      .replace(/^-+|-+$/g, '');
  }
}

const defaultCanonicalizer = new SaltCanonicalizer();

export function normalizeBaseIngredient(ingredient: string): string {
  return defaultCanonicalizer.normalizeBaseIngredient(ingredient);
}

