import {
  classifyWebClinicalSource,
  CLINICAL_WEB_SEARCH_ALLOW_DOMAINS,
} from './trusted-web-source-policy';

describe('trusted web source policy', () => {
  it('allows official and recognized medical reference domains for clinical fields', () => {
    expect(classifyWebClinicalSource('https://dailymed.nlm.nih.gov/dailymed/drugInfo.cfm?setid=abc')).toMatchObject({
      tier: 'OFFICIAL',
      usableForClinicalFields: true,
    });
    expect(classifyWebClinicalSource('https://www.drugs.com/monograph/azathioprine.html')).toMatchObject({
      tier: 'MEDICAL_REFERENCE',
      usableForClinicalFields: true,
    });
    expect(CLINICAL_WEB_SEARCH_ALLOW_DOMAINS).toContain('dailymed.nlm.nih.gov');
  });

  it('keeps Indian brand catalogs identity-only and rejects forums/blogs', () => {
    expect(classifyWebClinicalSource('https://www.1mg.com/drugs/example')).toMatchObject({
      tier: 'IDENTITY_ONLY',
      usableForClinicalFields: false,
    });
    expect(classifyWebClinicalSource('https://reddit.com/r/medicine/comments/example')).toMatchObject({
      tier: 'REJECTED',
      usableForClinicalFields: false,
    });
  });
});