import { clientOcrAttempt, clientOcrResult } from './client-ocr-result.util';

describe('clientOcrResult', () => {
  it('converts bounded ML Kit lines into the shared OCR contract', () => {
    const result = clientOcrResult({
      nativeOcrText: 'DOLO 650\nParacetamol Tablets IP 650mg',
      nativeOcrConfidence: 0.88,
      nativeOcrEngine: 'mlkit-android-latin-v2',
      nativeOcrLines: JSON.stringify([
        {
          text: 'DOLO 650',
          confidence: 0.91,
          bbox: { left: 10, top: 20, right: 160, bottom: 60 },
        },
      ]),
    });

    expect(result).toEqual(
      expect.objectContaining({
        success: true,
        engine: 'mlkit',
        source: 'ML_KIT',
        confidence: 88,
        wordsCount: 6,
      }),
    );
    expect(result?.lines?.[0]).toEqual(
      expect.objectContaining({
        text: 'DOLO 650',
        confidence: 0.91,
        bbox: [
          [10, 20],
          [160, 20],
          [160, 60],
          [10, 60],
        ],
      }),
    );
  });

  it('rejects an empty client OCR payload', () => {
    expect(clientOcrResult({ nativeOcrText: '   ' })).toBeNull();
  });

  it('reports an empty ML Kit result with its server fallback reason', () => {
    const attempt = clientOcrAttempt({
      nativeOcrSuccess: 'false',
      nativeOcrSource: 'NO_RESULT',
      nativeOcrFallbackReason: 'ML_KIT_EMPTY_TEXT',
      nativeOcrProcessingMs: 420,
    });

    expect(attempt.result).toBeNull();
    expect(attempt.source).toBe('NO_RESULT');
    expect(attempt.success).toBe(false);
    expect(attempt.fallbackReason).toBe('ML_KIT_EMPTY_TEXT');
    expect(attempt.diagnostics.processingMs).toBe(420);
  });

  it('reports an ML Kit exception without accepting client text', () => {
    const attempt = clientOcrAttempt({
      nativeOcrSuccess: 'false',
      nativeOcrText: 'must not be trusted after failure',
      nativeOcrFallbackReason: 'ML_KIT_EXCEPTION',
    });

    expect(attempt.result).toBeNull();
    expect(attempt.fallbackReason).toBe('ML_KIT_EXCEPTION');
  });

  it('normalizes repeated horizontal whitespace while preserving lines', () => {
    const result = clientOcrResult({
      nativeOcrSuccess: 'true',
      nativeOcrText:
        'Ferrous   Ascorbate &\n  Folic    Acid Tablets  \nArteferXT',
    });

    expect(result?.rawText).toBe(
      'Ferrous Ascorbate &\nFolic Acid Tablets\nArteferXT',
    );
  });
});
