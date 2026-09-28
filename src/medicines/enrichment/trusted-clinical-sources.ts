const TRUSTED_CLINICAL_SOURCE_TYPES = new Set([
  'openfda',
  'rxnorm',
  'dailymed',
  'medlineplus',
  'admin',
  'web_assisted',
  'nfi_ipc',
  'cdsco',
]);

const ADMIN_PROTECTED_SOURCE_TYPES = new Set([
  'admin',
  'web_assisted',
  'nfi_ipc',
  'cdsco',
]);

function sourceType(value: unknown): string {
  const record = asRecord(value);
  return asText(record?.sourceType).trim().toLowerCase();
}

function provider(value: unknown): string {
  const record = asRecord(value);
  return asText(record?.provider).trim().toLowerCase();
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean')
    return String(value);
  if (Array.isArray(value)) {
    return value
      .map((item: unknown) => asText(item))
      .filter((item) => item.length > 0)
      .join(' ');
  }
  return '';
}

const NON_HUMAN_SOURCE_PATTERN =
  /\b(?:not for use in humans?|veterinary|animal use|broodstock|spawning aid|sgnrha|safety data sheet|material safety data sheet|msds|research use only)\b/i;

function sourceMetadata(value: unknown): string {
  const ref = asRecord(value) ?? {};
  return [ref.title, ref.provider, ref.url, ref.sourceField]
    .map(asText)
    .join(' ');
}

export function isUnsafeClinicalSourceRef(value: unknown): boolean {
  return Boolean(
    value &&
    typeof value === 'object' &&
    NON_HUMAN_SOURCE_PATTERN.test(sourceMetadata(value)),
  );
}

export function isNonHumanClinicalContent(value: unknown): boolean {
  return NON_HUMAN_SOURCE_PATTERN.test(asText(value));
}

export function isInjectionOnlyClinicalContent(value: unknown): boolean {
  const text = asText(value);
  const injectionSignals = (
    text.match(/\b(?:intravenous|intramuscular|injection|infusion)\b/gi) ?? []
  ).length;
  const oralSignals = (
    text.match(/\b(?:oral|tablet|capsule|by mouth|swallow)\b/gi) ?? []
  ).length;
  return injectionSignals >= 2 && oralSignals === 0;
}

export function isTrustedClinicalSourceRef(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;

  if (isUnsafeClinicalSourceRef(value)) return false;

  return (
    TRUSTED_CLINICAL_SOURCE_TYPES.has(sourceType(value)) ||
    provider(value) === 'admin' ||
    provider(value).includes('indian pharmacopoeia commission') ||
    provider(value).includes('central drugs standard control')
  );
}

export function isAdminProtectedClinicalSourceRef(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;

  return (
    Boolean(asRecord(value)?.verifiedByAdmin) ||
    ADMIN_PROTECTED_SOURCE_TYPES.has(sourceType(value)) ||
    provider(value) === 'admin'
  );
}

export function hasTrustedClinicalSource(value: unknown): boolean {
  const refs = Array.isArray(value) ? value : value ? [value] : [];
  return refs.some((ref) => isTrustedClinicalSourceRef(ref));
}

export function hasAdminProtectedClinicalSource(value: unknown): boolean {
  const refs = Array.isArray(value) ? value : value ? [value] : [];
  return refs.some((ref) => isAdminProtectedClinicalSourceRef(ref));
}
