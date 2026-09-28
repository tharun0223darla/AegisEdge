import { MedicineResolverService } from './medicine-resolver.service';

describe('MedicineResolverService', () => {
  const resolver = new MedicineResolverService();

  it('classifies high-confidence text matches as strong but still confirmation-gated', () => {
    const outcome = resolver.classify({
      rawName: 'Dolo 650',
      source: 'MANUAL',
      possibleMasterMatches: [{ masterId: 'master-1', score: 0.95 }],
    });

    expect(outcome).toEqual({
      kind: 'STRONG',
      match: { masterId: 'master-1', score: 0.95 },
      needsConfirm: true,
    });
  });

  it('classifies mild text matches as possible', () => {
    const outcome = resolver.classify({
      rawName: 'Doloo 650',
      source: 'MANUAL',
      possibleMasterMatches: [{ masterId: 'master-1', score: 0.82 }],
    });

    expect(outcome).toEqual({
      kind: 'POSSIBLE',
      matches: [{ masterId: 'master-1', score: 0.82 }],
      needsConfirm: true,
    });
  });

  it('classifies weak matches as unknown', () => {
    const outcome = resolver.classify({
      rawName: 'zzzxxy unknown',
      source: 'MANUAL',
      possibleMasterMatches: [{ masterId: 'master-1', score: 0.45 }],
    });

    expect(outcome).toEqual({ kind: 'UNKNOWN', needsConfirm: true });
  });

  it('keeps barcode matching deterministic', () => {
    const outcome = resolver.classify({
      rawName: '8900000000000',
      source: 'BARCODE',
      possibleMasterMatches: [{ masterId: 'master-1', score: 0.89 }],
    });

    expect(outcome).toEqual({ kind: 'UNKNOWN', needsConfirm: true });
  });
});
