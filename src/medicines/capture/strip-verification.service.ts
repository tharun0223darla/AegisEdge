import { Injectable } from '@nestjs/common';

export type StripVerificationStatus = 'MATCH' | 'MISMATCH' | 'UNCERTAIN';

export interface StripVerificationTarget {
  medicineName: string;
  brandName?: string | null;
  masterBrandName?: string | null;
  genericName?: string | null;
  composition?: string | null;
  saltDisplayName?: string | null;
  strength?: string | null;
  referenceOcrText?: string | null;
}

export interface StripVerificationInput {
  ocrText: string;
  ocrConfidence?: number;
  engine?: string;
}

export interface StripVerificationResult {
  status: StripVerificationStatus;
  score: number;
  reason: string;
  matchedEvidence: string[];
  ocrConfidence: number;
  engine?: string;
}

const STOP_WORDS = new Set([
  'tablet',
  'tablets',
  'capsule',
  'capsules',
  'injection',
  'syrup',
  'suspension',
  'cream',
  'ointment',
  'drops',
  'strip',
  'bottle',
  'each',
  'contains',
  'equivalent',
  'manufactured',
  'marketed',
  'batch',
  'number',
  'mfg',
  'exp',
  'expiry',
  'price',
  'maximum',
  'retail',
  'inclusive',
  'taxes',
  'medicine',
  'keep',
  'away',
  'children',
  'acid',
  'sodium',
  'hydrochloride',
  'ip',
  'usp',
  'bp',
  'mg',
  'mcg',
  'gm',
  'ml',
]);

const MIN_OCR_CONFIDENCE_FOR_IDENTITY = 25;

