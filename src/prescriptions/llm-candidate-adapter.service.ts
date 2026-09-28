import { Injectable } from '@nestjs/common';
import { createHash } from 'crypto';
import { OcrEvidence } from './interfaces/ocr-evidence.interface';
import { CandidateMention } from './interfaces/candidate-generation.interface';
import { StructuredMedicine } from '../extraction/extraction.service';
import { ensureOcrEvidenceId, normalizeOcrText } from './ocr-evidence.util';

@Injectable()
export class LlmCandidateAdapter {
  mapLlmToMentions(
    llmMedicines: StructuredMedicine[],
    evidenceList: OcrEvidence[],
    variantName = 'ORIGINAL',
  ): CandidateMention[] {
    const evidence = evidenceList.map(ensureOcrEvidenceId);
    const mentions: CandidateMention[] = [];

    for (const med of llmMedicines) {
      const canonicalName = med.medicineName?.trim();
      if (!canonicalName) continue;

      const sourceText = med.sourceText?.trim() || canonicalName;
      const matched = this.findBestEvidence(
        sourceText,
        canonicalName,
        evidence,
      );
      const traceabilityStatus = matched ? 'RESOLVED' : 'UNRESOLVED';

      const rawText = matched?.matchedText || sourceText;
      const evidenceRef = matched
        ? {
            evidenceId: matched.evidence.id!,
            lineNumber: matched.evidence.lineNumber,
            text: matched.evidence.text,
            charStart: matched.charStart,
            charEnd: matched.charEnd,
            bbox: matched.evidence.bbox,
            normalizedBbox: matched.evidence.normalizedBbox,
            polygon: matched.evidence.polygon,
            pageIndex: matched.evidence.pageIndex ?? 0,
            engine: matched.evidence.engine,
            variant: matched.evidence.variant,
          }
        : undefined;

      const mentionId = createHash('sha256')
        .update(
          [
            'llm',
            evidenceRef?.evidenceId || 'unresolved',
            normalizeOcrText(canonicalName),
            med.dosage || '',
            med.frequency || '',
            med.durationDays ?? '',
            med.quantity ?? '',
          ].join('|'),
        )
        .digest('hex');

      mentions.push({
        id: mentionId,
        rawText,
        canonicalName,
        normalized: normalizeOcrText(canonicalName).toLowerCase().replace(/\s+/g, ''),
        sourceGenerator: 'llm',
        traceabilityStatus,
        confidence: this.normalizeConfidence(med.confidenceScore),
        variantName: matched?.evidence.variant || variantName,
        dosage: med.dosage || null,
        frequency: med.frequency || null,
        timesOfDay: [],
        durationDays: med.durationDays ?? null,
        quantity: med.quantity ?? null,
        instructions: med.instructions || null,
        evidenceRef,
      });
    }

    return mentions;
  }

  private findBestEvidence(
    sourceText: string,
    medicineName: string,
    evidence: OcrEvidence[],
  ): {
    evidence: OcrEvidence;
    charStart: number;
    charEnd: number;
    matchedText: string;
    score: number;
  } | null {
    const sourceNorm = normalizeOcrText(sourceText);
    const nameNorm = normalizeOcrText(medicineName);
    let best: ReturnType<LlmCandidateAdapter['findBestEvidence']> = null;

    for (const ev of evidence) {
      const line = ev.text || '';
      const lineNorm = normalizeOcrText(line);
      if (!lineNorm) continue;

      const exactSourceIndex = line
        .toLowerCase()
        .indexOf(sourceText.toLowerCase());
      const exactNameIndex = line
        .toLowerCase()
        .indexOf(medicineName.toLowerCase());
      let score = 0;
      let charStart = -1;
      let charEnd = -1;

      if (exactSourceIndex >= 0) {
        score = 1;
        charStart = exactSourceIndex;
        charEnd = exactSourceIndex + sourceText.length;
      } else if (exactNameIndex >= 0) {
        score = 0.98;
        charStart = exactNameIndex;
        charEnd = exactNameIndex + medicineName.length;
      } else {
        const sourceScore = this.similarity(sourceNorm, lineNorm);
        const nameScore = this.bestTokenWindowSimilarity(nameNorm, lineNorm);
        score = Math.max(sourceScore, nameScore);
        if (score >= 0.72) {
          // The precise OCR span is uncertain. Reference the whole evidence line
          // rather than inventing a false character position.
          charStart = 0;
          charEnd = line.length;
        }
      }

      if (score >= 0.72 && (!best || score > best.score)) {
        best = {
          evidence: ev,
          charStart,
          charEnd,
          matchedText: charStart >= 0 ? line.slice(charStart, charEnd) : line,
          score,
        };
      }
    }

    return best;
  }

  private bestTokenWindowSimilarity(target: string, line: string): number {
    const targetTokens = target.split(/\s+/).filter(Boolean);
    const lineTokens = line.split(/\s+/).filter(Boolean);
    if (!targetTokens.length || !lineTokens.length) return 0;

    const windowSize = Math.max(1, targetTokens.length);
    let best = 0;
    for (let i = 0; i < lineTokens.length; i++) {
      const window = lineTokens.slice(i, i + windowSize + 1).join(' ');
      best = Math.max(best, this.similarity(target, window));
    }
    return best;
  }

  private similarity(a: string, b: string): number {
    if (!a || !b) return 0;
    if (a === b) return 1;
    const distance = this.levenshtein(a, b);
    return 1 - distance / Math.max(a.length, b.length, 1);
  }

  private levenshtein(a: string, b: string): number {
    const previous = Array.from({ length: b.length + 1 }, (_, i) => i);
    for (let i = 1; i <= a.length; i++) {
      const current = [i];
      for (let j = 1; j <= b.length; j++) {
        current[j] = Math.min(
          current[j - 1] + 1,
          previous[j] + 1,
          previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
        );
      }
      previous.splice(0, previous.length, ...current);
    }
    return previous[b.length];
  }

  private normalizeConfidence(value: number | undefined): number {
    if (value === undefined || Number.isNaN(value)) return 0.5;
    return Math.max(0, Math.min(1, value > 1 ? value / 100 : value));
  }
}
