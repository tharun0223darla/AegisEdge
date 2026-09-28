import { SaltCanonicalizer } from '../import/salt-canonicalizer';

interface PackageIdentityEvidence {
  brandName?: string | null;
  composition?: string | null;
}

interface MasterIdentity {
  brandName?: string | null;
  genericName?: string | null;
  composition?: string | null;
  saltProfile?: { displayName?: string | null } | null;
}

export interface PackageIdentityCompatibility {
  compatible: boolean;
  reason:
    | 'composition_match'
    | 'brand_match'
    | 'composition_mismatch'
    | 'brand_mismatch';
}

const canonicalizer = new SaltCanonicalizer();

type IngredientIdentity = Map<string, string | null>;

function ingredientIdentity(value?: string | null): IngredientIdentity | null {
  if (!value?.trim()) return null;

  try {
    return new Map(
      canonicalizer
        .canonicalizeComposition(value)
        .ingredients.map((ingredient) => [
          ingredient.ingredient,
          ingredient.strength && ingredient.unit
            ? `${ingredient.strength}${ingredient.unit}`
            : null,
        ]),
    );
  } catch {
    return null;
  }
}

function toHomoglyphKey(val: string) {
  return val
    .toLowerCase()
    .replace(/[0oO]/g, 'o')
    .replace(/[1lI|!]/g, 'l')
    .replace(/[5sS]/g, 's')
    .replace(/[2zZ]/g, 'z')
    .replace(/vv/g, 'w')
    .replace(/rn/g, 'm')
    .replace(/cl/g, 'd')
    .replace(/ph/g, 'f')
    .replace(/[^a-z0-9]/g, '');
}

function stringEditDistance(left: string, right: string): number {
  const previous = Array.from(
    { length: right.length + 1 },
    (_, index) => index,
  );
  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    let diagonal = previous[0];
    previous[0] = leftIndex;
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      const above = previous[rightIndex];
      previous[rightIndex] = Math.min(
        previous[rightIndex] + 1,
        previous[rightIndex - 1] + 1,
        diagonal + (left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1),
      );
      diagonal = above;
    }
  }
  return previous[right.length];
}

function sameIngredients(left: IngredientIdentity, right: IngredientIdentity) {
  if (left.size !== right.size) return false;

  const leftEntries = [...left.entries()];
  const rightEntries = [...right.entries()];

  return leftEntries.every(([leftIng, leftStr]) => {
    const leftBase = canonicalizer.normalizeBaseIngredient(leftIng);
    const leftHomo = toHomoglyphKey(leftBase);

    const rightMatch = rightEntries.find(([rightIng]) => {
      const rightBase = canonicalizer.normalizeBaseIngredient(rightIng);
      if (rightIng === leftIng || rightBase === leftBase) return true;
      if (toHomoglyphKey(rightBase) === leftHomo) return true;

      const maxLen = Math.max(leftBase.length, rightBase.length);
      if (maxLen >= 6) {
        const dist = stringEditDistance(leftBase, rightBase);
        if (dist <= 2 && dist / maxLen <= 0.25) return true;
      }

      return false;
    });

    if (!rightMatch) return false;
    const rightStr = rightMatch[1];
    return !leftStr || !rightStr || leftStr === rightStr;
  });
}

export function packageIdentityCompatibility(
  evidence: PackageIdentityEvidence,
  master: MasterIdentity,
): PackageIdentityCompatibility {
  const capturedIngredients = ingredientIdentity(evidence.composition);
  const masterIngredients = ingredientIdentity(
    master.composition ?? master.genericName ?? master.saltProfile?.displayName,
  );

  if (capturedIngredients && masterIngredients) {
    return sameIngredients(capturedIngredients, masterIngredients)
      ? { compatible: true, reason: 'composition_match' }
      : { compatible: false, reason: 'composition_mismatch' };
  }

  const capturedBrand = evidence.brandName
    ? canonicalizer.normalizeBrand(evidence.brandName)
    : '';
  const masterBrand = master.brandName
    ? canonicalizer.normalizeBrand(master.brandName)
    : '';

  return capturedBrand && capturedBrand === masterBrand
    ? { compatible: true, reason: 'brand_match' }
    : { compatible: false, reason: 'brand_mismatch' };
}
