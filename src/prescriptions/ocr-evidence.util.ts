import { createHash } from 'crypto';
import { OcrEvidence } from './interfaces/ocr-evidence.interface';

export function normalizeOcrText(value: string): string {
  return (value || '')
    .normalize('NFKC')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function buildOcrEvidenceId(evidence: Omit<OcrEvidence, 'id'>): string {
  const canonical = JSON.stringify({
    pageIndex: evidence.pageIndex ?? 0,
    engine: evidence.engine,
    variant: evidence.variant,
    lineNumber: evidence.lineNumber,
    text: normalizeOcrText(evidence.text),
    bbox: (evidence.normalizedBbox || evidence.bbox || []).map((v) =>
      Number(v.toFixed?.(6) ?? v),
    ),
  });
  return createHash('sha256').update(canonical).digest('hex');
}

export function ensureOcrEvidenceId(evidence: OcrEvidence): OcrEvidence {
  if (evidence.id) return evidence;
  return { ...evidence, id: buildOcrEvidenceId(evidence) };
}

export function normalizeBbox(
  bbox: number[] | undefined,
  width: number | undefined,
  height: number | undefined,
): number[] | undefined {
  if (
    !bbox ||
    bbox.length !== 4 ||
    !width ||
    !height ||
    width <= 0 ||
    height <= 0
  ) {
    return undefined;
  }
  const [x1, y1, x2, y2] = bbox;
  return [x1 / width, y1 / height, x2 / width, y2 / height].map((v) =>
    Math.max(0, Math.min(1, v)),
  );
}