@Injectable()
export class StripVerificationService {
  verify(
    target: StripVerificationTarget,
    input: StripVerificationInput,
  ): StripVerificationResult {
    const ocrText = this.normalize(input.ocrText);
    const ocrCompact = this.compact(ocrText);
    const confidence = this.normalizeConfidence(input.ocrConfidence);
    const matchedEvidence: string[] = [];

    if (!ocrCompact) {
      return this.result(
        'UNCERTAIN',
        0,
        'No readable printed text was found.',
        [],
        confidence,
        input.engine,
      );
    }

    // A textual coincidence is not enough for a safety-facing green result.
    // Very low confidence must remain review-only.
    if (confidence < MIN_OCR_CONFIDENCE_FOR_IDENTITY) {
      return this.result(
        'UNCERTAIN',
        0,
        'Printed text was detected, but image quality is too low to confirm this medicine. Retake the photo with the brand and strength in focus.',
        [],
        confidence,
        input.engine,
      );
    }

    const expectedStrengths = this.extractStrengths(target.strength ?? '');
    const observedStrengths = this.extractStrengths(input.ocrText);
    const expectedNumerics = expectedStrengths.map((s) => s.replace(/[^\d.]/g, '')).filter(Boolean);
    const strengthMatched =
      expectedStrengths.length === 0 ||
      expectedStrengths.some((strength) => observedStrengths.includes(strength)) ||
      (expectedNumerics.length > 0 && expectedNumerics.some((num) => ocrCompact.includes(num)));
    if (
      expectedStrengths.length > 0 &&
      observedStrengths.length > 0 &&
      !strengthMatched
    ) {
      return this.result(
        confidence >= 45 ? 'MISMATCH' : 'UNCERTAIN',
        0,
        `Printed strength ${observedStrengths.join(', ')} does not match saved strength ${expectedStrengths.join(', ')}.`,
        [],
        confidence,
        input.engine,
      );
    }

    const brandLabels = [
      target.medicineName,
      target.brandName,
      target.masterBrandName,
    ]
      .map((value) => value?.trim())
      .filter((value): value is string =>
        Boolean(value && this.compact(value).length >= 4),
      );

    for (const label of Array.from(new Set(brandLabels))) {
      const compactLabel = this.compact(label);
      if (ocrCompact.includes(compactLabel)) {
        matchedEvidence.push(`brand:${label}`);
        const brandHasStrength = expectedNumerics.some((num) => compactLabel.includes(num));
        if (expectedStrengths.length > 0 && observedStrengths.length === 0 && !brandHasStrength && !strengthMatched) {
          return this.result(
            'UNCERTAIN',
            0.75,
            `Brand matches ${label}, but the strength is not readable.`,
            matchedEvidence,
            confidence,
            input.engine,
          );
        }
        return this.result(
          'MATCH',
          0.99,
          `Printed brand matches ${label}.`,
          matchedEvidence,
          confidence,
          input.engine,
        );
      }
    }

    const observedPhrases = this.phrases(ocrText);
    const fuzzyBrand = brandLabels
      .map((label) => ({
        label,
        score: this.bestDice(this.compact(label), observedPhrases),
      }))
      .sort((left, right) => right.score - left.score)[0];
    if (fuzzyBrand?.score >= 0.8) {
      matchedEvidence.push(`brand-near:${fuzzyBrand.label}`);
      const compactFuzzy = this.compact(fuzzyBrand.label);
      const brandHasStrength = expectedNumerics.some((num) => compactFuzzy.includes(num));
      if (expectedStrengths.length > 0 && observedStrengths.length === 0 && !brandHasStrength && !strengthMatched) {
        return this.result(
          'UNCERTAIN',
          fuzzyBrand.score,
          `Brand appears to match ${fuzzyBrand.label}, but the strength is not readable.`,
          matchedEvidence,
          confidence,
          input.engine,
        );
      }
      return this.result(
        'MATCH',
        Math.min(0.94, fuzzyBrand.score),
        `Printed brand closely matches ${fuzzyBrand.label}.`,
        matchedEvidence,
        confidence,
        input.engine,
      );
    }

    const compositionText = [
      target.genericName,
      target.composition,
      target.saltDisplayName,
    ]
      .filter(Boolean)
      .join(' ');
    const compositionTokens = this.significantTokens(compositionText);
    const observedTokens = new Set(this.significantTokens(ocrText));
    const compositionMatches = compositionTokens.filter((token) =>
      observedTokens.has(token),
    );
    const compositionCoverage = this.coverage(
      compositionMatches.length,
      compositionTokens.length,
    );
    const compositionRequired = compositionTokens.length <= 1 ? 1 : 0.67;
    if (
      compositionTokens.length > 0 &&
      compositionCoverage >= compositionRequired
    ) {
      matchedEvidence.push(
        ...compositionMatches.map((token) => `composition:${token}`),
      );
      if (expectedStrengths.length > 0 && observedStrengths.length === 0) {
        return this.result(
          'UNCERTAIN',
          0.75,
          'Composition matches, but the strength is not readable.',
          matchedEvidence,
          confidence,
          input.engine,
        );
      }
      return this.result(
        'MATCH',
        Math.min(0.92, 0.76 + compositionCoverage * 0.16),
        'Printed composition matches the saved medicine identity.',
        matchedEvidence,
        confidence,
        input.engine,
      );
    }

    const referenceTokens = this.significantTokens(
      target.referenceOcrText ?? '',
    );
    const referenceMatches = referenceTokens.filter((token) =>
      observedTokens.has(token),
    );
    const referenceCoverage = this.coverage(
      referenceMatches.length,
      referenceTokens.length,
    );
    if (referenceMatches.length >= 3 && referenceCoverage >= 0.4) {
      matchedEvidence.push(
        ...referenceMatches.slice(0, 8).map((token) => `reference:${token}`),
      );
      if (expectedStrengths.length > 0 && observedStrengths.length === 0) {
        return this.result(
          'UNCERTAIN',
          0.74,
          'Strip text resembles the saved reference, but the strength is not readable.',
          matchedEvidence,
          confidence,
          input.engine,
        );
      }
      return this.result(
        'MATCH',
        Math.min(0.9, 0.72 + referenceCoverage * 0.18),
        'Printed text matches the stored strip reference.',
        matchedEvidence,
        confidence,
        input.engine,
      );
    }

    const observedWordCount = this.significantTokens(ocrText).length;
    const hasNearEvidence =
      (fuzzyBrand?.score ?? 0) >= 0.58 ||
      compositionCoverage >= 0.4 ||
      referenceCoverage >= 0.25;
    if (confidence < 45 || observedWordCount < 2 || hasNearEvidence) {
      return this.result(
        'UNCERTAIN',
        Math.max(
          fuzzyBrand?.score ?? 0,
          compositionCoverage,
          referenceCoverage,
        ),
        'Text is incomplete or partly aligned. Retake the photo with the brand and composition in focus.',
        matchedEvidence,
        confidence,
        input.engine,
      );
    }

    return this.result(
      'MISMATCH',
      0,
      'Readable text does not match the saved brand, composition, or strip reference.',
      matchedEvidence,
      confidence,
      input.engine,
    );
  }

