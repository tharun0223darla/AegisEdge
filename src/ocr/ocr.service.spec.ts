import { HttpService } from '@nestjs/axios';
import { of, throwError } from 'rxjs';
import { OcrService } from './ocr.service';

describe('OcrService sidecar contract', () => {
  const originalEnv = process.env;

  afterEach(() => {
    process.env = originalEnv;
    jest.restoreAllMocks();
  });

  it('reports accepted PP-OCRv6 evidence as SERVER_OCR', async () => {
    process.env = {
      ...originalEnv,
      NODE_ENV: 'production',
      OCR_SERVICE_URL: 'https://ocr.example.test',
      OCR_SERVICE_TOKEN: 'test-token',
      OCR_ALLOW_TESSERACT_FALLBACK: 'false',
    };
    let requestConfig:
      | { timeout: number; headers: Record<string, string> }
      | undefined;
    const post = jest.fn(
      (
        _url: string,
        _body: unknown,
        config: { timeout: number; headers: Record<string, string> },
      ) => {
        requestConfig = config;
        return of({
          data: {
            success: true,
            source: 'SERVER_OCR',
            rawText: 'Vopaxa-200\nCefpodoxime 200 mg',
            avgConfidence: 91,
            wordsCount: 4,
            selectedVariant: 'contrast',
            modelVersion: 'PP-OCRv6',
            processingMs: 120,
            lines: [
              {
                text: 'Vopaxa-200',
                confidence: 0.92,
                bbox: [
                  [1, 1],
                  [20, 1],
                  [20, 8],
                  [1, 8],
                ],
              },
            ],
            quality: {
              accepted: true,
              score: 0.9,
              textLength: 32,
              alphanumericRatio: 0.8,
              medicationSignal: true,
            },
          },
        });
      },
    );
    const service = new OcrService({ post } as unknown as HttpService);

    const result = await service.runPaddleOcr(__filename, {
      documentType: 'package',
    });

    expect(result).toMatchObject({
      success: true,
      source: 'SERVER_OCR',
      selectedVariant: 'contrast',
      modelVersion: 'PP-OCRv6',
    });
    expect(requestConfig?.timeout).toBe(135000);
    expect(requestConfig?.headers['X-OCR-Service-Token']).toBe('test-token');
  });

  it('does not pass a rejected sidecar result into Tesseract', async () => {
    process.env = {
      ...originalEnv,
      NODE_ENV: 'production',
      OCR_SERVICE_URL: 'https://ocr.example.test',
      OCR_ALLOW_TESSERACT_FALLBACK: 'true',
    };
    const post = jest.fn().mockReturnValue(
      of({
        data: {
          success: false,
          source: 'NO_RESULT',
          rawText: '',
          avgConfidence: 17,
          wordsCount: 0,
          lines: [],
          fallbackReason: 'low_average_confidence',
        },
      }),
    );
    const service = new OcrService({ post } as unknown as HttpService);
    const tesseract = jest.spyOn(
      service as unknown as {
        _runTesseract: (path: string) => Promise<unknown>;
      },
      '_runTesseract',
    );

    const result = await service.extractText(__filename, {
      documentType: 'package',
    });

    expect(result).toMatchObject({
      success: false,
      source: 'NO_RESULT',
      fallbackReason: 'low_average_confidence',
    });
    expect(tesseract).not.toHaveBeenCalled();
  });

  it('fails closed when the production sidecar is unreachable', async () => {
    process.env = {
      ...originalEnv,
      NODE_ENV: 'production',
      OCR_SERVICE_URL: 'https://ocr.example.test',
      OCR_ALLOW_TESSERACT_FALLBACK: 'false',
    };
    const post = jest
      .fn()
      .mockReturnValue(throwError(() => new Error('connect ECONNREFUSED')));
    const service = new OcrService({ post } as unknown as HttpService);

    await expect(
      service.extractText(__filename, { documentType: 'bill' }),
    ).resolves.toMatchObject({
      success: false,
      source: 'NO_RESULT',
      fallbackReason: 'server_ocr_unavailable',
    });
  });
});
