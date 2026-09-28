export type WebClinicalSourceTier = 'OFFICIAL' | 'MEDICAL_REFERENCE' | 'IDENTITY_ONLY' | 'REJECTED';

export interface WebClinicalSourceClassification {
  tier: WebClinicalSourceTier;
  host: string;
  reason: string;
  usableForClinicalFields: boolean;
}

export const OFFICIAL_CLINICAL_DOMAINS = [
  'cdsco.gov.in',
  'ipc.gov.in',
  'dailymed.nlm.nih.gov',
  'medlineplus.gov',
  'who.int',
  'fda.gov',
  'ema.europa.eu',
  'ncbi.nlm.nih.gov',
  'nih.gov',
  'nhs.uk',
  'nice.org.uk',
];

export const MEDICAL_REFERENCE_DOMAINS = [
  'drugs.com',
  'mayoclinic.org',
  'medscape.com',
  'rxlist.com',
  'merckmanuals.com',
  'msdmanuals.com',
];

export const BRAND_IDENTITY_ONLY_DOMAINS = [
  '1mg.com',
  'tata1mg.com',
  'netmeds.com',
  'pharmeasy.in',
  'apollopharmacy.in',
  'medplusmart.com',
  'medindia.net',
];

export const REJECTED_WEB_SOURCE_DOMAINS = [
  'reddit.com',
  'quora.com',
  'facebook.com',
  'instagram.com',
  'x.com',
  'twitter.com',
  'youtube.com',
  'tiktok.com',
  'medium.com',
  'blogspot.com',
  'wordpress.com',
];

export const CLINICAL_WEB_SEARCH_ALLOW_DOMAINS = [
  ...OFFICIAL_CLINICAL_DOMAINS,
  ...MEDICAL_REFERENCE_DOMAINS,
];

function hostname(value: string) {
  try {
    return new URL(value).hostname.replace(/^www\./i, '').toLowerCase();
  } catch {
    return value.replace(/^https?:\/\//i, '').split('/')[0].replace(/^www\./i, '').toLowerCase();
  }
}

function hostMatches(host: string, domain: string) {
  return host === domain || host.endsWith(`.${domain}`);
}

function inList(host: string, domains: string[]) {
  return domains.some((domain) => hostMatches(host, domain));
}

export function classifyWebClinicalSource(url: string): WebClinicalSourceClassification {
  const host = hostname(url);

  if (!host || inList(host, REJECTED_WEB_SOURCE_DOMAINS)) {
    return {
      tier: 'REJECTED',
      host,
      reason: 'Rejected social, forum, blog, or unsupported source.',
      usableForClinicalFields: false,
    };
  }

  if (inList(host, OFFICIAL_CLINICAL_DOMAINS)) {
    return {
      tier: 'OFFICIAL',
      host,
      reason: 'Official, regulatory, government, or public medical library source.',
      usableForClinicalFields: true,
    };
  }

  if (inList(host, MEDICAL_REFERENCE_DOMAINS)) {
    return {
      tier: 'MEDICAL_REFERENCE',
      host,
      reason: 'Recognized medical reference source. Admin review required before saving.',
      usableForClinicalFields: true,
    };
  }

  if (inList(host, BRAND_IDENTITY_ONLY_DOMAINS)) {
    return {
      tier: 'IDENTITY_ONLY',
      host,
      reason: 'Indian brand catalog source. Use only for identity/package confirmation, not clinical guidance.',
      usableForClinicalFields: false,
    };
  }

  return {
    tier: 'REJECTED',
    host,
    reason: 'Domain is not in the clinical source allowlist.',
    usableForClinicalFields: false,
  };
}