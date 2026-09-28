import {
  isAllowedPharmacyProductUrl,
  PHARMACY_PROVIDERS,
} from './pharmacy-provider.config';

describe('pharmacy provider link policy', () => {
  it('accepts HTTPS product pages only on the configured provider domain', () => {
    expect(
      isAllowedPharmacyProductUrl(
        'TATA_1MG',
        'https://www.1mg.com/drugs/dolo-650mg-tablet-74467',
      ),
    ).toBe(true);
    expect(
      isAllowedPharmacyProductUrl(
        'TATA_1MG',
        'http://www.1mg.com/drugs/dolo-650mg-tablet-74467',
      ),
    ).toBe(false);
    expect(
      isAllowedPharmacyProductUrl(
        'TATA_1MG',
        'https://www.1mg.com.attacker.example/drugs/dolo',
      ),
    ).toBe(false);
    expect(
      isAllowedPharmacyProductUrl('UNKNOWN', 'https://www.1mg.com/drugs/dolo'),
    ).toBe(false);
    expect(
      isAllowedPharmacyProductUrl(
        'APOLLO',
        'https://www.apollopharmacy.in/otc/dolo-650mg-tablet-15-s',
      ),
    ).toBe(true);
    expect(
      isAllowedPharmacyProductUrl(
        'APOLLO',
        'https://www.apollopharmacy.in/search-medicines/Dolo%20650',
      ),
    ).toBe(false);
    expect(
      isAllowedPharmacyProductUrl('MEDPLUS', 'https://www.medplusmart.com/'),
    ).toBe(false);
    expect(
      isAllowedPharmacyProductUrl(
        'MEDPLUS',
        'https://www.medplusmart.com/product/dolo-650_DOLO0023',
      ),
    ).toBe(true);
  });

  it('preserves the full medicine identity in provider search URLs', () => {
    const searchQuery = 'Dolo 650 tablet';
    const url = new URL(PHARMACY_PROVIDERS.PHARMEASY.searchUrl(searchQuery));
    expect(url.searchParams.get('name')).toBe(searchQuery);
    expect(PHARMACY_PROVIDERS.APOLLO.searchUrl(searchQuery)).toBe(
      'https://www.apollopharmacy.in/search-medicines/Dolo%20650%20tablet',
    );
    expect(PHARMACY_PROVIDERS.MEDPLUS.searchUrl(searchQuery)).toBe(
      'https://www.medplusmart.com/',
    );
    expect(PHARMACY_PROVIDERS.APOLLO.queryPrefilled).toBe(true);
    expect(PHARMACY_PROVIDERS.MEDPLUS.queryPrefilled).toBe(false);
  });
});
