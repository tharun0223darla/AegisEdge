import { OcrEvidence } from './interfaces/ocr-evidence.interface';
import { ensureOcrEvidenceId, normalizeOcrText } from './ocr-evidence.util';

export type PrescriptionDosageForm =
  | 'Tablet'
  | 'Capsule'
  | 'Syrup'
  | 'Injection'
  | 'Drops'
  | 'Cream'
  | 'Ointment'
  | 'Gel'
  | 'Inhaler'
  | 'Solution'
  | 'Suspension'
  | 'Powder'
  | 'Spray';

export interface PrescriptionRowEvidence {
  evidence: OcrEvidence;
  dosageForm: PrescriptionDosageForm;
  anchorText: string;
  sourceEvidenceIds: string[];
}

interface AnchorMatch {
  dosageForm: PrescriptionDosageForm;
  normalizedText: string;
}

interface BoxMetrics {
  xMin: number;
  yMin: number;
  xMax: number;
  yMax: number;
  width: number;
  height: number;
  centerY: number;
}

const FORM_ALIASES = new Map<string, PrescriptionDosageForm>([
  ['tab', 'Tablet'],
  ['tabs', 'Tablet'],
  ['tablet', 'Tablet'],
  ['tablets', 'Tablet'],
  ['tbl', 'Tablet'],
  ['tb', 'Tablet'],
  ['tob', 'Tablet'],
  // Common handwriting OCR substitutions observed at the dosage-form position.
  ['tal', 'Tablet'],
  ['pal', 'Tablet'],
  ['pub', 'Tablet'],
  ['inb', 'Tablet'],
  ['cap', 'Capsule'],
  ['caps', 'Capsule'],
  ['capsule', 'Capsule'],
  ['capsules', 'Capsule'],
  ['cab', 'Capsule'],
  ['capi', 'Capsule'],
  ['syp', 'Syrup'],
  ['syr', 'Syrup'],
  ['syrup', 'Syrup'],
  ['byp', 'Syrup'],
  ['inj', 'Injection'],
  ['injection', 'Injection'],
  ['drop', 'Drops'],
  ['drops', 'Drops'],
  ['cream', 'Cream'],
  ['ointment', 'Ointment'],
  ['gel', 'Gel'],
  ['inhaler', 'Inhaler'],
  ['solution', 'Solution'],
  ['susp', 'Suspension'],
  ['suspension', 'Suspension'],
  ['powder', 'Powder'],
  ['spray', 'Spray'],
]);

const CONTINUATION_PATTERN =
  /(?:\b\d+(?:\.\d+)?\s*(?:mcg|ug|mg|g|ml|iu|units?)\b|\b(?:od|bd|bid|tds|tid|qid|sos|prn|hs|daily|weekly|twice|thrice)\b|\b(?:before|after|with)\s+(?:food|meal|breakfast|lunch|dinner)\b|\b(?:for|x)\s*\d+\s*(?:days?|weeks?|months?)\b|\b(?:qty|quantity)\b|(?:^|\s)\d+(?:\s*[-+]\s*\d+){1,3}(?:\s|$))/i;

/**
 * Converts raw OCR boxes into one medicine row per dosage-form anchor.
 * It deliberately ignores unanchored page text so headers/advice cannot enter
 * the medicine dictionary merely because they resemble a brand name.
 */
