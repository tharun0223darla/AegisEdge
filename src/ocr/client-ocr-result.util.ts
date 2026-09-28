import type {
  OcrDiagnostics,
  OcrLine,
  OcrResult,
  OcrSource,
} from './ocr.service';

export interface ClientOcrFields {
  nativeOcrText?: string | null;
  nativeOcrLines?: string | null;
  nativeOcrConfidence?: number | string | null;
  nativeOcrEngine?: string | null;
  nativeOcrSource?: string | null;
  nativeOcrSuccess?: boolean | string | null;
  nativeOcrFallbackReason?: string | null;
  nativeOcrProcessingMs?: number | string | null;
  nativeOcrBlockCount?: number | string | null;
  nativeOcrLineCount?: number | string | null;
  nativeOcrElementCount?: number | string | null;
  nativeOcrRotationDegrees?: number | string | null;
}

export interface ClientOcrAttempt {
  result: OcrResult | null;
  source: OcrSource;
  success: boolean;
  fallbackReason?: string;
  diagnostics: OcrDiagnostics;
}

const MAX_TEXT_LENGTH = 30_000;
const MAX_LINES = 500;
const MAX_LINE_LENGTH = 500;

export function clientOcrResult(fields: ClientOcrFields): OcrResult | null {
  return clientOcrAttempt(fields).result;
}

export function clientOcrAttempt(fields: ClientOcrFields): ClientOcrAttempt {
  const rawText = normalizeMultiline(fields.nativeOcrText ?? '').slice(
    0,
    MAX_TEXT_LENGTH,
  );
  const clientReportedSuccess = parseBoolean(fields.nativeOcrSuccess);
  const diagnostics = parseDiagnostics(fields, rawText.length);
  if (!rawText || clientReportedSuccess === false) {
    return {
      result: null,
      source: 'NO_RESULT',
      success: false,
      fallbackReason: sanitizeReason(
        fields.nativeOcrFallbackReason ||
          (!rawText ? 'ML_KIT_EMPTY_TEXT' : 'ML_KIT_REPORTED_FAILURE'),
      ),
      diagnostics,
    };
  }

  const lines = parseLines(fields.nativeOcrLines);
  const numericConfidence = Number(fields.nativeOcrConfidence);
  const confidence = Number.isFinite(numericConfidence)
    ? clamp(
        numericConfidence <= 1 ? numericConfidence * 100 : numericConfidence,
        0,
        100,
      )
    : averageLineConfidence(lines);

  const result: OcrResult = {
    success: true,
    rawText,
    confidence,
    wordsCount: rawText.split(/\s+/).filter(Boolean).length,
    engine: 'mlkit',
    source: 'ML_KIT',
    diagnostics,
    lines: lines.length
      ? lines
      : rawText
          .split(/\r?\n/)
          .map((text) => text.trim())
          .filter(Boolean)
          .slice(0, MAX_LINES)
          .map((text) => ({ text, confidence: confidence / 100 })),
  };

  return {
    result,
    source: 'ML_KIT',
    success: true,
    diagnostics,
  };
}

function parseLines(value?: string | null): OcrLine[] {
  if (!value?.trim()) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];

  return parsed
    .slice(0, MAX_LINES)
    .map((line): OcrLine | null => {
      if (!line || typeof line !== 'object') return null;
      const item = line as Record<string, unknown>;
      const text =
        typeof item.text === 'string'
          ? item.text.trim().slice(0, MAX_LINE_LENGTH)
          : '';
      if (!text) return null;
      const confidenceValue = Number(item.confidence);
      const confidence = Number.isFinite(confidenceValue)
        ? clamp(
            confidenceValue > 1 ? confidenceValue / 100 : confidenceValue,
            0,
            1,
          )
        : 0;

      return {
        text,
        confidence,
        bbox: parseBoundingBox(item.bbox),
      };
    })
    .filter((line): line is OcrLine => Boolean(line));
}

function parseBoundingBox(value: unknown): number[][] | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    return undefined;
  const box = value as Record<string, unknown>;
  const left = Number(box.left);
  const top = Number(box.top);
  const right = Number(box.right);
  const bottom = Number(box.bottom);
  if (![left, top, right, bottom].every(Number.isFinite)) return undefined;
  return [
    [left, top],
    [right, top],
    [right, bottom],
    [left, bottom],
  ];
}

function averageLineConfidence(lines: OcrLine[]) {
  const known = lines
    .map((line) => line.confidence)
    .filter((value) => value > 0);
  if (!known.length) return 0;
  return (known.reduce((sum, value) => sum + value, 0) / known.length) * 100;
}

function normalizeMultiline(value: string) {
  return value
    .split(/\r?\n/)
    .map((line) => line.replace(/[\t ]+/g, ' ').trim())
    .filter(Boolean)
    .join('\n');
}

function parseBoolean(value: boolean | string | null | undefined) {
  if (typeof value === 'boolean') return value;
  if (typeof value !== 'string' || !value.trim()) return undefined;
  return value.trim().toLowerCase() === 'true';
}

function parseDiagnostics(
  fields: ClientOcrFields,
  textLength: number,
): OcrDiagnostics {
  return {
    textLength,
    blockCount: boundedInteger(fields.nativeOcrBlockCount),
    lineCount: boundedInteger(fields.nativeOcrLineCount),
    elementCount: boundedInteger(fields.nativeOcrElementCount),
    processingMs: boundedInteger(fields.nativeOcrProcessingMs, 300_000),
  };
}

function boundedInteger(value: unknown, max = 100_000) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.round(clamp(parsed, 0, max));
}

function sanitizeReason(value: string) {
  return (
    value
      .trim()
      .replace(/[^A-Z0-9_:-]+/gi, '_')
      .slice(0, 80) || 'UNKNOWN'
  );
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}
