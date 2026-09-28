export interface PharmacySearchIdentity {
  name: string;
  strength?: string | null;
  form?: string | null;
}

function normalizeText(value: string): string {
  return value
    .normalize('NFKC')
    .toLowerCase()
    .replace(/\u00b5|\u03bc/g, 'mc')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function compactText(value: string): string {
  return normalizeText(value).replace(/[^a-z0-9%]+/g, '');
}

function numericTokens(value: string): string[] {
  return normalizeText(value).match(/\d+(?:\.\d+)?/g) ?? [];
}

function containsNumericToken(value: string, token: string): boolean {
  const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?:^|[^0-9.])${escaped}(?:$|[^0-9.])`).test(
    normalizeText(value),
  );
}

function strengthAlreadyPresent(name: string, strength: string): boolean {
  const compactName = compactText(name);
  const compactStrength = compactText(strength);
  if (compactStrength && compactName.includes(compactStrength)) return true;

  const amounts = numericTokens(strength);
  return (
    amounts.length > 0 &&
    amounts.every((amount) => containsNumericToken(name, amount))
  );
}

const FORM_ALIASES: Record<string, string[]> = {
  tablet: ['tablet', 'tablets', 'tab'],
  capsule: ['capsule', 'capsules', 'cap'],
  injection: ['injection', 'injectable'],
  syrup: ['syrup'],
  suspension: ['suspension'],
  drops: ['drop', 'drops'],
  cream: ['cream'],
  ointment: ['ointment'],
  gel: ['gel'],
  inhaler: ['inhaler'],
  spray: ['spray'],
  powder: ['powder'],
  patch: ['patch'],
  suppository: ['suppository'],
};

function normalizeForm(form: string): string {
  return normalizeText(form).replace(/\s+/g, ' ');
}

function formAlreadyPresent(name: string, form: string): boolean {
  const normalizedName = ` ${normalizeText(name)} `;
  const normalizedForm = normalizeForm(form);
  const aliases = FORM_ALIASES[normalizedForm] ?? [normalizedForm];
  return aliases.some((alias) => normalizedName.includes(` ${alias} `));
}

export function buildPharmacySearchQuery(
  identity: PharmacySearchIdentity,
): string {
  const name = identity.name.normalize('NFKC').replace(/\s+/g, ' ').trim();
  const strength = identity.strength?.trim();
  const form = identity.form?.trim();
  const parts = [name];

  if (strength && !strengthAlreadyPresent(name, strength)) {
    parts.push(strength.replace(/\s+/g, ' '));
  }
  if (form && !formAlreadyPresent(parts.join(' '), form)) {
    parts.push(normalizeForm(form));
  }

  return parts.filter(Boolean).join(' ');
}