export function reconstructPrescriptionRows(
  rawEvidence: OcrEvidence[],
): PrescriptionRowEvidence[] {
  const originalEvidence = rawEvidence
    .map(ensureOcrEvidenceId)
    .filter((item) => normalizeOcrText(item.text).length > 0);
  const consumed = new Set<string>();
  const syntheticSources = new Map<string, string[]>();
  const syntheticAnchors: OcrEvidence[] = [];

  for (const formEvidence of originalEvidence) {
    const dosageForm = matchStandaloneDosageForm(formEvidence.text);
    if (!dosageForm || consumed.has(formEvidence.id!)) continue;
    const medicineEvidence = findStandaloneFormMedicine(
      formEvidence,
      originalEvidence,
      consumed,
    );
    if (!medicineEvidence) continue;

    const synthetic = ensureOcrEvidenceId({
      ...formEvidence,
      id: undefined,
      text: `${dosageForm} ${normalizeOcrText(medicineEvidence.text)}`,
      confidence: Math.round(
        (normalizeConfidence(formEvidence.confidence) +
          normalizeConfidence(medicineEvidence.confidence)) *
          50,
      ),
      bbox: unionBoxes([formEvidence.bbox, medicineEvidence.bbox]),
      variant: `${formEvidence.variant}:joined-form`,
    });
    consumed.add(formEvidence.id!);
    consumed.add(medicineEvidence.id!);
    syntheticSources.set(synthetic.id!, [
      formEvidence.id!,
      medicineEvidence.id!,
    ]);
    syntheticAnchors.push(synthetic);
  }

  const evidence = [
    ...originalEvidence.filter((item) => !consumed.has(item.id!)),
    ...syntheticAnchors,
  ];
  const anchors = evidence
    .map((item) => ({ item, match: matchDosageFormAnchor(item.text) }))
    .filter(
      (entry): entry is { item: OcrEvidence; match: AnchorMatch } =>
        entry.match !== null && hasUsableBox(entry.item.bbox),
    );

  return anchors
    .map(({ item: anchor, match }) => {
      const anchorBox = boxMetrics(anchor.bbox)!;
      const grouped = [anchor];

      for (const candidate of evidence) {
        if (
          candidate.id === anchor.id ||
          matchDosageFormAnchor(candidate.text)
        ) {
          continue;
        }
        if (!isMedicationContinuation(candidate.text)) continue;
        const candidateBox = boxMetrics(candidate.bbox);
        if (!candidateBox) continue;
        if (candidateBox.xMin < anchorBox.xMin - anchorBox.width * 0.12) {
          continue;
        }

        const nearestAnchor = nearestCompatibleAnchor(candidate, anchors);
        if (nearestAnchor?.item.id === anchor.id) grouped.push(candidate);
      }

      grouped.sort((left, right) => {
        const leftBox = boxMetrics(left.bbox)!;
        const rightBox = boxMetrics(right.bbox)!;
        return leftBox.xMin - rightBox.xMin || leftBox.yMin - rightBox.yMin;
      });

      const combinedText = [
        match.normalizedText,
        ...grouped.slice(1).map((item) => normalizeOcrText(item.text)),
      ]
        .filter(Boolean)
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim();
      const combinedBox = unionBoxes(grouped.map((item) => item.bbox));
      const totalWeight = grouped.reduce(
        (sum, entry) => sum + Math.max(normalizeOcrText(entry.text).length, 1),
        0,
      );
      const confidence =
        grouped.reduce(
          (sum, entry) =>
            sum +
            normalizeConfidence(entry.confidence) *
              Math.max(normalizeOcrText(entry.text).length, 1),
          0,
        ) / Math.max(totalWeight, 1);
      const reconstructed = ensureOcrEvidenceId({
        ...anchor,
        id: undefined,
        text: combinedText,
        confidence: Math.round(confidence * 100),
        bbox: combinedBox,
        variant: `${anchor.variant}:prescription-row`,
      });

      return {
        evidence: reconstructed,
        dosageForm: match.dosageForm,
        anchorText: anchor.text,
        sourceEvidenceIds: grouped.flatMap(
          (entry) => syntheticSources.get(entry.id!) ?? [entry.id!],
        ),
      };
    })
    .sort((left, right) => {
      const leftBox = boxMetrics(left.evidence.bbox)!;
      const rightBox = boxMetrics(right.evidence.bbox)!;
      return leftBox.yMin - rightBox.yMin || leftBox.xMin - rightBox.xMin;
    });
}

function matchStandaloneDosageForm(
  text: string,
): PrescriptionDosageForm | null {
  const normalized = stripRowPrefix(normalizeOcrText(text))
    .replace(/[.:;,]+$/u, '')
    .trim()
    .toLocaleLowerCase()
    .replace(/[^a-z]/g, '');
  return FORM_ALIASES.get(normalized) ?? null;
}

function findStandaloneFormMedicine(
  formEvidence: OcrEvidence,
  evidence: OcrEvidence[],
  consumed: Set<string>,
): OcrEvidence | null {
  const formBox = boxMetrics(formEvidence.bbox);
  if (!formBox) return null;

  return (
    evidence
      .filter((candidate) => {
        if (
          candidate.id === formEvidence.id ||
          consumed.has(candidate.id!) ||
          matchDosageFormAnchor(candidate.text) ||
          matchStandaloneDosageForm(candidate.text)
        ) {
          return false;
        }
        const candidateBox = boxMetrics(candidate.bbox);
        if (!candidateBox || !verticallyCompatible(formBox, candidateBox)) {
          return false;
        }
        if (candidateBox.xMin < formBox.xMin - formBox.width * 0.1) {
          return false;
        }
        const letters = normalizeOcrText(candidate.text).replace(
          /[^\p{L}]/gu,
          '',
        );
        return letters.length >= 4 && !isAdministrativeText(candidate.text);
      })
      .map((candidate) => {
        const candidateBox = boxMetrics(candidate.bbox)!;
        return {
          candidate,
          score:
            Math.abs(candidateBox.centerY - formBox.centerY) +
            Math.max(0, candidateBox.xMin - formBox.xMax) * 0.15,
        };
      })
      .sort((left, right) => left.score - right.score)[0]?.candidate ?? null
  );
}

