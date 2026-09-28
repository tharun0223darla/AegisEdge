import { MedicinesController } from './medicines.controller';
import type { PackageImageCandidate } from './capture/package-image-capture.service';
import type { ClientOcrAttempt } from '../ocr/client-ocr-result.util';
import type { OcrResult } from '../ocr/ocr.service';

describe('MedicinesController package OCR decisions', () => {
  const parsed: PackageImageCandidate = {
    rawName: 'Dolo 650',
    ocrConfidence: 0.9,
    weak: false,
  };

  function setup() {
    const medicinesService = {
      verifyStripText: jest.fn(),
    };
    const ocrService = {
      extractPackagePhotoText: jest.fn(),
    };
    const packageImageCapture = {
      extractCandidate: jest.fn(() => parsed),
      isLowQualityCandidate: jest.fn(() => false),
      isReviewableCandidate: jest.fn(
        (candidate: PackageImageCandidate | null) => Boolean(candidate),
      ),
    };
    const controller = new MedicinesController(
      medicinesService as never,
      {} as never,
      ocrService as never,
      packageImageCapture as never,
    );
    const internals = controller as unknown as {
      extractPackageImageCandidate(
        path: string,
        attempt: ClientOcrAttempt,
      ): Promise<{
        ocrResult: OcrResult;
        parsed: PackageImageCandidate | null;
      }>;
      runServerPackageOcr(
        path: string,
        fallbackReason: string,
      ): Promise<OcrResult>;
      pickPackageOcrResult(
        ...choices: Array<{
          ocrResult: OcrResult;
          parsed: PackageImageCandidate | null;
        }>
      ): {
        ocrResult: OcrResult;
        parsed: PackageImageCandidate | null;
      };
    };

    return {
      controller,
      internals,
      medicinesService,
      ocrService,
      packageImageCapture,
    };
  }

  it('uses a successful readable ML Kit result without server OCR', async () => {
    const { internals, ocrService } = setup();
    const native = mlKitResult('DOLO 650');

    const result = await internals.extractPackageImageCandidate('unused.jpg', {
      result: native,
      source: 'ML_KIT',
      success: true,
      diagnostics: native.diagnostics!,
    });

    expect(result.ocrResult.source).toBe('ML_KIT');
    expect(ocrService.extractPackagePhotoText).not.toHaveBeenCalled();
  });

  it('falls back to server OCR after an empty ML Kit result', async () => {
    const { internals, ocrService } = setup();
    ocrService.extractPackagePhotoText.mockResolvedValue(
      serverEngineResult('DOLO 650'),
    );

    const result = await internals.extractPackageImageCandidate(
      'package.jpg',
      noNativeResult('ML_KIT_EMPTY_TEXT'),
    );

    expect(result.ocrResult.source).toBe('SERVER_OCR');
    expect(result.ocrResult.fallbackReason).toBe('ML_KIT_EMPTY_TEXT');
    expect(ocrService.extractPackagePhotoText).toHaveBeenCalledTimes(1);
  });

  it('falls back to server OCR after an ML Kit exception', async () => {
    const { internals, ocrService } = setup();
    ocrService.extractPackagePhotoText.mockResolvedValue(
      serverEngineResult('AZITHRAL 500'),
    );

    const result = await internals.extractPackageImageCandidate(
      'package.jpg',
      noNativeResult('ML_KIT_EXCEPTION'),
    );

    expect(result.ocrResult.source).toBe('SERVER_OCR');
    expect(result.ocrResult.fallbackReason).toBe('ML_KIT_EXCEPTION');
  });

  it('reports no result when server OCR also returns no text', async () => {
    const { internals, ocrService } = setup();
    ocrService.extractPackagePhotoText.mockResolvedValue({
      success: false,
      rawText: '',
      confidence: 0,
      wordsCount: 0,
      engine: 'tesseract',
    });

    const result = await internals.runServerPackageOcr(
      'package.jpg',
      'NOT_NATIVE_PLATFORM',
    );

    expect(result.source).toBe('NO_RESULT');
    expect(result.fallbackReason).toBe(
      'SERVER_OCR_NO_RESULT_AFTER_NOT_NATIVE_PLATFORM',
    );
  });

  it('never returns a parsed candidate with a NO_RESULT OCR source', () => {
    const { internals, packageImageCapture } = setup();
    packageImageCapture.isLowQualityCandidate.mockReturnValue(true);

    const result = internals.pickPackageOcrResult({
      ocrResult: {
        success: false,
        source: 'NO_RESULT',
        rawText: '= EE 2 HEHE EE a Ec a 2g',
        confidence: 0,
        wordsCount: 8,
        engine: 'tesseract',
        fallbackReason: 'SERVER_OCR_NO_RESULT_AFTER_ML_KIT_LOW_QUALITY',
      },
      parsed: {
        rawName: 'EE 2 HEHE EE a Ec a',
        extractedStrength: '2g',
        ocrConfidence: 0,
        weak: true,
      },
    });

    expect(result.parsed).toBeNull();
    expect(result.ocrResult).toEqual(
      expect.objectContaining({
        success: false,
        source: 'NO_RESULT',
        rawText: '',
        confidence: 0,
      }),
    );
  });

  it('keeps readable low-confidence text as review-only evidence', () => {
    const { internals, packageImageCapture } = setup();
    const weakCandidate: PackageImageCandidate = {
      rawName: 'Azithral 500mg',
      extractedStrength: '500mg',
      ocrConfidence: 0.32,
      weak: true,
    };
    packageImageCapture.isLowQualityCandidate.mockReturnValue(true);
    packageImageCapture.isReviewableCandidate.mockReturnValue(true);

    const result = internals.pickPackageOcrResult({
      ocrResult: serverEngineResult('Azithral 500mg'),
      parsed: weakCandidate,
    });

    expect(result.parsed).toEqual(weakCandidate);
    expect(result.ocrResult.source).toBeUndefined();
  });

  it('routes uploaded strip verification through the gated package OCR pipeline', async () => {
    const { controller, internals, medicinesService } = setup();
    const gatedOcr = serverEngineResult('Dolo 650 Paracetamol 650mg');
    const extract = jest
      .spyOn(internals, 'extractPackageImageCandidate')
      .mockResolvedValue({
        ocrResult: {
          ...gatedOcr,
          source: 'SERVER_OCR',
          fallbackReason: 'STRIP_IMAGE_SERVER_FALLBACK',
        },
        parsed,
      });
    medicinesService.verifyStripText.mockResolvedValue({
      status: 'MATCH',
    });

    await controller.verifyStripImage(
      { sub: 'patient-1' } as never,
      'medicine-1',
      { path: 'already-removed-test-image.jpg' } as never,
    );

    expect(extract).toHaveBeenCalledWith(
      'already-removed-test-image.jpg',
      expect.objectContaining({
        source: 'NO_RESULT',
        success: false,
        fallbackReason: 'STRIP_IMAGE_SERVER_FALLBACK',
      }),
    );
    expect(medicinesService.verifyStripText).toHaveBeenCalledWith(
      'patient-1',
      'medicine-1',
      expect.objectContaining({
        ocrText: 'Dolo 650 Paracetamol 650mg',
        ocrConfidence: 70,
      }),
    );
  });
});

function mlKitResult(rawText: string): OcrResult {
  return {
    success: true,
    rawText,
    confidence: 90,
    wordsCount: rawText.split(/\s+/).length,
    engine: 'mlkit',
    source: 'ML_KIT',
    lines: [{ text: rawText, confidence: 0.9 }],
    diagnostics: {
      textLength: rawText.length,
      blockCount: 1,
      lineCount: 1,
      elementCount: 2,
      processingMs: 100,
    },
  };
}

function serverEngineResult(rawText: string): OcrResult {
  return {
    success: true,
    rawText,
    confidence: 70,
    wordsCount: rawText.split(/\s+/).length,
    engine: 'tesseract',
    lines: [{ text: rawText, confidence: 0.7 }],
  };
}

function noNativeResult(fallbackReason: string): ClientOcrAttempt {
  return {
    result: null,
    source: 'NO_RESULT',
    success: false,
    fallbackReason,
    diagnostics: {
      textLength: 0,
      blockCount: 0,
      lineCount: 0,
      elementCount: 0,
      processingMs: 50,
    },
  };
}
