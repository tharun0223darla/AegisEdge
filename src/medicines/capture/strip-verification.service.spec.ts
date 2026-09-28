import { StripVerificationService } from './strip-verification.service';

describe('StripVerificationService', () => {
  const service = new StripVerificationService();
  const target = {
    medicineName: 'Artefer XT',
    masterBrandName: 'Artefer XT',
    composition: 'Ferrous Ascorbate + Folic Acid',
    referenceOcrText: 'Ferrous Ascorbate & Folic Acid Tablets ArteferXT',
  };

  it('matches an exact printed brand', () => {
    expect(
      service.verify(target, {
        ocrText: 'ArteferXT Ferrous Ascorbate and Folic Acid Tablets',
        ocrConfidence: 0.84,
        engine: 'mlkit-android-latin-v2',
      }),
    ).toEqual(expect.objectContaining({ status: 'MATCH', score: 0.99 }));
  });

  it('matches a composition when the stylized brand is unreadable', () => {
    expect(
      service.verify(target, {
        ocrText: 'Ferrous Ascorbate Folic Tablets IP',
        ocrConfidence: 78,
      }),
    ).toEqual(expect.objectContaining({ status: 'MATCH' }));
  });

  it('returns uncertain for weak partial OCR instead of a false mismatch', () => {
    expect(
      service.verify(target, {
        ocrText: 'Artef',
        ocrConfidence: 22,
      }),
    ).toEqual(expect.objectContaining({ status: 'UNCERTAIN' }));
  });

  it('does not confirm an exact brand from low-confidence OCR', () => {
    expect(
      service.verify(target, {
        ocrText: 'ArteferXT Ferrous Ascorbate and Folic Acid Tablets',
        ocrConfidence: 0.31,
        engine: 'mlkit-android-latin-v2',
      }),
    ).toEqual(
      expect.objectContaining({
        status: 'UNCERTAIN',
        score: 0,
        ocrConfidence: 31,
      }),
    );
  });

  it('does not confirm composition when OCR confidence is unavailable', () => {
    expect(
      service.verify(target, {
        ocrText: 'Ferrous Ascorbate Folic Acid Tablets',
      }),
    ).toEqual(
      expect.objectContaining({
        status: 'UNCERTAIN',
        score: 0,
        ocrConfidence: 0,
      }),
    );
  });

  it('returns mismatch only when different text is readable', () => {
    expect(
      service.verify(target, {
        ocrText: 'Dolo 650 Paracetamol Tablets Micro Labs',
        ocrConfidence: 91,
      }),
    ).toEqual(expect.objectContaining({ status: 'MISMATCH' }));
  });

  it('rejects a readable different strength even when the brand matches', () => {
    expect(
      service.verify(
        {
          medicineName: 'Dolo 650',
          masterBrandName: 'Dolo 650',
          strength: '650mg',
        },
        { ocrText: 'Dolo 500 Paracetamol Tablets IP 500mg', ocrConfidence: 92 },
      ),
    ).toEqual(expect.objectContaining({ status: 'MISMATCH' }));
  });
});