export function matchDosageFormAnchor(text: string): AnchorMatch | null {
  const normalized = stripRowPrefix(normalizeOcrText(text)).trim();
  const prefixMatch = /^([\p{L}]{2,12})\.?\s+(.+)$/u.exec(normalized);
  if (prefixMatch) {
    const alias = prefixMatch[1].toLocaleLowerCase().replace(/[^a-z]/g, '');
    const dosageForm = FORM_ALIASES.get(alias);
    const medicineText = prefixMatch[2].trim();
    if (dosageForm && /[\p{L}]{3}/u.test(medicineText)) {
      return {
        dosageForm,
        normalizedText: `${dosageForm} ${medicineText}`,
      };
    }
  }

  // Older and international prescriptions commonly put the form after the
  // medicine, for example "Amoxicillin 500mg Cap #21".
  const suffixMatch =
    /^(.+?)\s+([\p{L}]{2,12})\.?(\s+(?:#|no\.?|qty\.?)?\s*\d+)?$/iu.exec(
      normalized,
    );
  if (!suffixMatch) return null;

  const suffixAlias = suffixMatch[2].toLocaleLowerCase().replace(/[^a-z]/g, '');
  const suffixDosageForm = FORM_ALIASES.get(suffixAlias);
  const suffixMedicineText = suffixMatch[1].trim();
  const hasMedicationQualifier =
    /\b\d+(?:\.\d+)?\s*(?:mcg|ug|mg|g|ml|iu|units?|%)\b/iu.test(
      suffixMedicineText,
    ) || !!suffixMatch[3];
  if (
    !suffixDosageForm ||
    !/[\p{L}]{3}/u.test(suffixMedicineText) ||
    !hasMedicationQualifier
  ) {
    return null;
  }

  return {
    dosageForm: suffixDosageForm,
    normalizedText: `${suffixDosageForm} ${suffixMedicineText}${
      suffixMatch[3] ?? ''
    }`,
  };
}

function stripRowPrefix(text: string): string {
  return text
    .replace(/^[\s\-_*]+/u, '')
    .replace(/^(?:\p{No}|\(?\d{1,2}\)?[.)]?)\s*/u, '');
}

function nearestCompatibleAnchor(
  candidate: OcrEvidence,
  anchors: Array<{ item: OcrEvidence; match: AnchorMatch | null }>,
): { item: OcrEvidence; match: AnchorMatch } | null {
  const candidateBox = boxMetrics(candidate.bbox);
  if (!candidateBox) return null;

  let nearest: {
    item: OcrEvidence;
    match: AnchorMatch;
    distance: number;
  } | null = null;
  for (const entry of anchors) {
    if (!entry.match) continue;
    const anchorBox = boxMetrics(entry.item.bbox);
    if (!anchorBox || !verticallyCompatible(anchorBox, candidateBox)) continue;
    const distance = Math.abs(anchorBox.centerY - candidateBox.centerY);
    if (!nearest || distance < nearest.distance) {
      nearest = { item: entry.item, match: entry.match, distance };
    }
  }
  return nearest;
}

function verticallyCompatible(left: BoxMetrics, right: BoxMetrics): boolean {
  const overlap = Math.max(
    0,
    Math.min(left.yMax, right.yMax) - Math.max(left.yMin, right.yMin),
  );
  const overlapRatio =
    overlap / Math.max(1, Math.min(left.height, right.height));
  const centerDistance = Math.abs(left.centerY - right.centerY);
  const distanceLimit = Math.max(
    32,
    Math.min(150, Math.max(left.height, right.height) * 0.72),
  );
  return overlapRatio >= 0.25 || centerDistance <= distanceLimit;
}

function isMedicationContinuation(text: string): boolean {
  return CONTINUATION_PATTERN.test(normalizeOcrText(text));
}

function isAdministrativeText(text: string): boolean {
  return /\b(?:patient|doctor|hospital|address|advice|diagnosis|exercise|physiotherapy|signature|date|age|sex|gender|phone|knee|pain)\b/i.test(
    normalizeOcrText(text),
  );
}

function hasUsableBox(box: number[]): boolean {
  return boxMetrics(box) !== null;
}

function boxMetrics(box: number[]): BoxMetrics | null {
  if (!Array.isArray(box) || box.length !== 4) return null;
  const [xMin, yMin, xMax, yMax] = box.map(Number);
  if (![xMin, yMin, xMax, yMax].every(Number.isFinite)) return null;
  if (xMax <= xMin || yMax <= yMin) return null;
  return {
    xMin,
    yMin,
    xMax,
    yMax,
    width: xMax - xMin,
    height: yMax - yMin,
    centerY: (yMin + yMax) / 2,
  };
}

function unionBoxes(boxes: number[][]): number[] {
  const metrics = boxes
    .map(boxMetrics)
    .filter((box): box is BoxMetrics => !!box);
  return [
    Math.min(...metrics.map((box) => box.xMin)),
    Math.min(...metrics.map((box) => box.yMin)),
    Math.max(...metrics.map((box) => box.xMax)),
    Math.max(...metrics.map((box) => box.yMax)),
  ];
}

function normalizeConfidence(value: number): number {
  const normalized = value > 1 ? value / 100 : value;
  return Math.max(0, Math.min(1, normalized));
}