  private result(
    status: StripVerificationStatus,
    score: number,
    reason: string,
    matchedEvidence: string[],
    ocrConfidence: number,
    engine?: string,
  ): StripVerificationResult {
    return {
      status,
      score: Math.round(Math.max(0, Math.min(1, score)) * 100) / 100,
      reason,
      matchedEvidence,
      ocrConfidence,
      engine,
    };
  }

  private significantTokens(value: string) {
    return Array.from(
      new Set(
        this.normalize(value)
          .split(/\s+/)
          .map((token) => token.replace(/^\d+|\d+$/g, ''))
          .filter((token) => token.length >= 4 && !STOP_WORDS.has(token)),
      ),
    );
  }

  private phrases(value: string) {
    const tokens = this.normalize(value).split(/\s+/).filter(Boolean);
    const phrases = [...tokens];
    for (let index = 0; index < tokens.length - 1; index += 1) {
      phrases.push(`${tokens[index]}${tokens[index + 1]}`);
    }
    return phrases.map((phrase) => this.compact(phrase)).filter(Boolean);
  }

  private bestDice(expected: string, candidates: string[]) {
    return candidates.reduce(
      (best, candidate) => Math.max(best, this.dice(expected, candidate)),
      0,
    );
  }

  private dice(left: string, right: string) {
    if (left === right) return 1;
    if (left.length < 2 || right.length < 2) return 0;
    const pairs = new Map<string, number>();
    for (let index = 0; index < left.length - 1; index += 1) {
      const pair = left.slice(index, index + 2);
      pairs.set(pair, (pairs.get(pair) ?? 0) + 1);
    }
    let overlap = 0;
    for (let index = 0; index < right.length - 1; index += 1) {
      const pair = right.slice(index, index + 2);
      const count = pairs.get(pair) ?? 0;
      if (count > 0) {
        overlap += 1;
        pairs.set(pair, count - 1);
      }
    }
    return (2 * overlap) / (left.length + right.length - 2);
  }

  private coverage(matches: number, expected: number) {
    return expected > 0 ? matches / expected : 0;
  }

  private extractStrengths(value: string) {
    return Array.from(
      new Set(
        Array.from(
          value
            .toLowerCase()
            .matchAll(/\b(\d+(?:\.\d+)?)\s*(mcg|mg|g|gm|ml|iu|%)\b/g),
        ).map((match) => `${match[1]}${match[2] === 'gm' ? 'g' : match[2]}`),
      ),
    );
  }

  private normalizeConfidence(value?: number) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return 0;
    const percentage = numeric <= 1 ? numeric * 100 : numeric;
    return Math.round(Math.max(0, Math.min(100, percentage)) * 100) / 100;
  }

  private normalize(value: string) {
    return value
      .normalize('NFKD')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
  }

  private compact(value: string) {
    return this.normalize(value).replace(/\s+/g, '');
  }
}
