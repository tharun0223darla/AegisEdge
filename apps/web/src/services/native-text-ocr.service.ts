import { Capacitor, registerPlugin } from '@capacitor/core';

export interface NativeOcrLine {
  text: string;
  confidence: number;
  bbox?: {
    left: number;
    top: number;
    right: number;
    bottom: number;
  };
}

export type OcrSource = 'ML_KIT' | 'SERVER_OCR' | 'NO_RESULT';

export interface NativeOcrResult {
  source: Extract<OcrSource, 'ML_KIT' | 'NO_RESULT'>;
  success: boolean;
  text: string;
  lines: NativeOcrLine[];
  confidence: number;
  engine: 'mlkit-android-latin-v2';
  fallbackReason?: string;
  processingMs: number;
  blockCount: number;
  lineCount: number;
  elementCount: number;
  rotationDegrees: number;
  imageWidth: number;
  imageHeight: number;
}

interface NativeTextOcrPlugin {
  recognizeImage(options: { imageBase64: string }): Promise<NativeOcrResult>;
}

const NativeTextOcr = registerPlugin<NativeTextOcrPlugin>('NativeTextOcr');
const MAX_FILE_BYTES = 3 * 1024 * 1024;

function noResult(fallbackReason: string, processingMs = 0): NativeOcrResult {
  return {
    source: 'NO_RESULT',
    success: false,
    text: '',
    lines: [],
    confidence: 0,
    engine: 'mlkit-android-latin-v2',
    fallbackReason,
    processingMs,
    blockCount: 0,
    lineCount: 0,
    elementCount: 0,
    rotationDegrees: 0,
    imageWidth: 0,
    imageHeight: 0,
  };
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () =>
      reject(new Error('Unable to prepare the image for on-device OCR.'));
    reader.readAsDataURL(file);
  });
}

function normalizeResult(result: NativeOcrResult): NativeOcrResult {
  const text = (result.text ?? '')
    .split(/\r?\n/)
    .map((line) => line.replace(/[\t ]+/g, ' ').trim())
    .filter(Boolean)
    .join('\n')
    .slice(0, 30_000);
  const lines = (result.lines ?? [])
    .filter((line) => typeof line.text === 'string' && line.text.trim())
    .slice(0, 500)
    .map((line) => ({
      ...line,
      text: line.text.trim().slice(0, 500),
      confidence: Math.max(0, Math.min(1, Number(line.confidence) || 0)),
    }));

  return {
    ...result,
    source: result.success && text ? 'ML_KIT' : 'NO_RESULT',
    success: Boolean(result.success && text),
    text,
    lines,
    confidence: Math.max(0, Math.min(1, Number(result.confidence) || 0)),
    fallbackReason:
      result.success && text
        ? undefined
        : result.fallbackReason || 'ML_KIT_EMPTY_TEXT',
    processingMs: Math.max(0, Number(result.processingMs) || 0),
    blockCount: Math.max(0, Number(result.blockCount) || 0),
    lineCount: Math.max(0, Number(result.lineCount) || lines.length),
    elementCount: Math.max(0, Number(result.elementCount) || 0),
    rotationDegrees: Number(result.rotationDegrees) || 0,
  };
}

export const nativeTextOcrService = {
  isSupported: () =>
    Capacitor.isNativePlatform() &&
    Capacitor.getPlatform() === 'android' &&
    Capacitor.isPluginAvailable('NativeTextOcr'),

  recognizeFile: async (file: File): Promise<NativeOcrResult> => {
    const startedAt = performance.now();
    if (
      !Capacitor.isNativePlatform() ||
      Capacitor.getPlatform() !== 'android'
    ) {
      return noResult('NOT_NATIVE_PLATFORM');
    }
    if (!Capacitor.isPluginAvailable('NativeTextOcr')) {
      return noResult('PLUGIN_UNAVAILABLE');
    }
    if (!file.type.startsWith('image/')) return noResult('UNSUPPORTED_FILE');
    if (file.size > MAX_FILE_BYTES) {
      return noResult('IMAGE_TOO_LARGE');
    }

    try {
      const imageBase64 = await readAsDataUrl(file);
      return normalizeResult(
        await NativeTextOcr.recognizeImage({ imageBase64 }),
      );
    } catch {
      return noResult(
        'ML_KIT_EXCEPTION',
        Math.round(performance.now() - startedAt),
      );
    }
  },
};

export function appendNativeOcrFields(
  formData: FormData,
  result?: NativeOcrResult | null,
) {
  if (!result) return;
  formData.append('nativeOcrSource', result.source);
  formData.append('nativeOcrSuccess', String(result.success));
  formData.append('nativeOcrFallbackReason', result.fallbackReason ?? '');
  formData.append('nativeOcrProcessingMs', String(result.processingMs));
  formData.append('nativeOcrBlockCount', String(result.blockCount));
  formData.append('nativeOcrLineCount', String(result.lineCount));
  formData.append('nativeOcrElementCount', String(result.elementCount));
  formData.append('nativeOcrRotationDegrees', String(result.rotationDegrees));
  if (!result.success || !result.text) return;
  formData.append('nativeOcrText', result.text);
  formData.append('nativeOcrLines', JSON.stringify(result.lines));
  formData.append('nativeOcrConfidence', String(result.confidence));
  formData.append('nativeOcrEngine', result.engine);
}
