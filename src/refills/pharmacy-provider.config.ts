export const PHARMACY_PROVIDERS = {
  TATA_1MG: {
    label: 'Tata 1mg',
    allowedHosts: ['1mg.com', 'www.1mg.com'],
    productPathPatterns: [/^\/drugs\/[^/]+/i],
    queryPrefilled: true,
    searchUrl(query: string) {
      const url = new URL('https://www.1mg.com/search/all');
      url.searchParams.set('name', query);
      return url.toString();
    },
  },
  PHARMEASY: {
    label: 'PharmEasy',
    allowedHosts: ['pharmeasy.in', 'www.pharmeasy.in'],
    productPathPatterns: [/^\/online-medicine-order\/[^/]+/i],
    queryPrefilled: true,
    searchUrl(query: string) {
      const url = new URL('https://pharmeasy.in/search/all');
      url.searchParams.set('name', query);
      return url.toString();
    },
  },
  NETMEDS: {
    label: 'Netmeds',
    allowedHosts: ['netmeds.com', 'www.netmeds.com'],
    productPathPatterns: [/^\/prescriptions\/[^/]+/i],
    queryPrefilled: true,
    searchUrl(query: string) {
      const url = new URL('https://www.netmeds.com/catalogsearch/result');
      url.searchParams.set('q', query);
      return url.toString();
    },
  },
  APOLLO: {
    label: 'Apollo Pharmacy',
    allowedHosts: ['apollopharmacy.in', 'www.apollopharmacy.in'],
    productPathPatterns: [/^\/(?:otc|medicine)\/[^/]+/i],
    queryPrefilled: true,
    searchUrl(query: string) {
      return `https://www.apollopharmacy.in/search-medicines/${encodeURIComponent(query.trim())}`;
    },
  },
  JAN_AUSHADHI: {
    label: 'Jan Aushadhi (PMBJP)',
    allowedHosts: ['janaushadhi.gov.in', 'www.janaushadhi.gov.in'],
    productPathPatterns: [/.*/i],
    queryPrefilled: true,
    searchUrl(query: string) {
      return `http://janaushadhi.gov.in/ProductList.aspx?search=${encodeURIComponent(query.trim())}`;
    },
  },
  MEDPLUS: {
    label: 'MedPlus Mart',
    allowedHosts: ['medplusmart.com', 'www.medplusmart.com'],
    productPathPatterns: [/^\/product\/[^/]+/i],
    queryPrefilled: false,
    searchUrl(query: string) {
      void query;
      return 'https://www.medplusmart.com/';
    },
  },
} as const;

export type PharmacyProvider = keyof typeof PHARMACY_PROVIDERS;

export function isPharmacyProvider(value: string): value is PharmacyProvider {
  return value in PHARMACY_PROVIDERS;
}

export function isAllowedPharmacyProductUrl(
  provider: string,
  value: string,
): boolean {
  if (!isPharmacyProvider(provider)) return false;

  try {
    const url = new URL(value);
    const allowedHosts: readonly string[] =
      PHARMACY_PROVIDERS[provider].allowedHosts;
    const productPathPatterns: readonly RegExp[] =
      PHARMACY_PROVIDERS[provider].productPathPatterns;
    return (
      url.protocol === 'https:' &&
      allowedHosts.includes(url.hostname.toLowerCase()) &&
      productPathPatterns.some((pattern) => pattern.test(url.pathname))
    );
  } catch {
    return false;
  }
}
