import { Injectable } from '@nestjs/common';
import type { OcrLine, OcrResult } from '../../ocr/ocr.service';
import { normalizeBaseIngredient } from '../import/salt-canonicalizer';

export interface PackageImageCandidate {
  rawName: string;
  extractedStrength?: string;
  extractedPack?: string;
  ocrLine?: string;
  fullText?: string;
  allLines?: string[];
  composition?: PackageImageCompositionSignal;
  ocrConfidence: number;
  weak: boolean;
  reason?: string;
  alternatives?: string[];
  brandCandidates?: PackageImageBrandCandidate[];
}

export interface PackageImageBrandCandidate {
  name: string;
  ocrLine: string;
  confidence: number;
  parserScore: number;
}

export interface PackageImageCompositionSignal {
  displayName: string;
  ingredients: string[];
  rawLine: string;
  sourceLines: string[];
  confidence: number;
  searchTerms: string[];
}

type PackageOcrInput = Pick<OcrResult, 'rawText' | 'confidence' | 'lines'> &
  Partial<Pick<OcrResult, 'success' | 'source'>>;

@Injectable()
export class PackageImageCaptureService {
  extractCandidate(ocrResult: PackageOcrInput): PackageImageCandidate | null {
    if (!this.isReadableOcrResult(ocrResult)) return null;

    const lines = this.ocrLines(ocrResult);
    const rawText = ocrResult.rawText ?? '';
    const extractedStrength = this.extractStrength(rawText);
    const extractedPack = this.extractPack(rawText);
    const allLines = lines.map((line) => line.text).filter(Boolean);
    const fullText = allLines.length ? allLines.join('\n') : rawText;
    const geometryStats = this.computeGeometryStats(lines);
    const composition = this.extractCompositionSignal(
      lines,
      rawText,
      geometryStats,
    );
    const compositionSourceLines = new Set(
      (composition?.sourceLines ?? []).map((line) => this.normalizeLine(line)),
    );
    const manufacturerKeys = this.extractManufacturerKeys(lines);

    const scored = lines
      .filter(
        (line) =>
          !compositionSourceLines.has(this.normalizeLine(line.text)) &&
          !this.looksLikeCompositionVariant(line.text, composition) &&
          !this.looksLikeCompositionLine(line.text),
      )
      .map((line) =>
        this.scoreLine(
          line,
          extractedStrength,
          manufacturerKeys,
          geometryStats,
        ),
      )
      .filter((item) => item.name.length >= 2 && item.score > 0);
    const nameCounts = new Map<string, number>();
    for (const item of scored) {
      const key = this.normalizeKey(item.name);
      nameCounts.set(key, (nameCounts.get(key) ?? 0) + 1);
    }

    const ranked = scored
      .map((item) => ({
        ...item,
        score:
          item.score +
          ((nameCounts.get(this.normalizeKey(item.name)) ?? 0) > 1 ? 0.25 : 0),
      }))
      .sort((left, right) => right.score - left.score);
    const brandCandidates = Array.from(
      new Map(
        ranked.map(
          (item) =>
            [
              this.normalizeKey(item.name),
              {
                name: item.name,
                ocrLine: item.original,
                confidence: item.confidence,
                parserScore: item.score,
              },
            ] as const,
        ),
      ).values(),
    ).slice(0, 8);

    const best = ranked[0];
    if (!best) {
      if (!composition) return null;

      return {
        rawName: composition.displayName,
        extractedStrength,
        extractedPack,
        ocrLine: composition.rawLine,
        fullText,
        allLines,
        composition,
        ocrConfidence: Math.max(
          composition.confidence,
          this.normalizeConfidence(ocrResult.confidence),
        ),
        weak: true,
        reason: 'Composition detected, brand unclear',
        alternatives: composition.searchTerms,
        brandCandidates: [],
      };
    }

    const overallConfidence = this.normalizeConfidence(ocrResult.confidence);
    const ocrConfidence = Math.max(best.confidence, overallConfidence);
    const weak = ocrConfidence < 0.35 || best.score < 0.45;
    const candidateStrength =
      this.extractStrength(best.original) ??
      this.extractAdjacentStrength(lines, best.original) ??
      this.extractStrengthMatchingBrand(lines, best.name) ??
      this.extractCompositionStrength(composition, lines);
    const alternatives = Array.from(
      new Map(
        brandCandidates
          .filter((item) => item.name !== best.name)
          .map((item) => [this.normalizeKey(item.name), item.name] as const)
          .concat(
            (composition?.searchTerms ?? []).map(
              (term) => [this.normalizeKey(term), term] as const,
            ),
          ),
      ).values(),
    ).slice(0, 5);

    return {
      rawName: best.name,
      extractedStrength: candidateStrength,
      extractedPack,
      ocrLine: best.original,
      fullText,
      allLines,
      composition,
      ocrConfidence,
      weak,
      reason: weak ? 'Low OCR confidence' : undefined,
      alternatives,
      brandCandidates,
    };
  }

  isLowQualityCandidate(candidate: PackageImageCandidate | null) {
    if (!candidate) return true;
    const rawName = candidate.rawName.trim();
    const compact = rawName.replace(/[^a-z0-9]/gi, '');
    const tokenCount = rawName.split(/\s+/).filter(Boolean).length;
    const compactBrand =
      tokenCount <= 3 &&
      compact.length >= 3 &&
      compact.length <= 24 &&
      /[a-z]/i.test(compact) &&
      !this.looksLikeCorporateText(rawName) &&
      !this.looksLikeRegulatoryText(rawName) &&
      !this.looksLikeAddressText(rawName);

    if (
      compactBrand &&
      !this.looksLikeBrokenOcrLine(candidate.ocrLine ?? candidate.rawName) &&
      !this.looksLikeCompositionLine(candidate.ocrLine ?? candidate.rawName)
    ) {
      return false;
    }

    return (
      candidate.weak ||
      candidate.ocrConfidence < 0.5 ||
      this.looksLikeBrokenOcrLine(candidate.ocrLine ?? candidate.rawName) ||
      this.looksLikeCompositionLine(candidate.ocrLine ?? candidate.rawName)
    );
  }

  isReviewableCandidate(candidate: PackageImageCandidate | null) {
    if (!candidate) return false;
    const evidence = candidate.ocrLine ?? candidate.rawName;
    if (
      this.looksLikeBrokenOcrLine(evidence) ||
      this.looksLikeTextNoiseLine(evidence)
    ) {
      return false;
    }
    if (candidate.composition) return true;

    const compact = candidate.rawName.replace(/[^a-z0-9]/gi, '');
    const tokenCount = candidate.rawName.split(/\s+/).filter(Boolean).length;
    return (
      compact.length >= 4 &&
      compact.length <= 32 &&
      tokenCount <= 4 &&
      /[a-z]{3}/i.test(compact) &&
      candidate.ocrConfidence >= 0.25
    );
  }

  isReadableOcrResult(ocrResult: PackageOcrInput) {
    if (ocrResult.success === false || ocrResult.source === 'NO_RESULT') {
      return false;
    }

    const text = this.normalizeLine(ocrResult.rawText ?? '');
    if (!text) return false;

    const tokens = text.split(/\s+/).filter(Boolean);
    const alphaTokens = tokens.filter((token) => /[a-z]/i.test(token));
    if (alphaTokens.length < 2) return false;

    const tinyTokens = alphaTokens.filter(
      (token) => token.replace(/[^a-z]/gi, '').length <= 2,
    ).length;
    const repeatedTokens = alphaTokens.filter((token) => {
      const letters = token.replace(/[^a-z]/gi, '').toLowerCase();
      return letters.length >= 2 && new Set(letters).size === 1;
    }).length;
    const fragmentedRatio = (tinyTokens + repeatedTokens) / alphaTokens.length;
    const hasMedicineStructure =
      /\b(?:tablets?|capsules?|injection|syrup|suspension|cream|ointment|solution|drops?|combipack|blister)\b/i.test(
        text,
      ) ||
      /\b\d+(?:\.\d+)?\s*(?:mg|mcg|ug|g|gm|ml|iu|units?|%)\b/i.test(text) ||
      /\b(?:composition|contains|each|equivalent|ip|usp|bp)\b/i.test(text);
    const hasLongStructuredToken =
      hasMedicineStructure &&
      alphaTokens.some((token) => token.replace(/[^a-z]/gi, '').length >= 6);

    return fragmentedRatio < 0.6 || hasLongStructuredToken;
  }

  private ocrLines(
    ocrResult: Pick<OcrResult, 'rawText' | 'confidence' | 'lines'>,
  ): OcrLine[] {
    const structured = (ocrResult.lines ?? [])
      .map((line) => ({ ...line, text: this.normalizeLine(line.text) }))
      .filter((line) => line.text.length > 0);

    if (structured.length) {
      return structured;
    }

    const confidence = this.normalizeConfidence(ocrResult.confidence);
    return (ocrResult.rawText ?? '')
      .split(/\r?\n/)
      .map((text) => this.normalizeLine(text))
      .filter(Boolean)
      .map((text) => ({ text, confidence }));
  }

  private scoreLine(
    line: OcrLine,
    strength?: string,
    manufacturerKeys = new Set<string>(),
    geometryStats: { medianHeight: number; maxHeight: number; hasGeometry: boolean } = {
      medianHeight: 0,
      maxHeight: 0,
      hasGeometry: false,
    },
  ) {
    const original = line.text;
    const normalized = this.normalizeLine(original);
    const confidence = this.normalizeConfidence(line.confidence);

    if (!this.isPotentialBrandLine(normalized)) {
      return { original, name: '', confidence, score: 0 };
    }

    if (this.looksLikeCompositionLine(normalized)) {
      return { original, name: '', confidence, score: 0 };
    }

    if (
      this.looksLikeBrokenOcrLine(normalized) ||
      this.looksLikeTextNoiseLine(normalized)
    ) {
      return { original, name: '', confidence, score: 0 };
    }

    const lineStrength = this.extractStrength(normalized);
    const name = this.extractName(normalized, strength, lineStrength);
    if (!name) {
      return { original, name: '', confidence, score: 0 };
    }

    const manufacturerPenalty = manufacturerKeys.has(this.normalizeKey(name))
      ? 0.9
      : 0;

    const prominenceScore = this.fontProminenceScore(line.bbox, geometryStats);
    const lengthScore = Math.min(name.length / 24, 1);
    const hasStrengthBonus =
      strength && normalized.toLowerCase().includes(strength.toLowerCase())
        ? 0.2
        : 0;
    const brandShapeBonus = this.brandShapeBonus(name);
    const strengthFragmentPenalty = this.looksLikeStrengthFragment(name)
      ? 0.75
      : 0;
    const repeatedVariantPenalty = this.looksLikeRepeatedVariantLine(normalized)
      ? 0.65
      : 0;

    const isFinePrint =
      geometryStats.hasGeometry &&
      line.bbox &&
      this.lineHeight(line.bbox) < geometryStats.medianHeight * 0.55;
    const finePrintPenalty = isFinePrint ? 0.75 : 0;

    const score =
      confidence * 0.35 +
      prominenceScore * 0.40 +
      lengthScore * 0.15 +
      hasStrengthBonus +
      brandShapeBonus -
      strengthFragmentPenalty -
      repeatedVariantPenalty -
      manufacturerPenalty -
      finePrintPenalty;

    return { original, name, confidence, score };
  }

  private extractCompositionSignal(
    lines: OcrLine[],
    rawText: string,
    geometryStats: { medianHeight: number; maxHeight: number; hasGeometry: boolean } = {
      medianHeight: 0,
      maxHeight: 0,
      hasGeometry: false,
    },
  ): PackageImageCompositionSignal | undefined {
    const windows = this.compositionWindows(lines, rawText);
    const windowCandidates = windows
      .map((window) => {
        const ingredients = this.detectCompositionWindowIngredients(
          window.sourceLines,
          window.text,
        );
        if (ingredients.length === 0) return null;

        const hasFormWord =
          /\b(?:tablet|tablets|tablas|capsule|capsules|syrup|suspension|injection|cream|ointment|gel|solution|drops?)\b/i.test(
            window.text,
          );
        const hasJoiner = /[+&]/.test(window.text) || ingredients.length > 1;
        const hasCompositionCue =
          /\b(?:composition|contains|each|equivalent|eq\.?)\b/i.test(
            window.text,
          );

        const windowHeights = window.sourceLines
          .map((text) =>
            lines.find((l) => this.normalizeLine(l.text) === text)?.bbox,
          )
          .map((bbox) => this.lineHeight(bbox))
          .filter((h) => h > 0);
        const avgHeight = windowHeights.length
          ? windowHeights.reduce((a, b) => a + b, 0) / windowHeights.length
          : 0;
        const prominenceBonus =
          geometryStats.hasGeometry &&
          geometryStats.medianHeight > 0 &&
          avgHeight > 0
            ? Math.min(
                0.2,
                Math.max(
                  -0.1,
                  (avgHeight / geometryStats.medianHeight - 1.0) * 0.15,
                ),
              )
            : 0;

        const confidence = Math.min(
          0.98,
          window.confidence +
            ingredients.length * 0.18 +
            (hasFormWord ? 0.08 : 0) +
            (hasJoiner ? 0.08 : 0) +
            (hasCompositionCue ? 0.06 : 0) +
            prominenceBonus,
        );
        const displayName = ingredients.join(' + ');
        const evidenceLines = this.compositionEvidenceLines(
          window.sourceLines,
          ingredients,
        );

        return {
          displayName,
          ingredients,
          rawLine: window.text,
          sourceLines: evidenceLines,
          confidence,
          searchTerms: this.compositionSearchTerms(ingredients),
        };
      })
      .filter((item): item is PackageImageCompositionSignal => Boolean(item));
    const isKnownSalt = (candidate: PackageImageCompositionSignal) => {
      return candidate.ingredients.some((ing) => {
        const base = normalizeBaseIngredient(ing);
        return Boolean(
          base && base.length >= 4 && base !== this.normalizeKey(ing),
        );
      });
    };

    const candidates = [...windowCandidates].sort((left, right) => {
      const leftKnown = isKnownSalt(left) ? 0.35 : 0;
      const rightKnown = isKnownSalt(right) ? 0.35 : 0;
      const leftScore = left.confidence + leftKnown;
      const rightScore = right.confidence + rightKnown;
      if (Math.abs(rightScore - leftScore) > 0.05) {
        return rightScore - leftScore;
      }
      if (right.ingredients.length !== left.ingredients.length) {
        return right.ingredients.length - left.ingredients.length;
      }
      return right.confidence - left.confidence;
    });

    return candidates[0];
  }

  private detectCompositionWindowIngredients(
    sourceLines: string[],
    combinedText: string,
  ) {
    const fromLines = this.uniqueIngredients(
      sourceLines.flatMap((line) => this.detectCompositionIngredients(line)),
    );
    const fromCombined = this.detectCompositionIngredients(combinedText);

    if (fromCombined.length > fromLines.length) return fromCombined;
    return fromLines.length ? fromLines : fromCombined;
  }

  private uniqueIngredients(ingredients: string[]) {
    const result: string[] = [];
    for (const ingredient of ingredients) {
      const key = this.normalizeKey(ingredient);
      const isDuplicateOrVariant = result.some((existing) => {
        const existingKey = this.normalizeKey(existing);
        if (existingKey === key) return true;
        if (
          existingKey.length >= 6 &&
          key.length >= 6 &&
          (existingKey.endsWith(key.slice(-5)) || key.endsWith(existingKey.slice(-5))) &&
          this.editDistance(existingKey, key) <= 3
        ) {
          return true;
        }
        return false;
      });

      if (!isDuplicateOrVariant) {
        result.push(ingredient);
      }
    }
    return result;
  }

  private compositionWindows(lines: OcrLine[], rawText: string) {
    const sourceLines = (
      lines.length ? lines.map((line) => line.text) : rawText.split(/\r?\n/)
    )
      .map((line) => this.normalizeLine(line))
      .filter(Boolean);
    const windows: Array<{
      text: string;
      sourceLines: string[];
      confidence: number;
    }> = [];
    const lineConfidence = (lineText: string) =>
      lines.find((line) => this.normalizeLine(line.text) === lineText)
        ?.confidence ?? 0.45;

    for (let index = 0; index < sourceLines.length; index += 1) {
      for (const span of [1, 2, 3]) {
        const slice = sourceLines.slice(index, index + span);
        if (slice.length !== span) continue;
        if (
          span > 1 &&
          slice.some(
            (line) =>
              this.looksLikeCorporateText(line) ||
              this.looksLikeAddressText(line) ||
              this.looksLikeRegulatoryText(line) ||
              /\b(?:mfg|manufactured|marketed|lic\.?\s*no|healthcare|pvt|ltd|limited|subsidiary)\b/i.test(
                line,
              ),
          )
        ) {
          continue;
        }
        if (
          span > 1 &&
          this.isBrandCandidateLine(slice[0]) &&
          !/\b(?:composition|contains|each|equivalent|eq\.?)\b/i.test(slice[0]) &&
          !this.looksLikeCompositionLine(slice[0])
        ) {
          continue;
        }
        const text = slice.join(' ');
        if (text.length < 6) continue;
        const confidence =
          slice.reduce(
            (sum, line) => sum + this.normalizeConfidence(lineConfidence(line)),
            0,
          ) / slice.length;

        windows.push({ text, sourceLines: slice, confidence });
      }
    }

    if (rawText.trim() && sourceLines.length === 0) {
      windows.push({
        text: this.normalizeLine(rawText.replace(/\r?\n/g, ' ')),
        sourceLines,
        confidence: 0.35,
      });
    }

    return windows;
  }

  private detectCompositionIngredients(text: string) {
    const ingredients: string[] = [];

    const pharmacopoeiaIngredient = this.extractPharmacopoeiaIngredient(text);
    if (pharmacopoeiaIngredient) {
      ingredients.push(pharmacopoeiaIngredient);
      return ingredients;
    }

    const genericIngredients = this.extractGenericIngredients(text);
    for (const ingredient of genericIngredients) {
      const canonical = normalizeBaseIngredient(ingredient);
      const formatted = this.toTitleCase(
        canonical &&
          canonical.length >= 4 &&
          canonical !== this.normalizeKey(ingredient)
          ? canonical
          : ingredient,
      );
      if (
        !ingredients.some(
          (existing) =>
            this.normalizeKey(existing) === this.normalizeKey(formatted) ||
            normalizeBaseIngredient(existing) ===
              normalizeBaseIngredient(formatted),
        )
      ) {
        ingredients.push(formatted);
      }
    }

    if (ingredients.length === 0) {
      const singleIngredient = this.extractSingleGenericIngredient(text);
      if (singleIngredient) {
        const canonical = normalizeBaseIngredient(singleIngredient);
        const formatted = this.toTitleCase(
          canonical &&
            canonical.length >= 4 &&
            canonical !== this.normalizeKey(singleIngredient)
            ? canonical
            : singleIngredient,
        );
        if (
          !ingredients.some(
            (existing) =>
              this.normalizeKey(existing) === this.normalizeKey(formatted) ||
              normalizeBaseIngredient(existing) ===
                normalizeBaseIngredient(formatted),
          )
        ) {
          ingredients.push(formatted);
        }
      }
    }

    return ingredients;
  }

  private toTitleCase(value: string) {
    return value
      .split(/\s+/)
      .map(
        (word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase(),
      )
      .join(' ');
  }

  private extractPharmacopoeiaIngredient(text: string) {
    const normalized = this.normalizeLine(text)
      .replace(/^.*?\b(?:contains|each)\b\s*/i, ' ')
      .replace(/^[\d\s.,:/%+-]+/g, '')
      .replace(/\s+/g, ' ')
      .trim();

    if (
      this.looksLikeRegulatoryText(normalized) ||
      this.looksLikeCorporateText(normalized) ||
      this.looksLikeAddressText(normalized)
    ) {
      return undefined;
    }

    const match =
      /^([a-z][a-z '-]{2,40}?)\s+(?:IP|I\.P\.|USP|BP|EP|JP|J\.P\.|NF|Ph\.?\s*Eur|eq\.?\s+to)\b/i.exec(
        normalized,
      );
    if (match) {
      const name = match[1]
        .replace(
          /^(?:each|tablet|capsule|delayed|release|contains|film|coated)\s+/gi,
          '',
        )
        .replace(
          /\b(?:tablets?|tabs?|capsules?|caps?|injection|syrup|suspension|drops?|cream|ointment|gel|solution)\b/gi,
          '',
        )
        .trim();
      const words = name.split(/\s+/).filter(Boolean);
      if (words.length >= 1 && words.length <= 3 && name.length >= 4) {
        const canonical = normalizeBaseIngredient(name);
        if (canonical && canonical.length >= 4 && canonical !== this.normalizeKey(name)) {
          return canonical.charAt(0).toUpperCase() + canonical.slice(1);
        }
        return words
          .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
          .join(' ');
      }
    }

    return undefined;
  }

  private extractSingleGenericIngredient(text: string) {
    const normalized = this.normalizeLine(text)
      .replace(/^[^a-z]+/i, '')
      .replace(/\b(?:rx|schedule)\b/gi, ' ')
      .replace(/\b\d+(?:\.\d+)?\s*(?:mg|mcg|ug|g|gm|ml|iu|units?|%)\b/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    if (
      this.looksLikeRegulatoryText(normalized) ||
      this.looksLikeCorporateText(normalized) ||
      this.looksLikeAddressText(normalized)
    ) {
      return undefined;
    }

    const match =
      /^([a-z][a-z '-]{2,64}?)\s+(?:(?:extended|sustained|controlled|modified|delayed|prolonged)\s+release\s+|(?:dispersible|chewable|enteric[- ]coated|film[- ]coated)\s+)*(?:tablets?|tablas?|capsules?|injection|syrup|suspension|cream|ointment|gel|solution|drops?)\b/i.exec(
        normalized,
      );
    let candidate = match?.[1];
    if (!candidate) {
      const words = normalized.split(/\s+/).filter(Boolean);
      const formIndex = words.findIndex((word) =>
        this.looksLikeDosageFormToken(word),
      );
      if (formIndex > 0) {
        candidate = words.slice(0, formIndex).join(' ');
      }
    }
    candidate = candidate
      ?.replace(/^.*?\b(?:trademark|trade mark|applied for)\b\s*/i, ' ')
      ?.replace(
        /\b(?:each|composition|contains|equivalent|coated|uncoated)\b/gi,
        ' ',
      )
      .replace(
        /\b(?:extended|sustained|controlled|modified|delayed|prolonged|release|dispersible|chewable|enteric|film)\b\s*$/gi,
        ' ',
      )
      .replace(/\s+/g, ' ')
      .trim();
    if (
      !candidate ||
      /^(?:film|coated|uncoated|delayed|extended|sustained|release|tablets?|capsules?|sugar|enteric|effervescent|dispersible|mouth\s*dissolving|film[- ]?coated)[- ]*$/i.test(
        candidate,
      )
    ) {
      return undefined;
    }

    candidate = this.removeShortOcrPrefix(candidate);

    let candidateWords = candidate.split(/\s+/).filter(Boolean);
    const rejectedPrefixEnd = candidateWords.reduce(
      (lastIndex, word, index) =>
        this.looksLikeCorporateText(word) || this.looksLikeRegulatoryText(word)
          ? index
          : lastIndex,
      -1,
    );
    if (
      rejectedPrefixEnd >= 0 &&
      rejectedPrefixEnd < candidateWords.length - 1
    ) {
      candidateWords = candidateWords.slice(rejectedPrefixEnd + 1);
      candidate = candidateWords.join(' ');
    }
    const lastNumericIndex = candidateWords.reduce(
      (found, word, index) => (/\d/.test(word) ? index : found),
      -1,
    );
    if (lastNumericIndex >= 0 && lastNumericIndex < candidateWords.length - 1) {
      candidateWords = candidateWords.slice(lastNumericIndex + 1);
      candidate = candidateWords.join(' ');
    }
    while (candidateWords.length > 1 && /[^a-z'-]/i.test(candidateWords[0])) {
      candidateWords.shift();
      candidate = candidateWords.join(' ');
    }
    if (
      candidateWords.length >= 3 &&
      this.normalizeKey(candidateWords[0]) ===
        this.normalizeKey(candidateWords[1])
    ) {
      const repeatedKey = this.normalizeKey(candidateWords[0]);
      candidate = candidateWords
        .filter(
          (word, index) =>
            index >= 2 || this.normalizeKey(word) !== repeatedKey,
        )
        .join(' ');
    }

    const words = candidate.split(/\s+/).filter(Boolean);
    if (
      words.length > 4 ||
      candidate.replace(/[^a-z]/gi, '').length < 4 ||
      this.looksLikeCorporateText(candidate) ||
      this.looksLikeRegulatoryText(candidate) ||
      /\b(?:dosage|warning|storage|prescr[a-z]*|caut[a-z]*|colour|color|excipi[a-z]*|cardiolog[a-z]*|physic[a-z]*|neurolog[a-z]*|oncolog[a-z]*|pediatr[a-z]*|dermatolog[a-z]*|psychiatr[a-z]*|practit[a-z]*|retail|protect[a-z]*|light|moistur[a-z]*|swallow[a-z]*|chew[a-z]*|crush[a-z]*|childr[a-z]*|reach)\b/i.test(
        candidate,
      )
    ) {
      return undefined;
    }

    return words
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
      .join(' ');
  }

  private extractGenericIngredients(text: string) {
    const hasFormWord =
      /\b(?:tablets?|tablas?|capsules?|injection|syrup|suspension|cream|ointment|gel|solution|drops?)\b/i.test(
        text,
      );
    const hasJoiner = /[,+&]|(?<=[a-z])\s*\/\s*(?=[a-z])|\band\b/i.test(text);
    const hasCompositionCue =
      /\b(?:composition|contains|each|equivalent|eq\.?)\b/i.test(text);
    if (!hasFormWord || (!hasJoiner && !hasCompositionCue)) return [];

    const cleaned = text
      .replace(/^.*?\b(?:composition|contains)\b\s*[:.-]?/i, ' ')
      .replace(
        /\b(?:tablets?|tablas?|capsules?|injection|syrup|suspension|cream|ointment|gel|solution|drops?)\b.*$/i,
        ' ',
      )
      .replace(/\([^)]*\)/g, ' ')
      .replace(
        /\b\d+(?:\.\d+)?\s*(?:mg|mcg|ug|g|gm|ml|iu|units?|%)\s*\/\s*\d+(?:\.\d+)?\s*(?:mg|mcg|ug|g|gm|ml|iu|units?|%)\b/gi,
        ' ',
      )
      .replace(/\b\d+(?:\.\d+)?\s*(?:mg|mcg|ug|g|gm|ml|iu|units?|%)\b/gi, ' ')
      .replace(
        /\b(?:each|film[- ]?coated|tablet|tablets|tabla|tablas|capsule|capsules|injection|syrup|suspension|cream|ointment|gel|solution|drops?|contains|equivalent|eq|usp|ip|bp|ep|jp|nf|ih|as|to)\b/gi,
        ' ',
      )
      .replace(/\s+/g, ' ')
      .trim();

    const rejected = new Set([
      'composition',
      'excipients',
      'colour',
      'color',
      'dosage',
      'directed',
      'physician',
      'patient',
      'label',
      'pharmacist',
      'attention',
      'film',
      'coated',
      'uncoated',
    ]);

    return cleaned
      .split(/\s*(?:,|\+|&|(?<=[a-z])\/(?=[a-z])|\band\b)\s*/i)
      .map((part) =>
        part
          .replace(/[^a-z -]/gi, ' ')
          .replace(/\s+/g, ' ')
          .trim(),
      )
      .map((part) => this.removeShortOcrPrefix(part))
      .filter((part) => {
        const words = part.split(/\s+/).filter(Boolean);
        return (
          words.length >= 1 &&
          words.length <= 4 &&
          part.replace(/[^a-z]/gi, '').length >= 4 &&
          !this.looksLikeCorporateText(part) &&
          !this.looksLikeAddressText(part) &&
          !this.looksLikeRegulatoryText(part) &&
          !/\b(?:manufactured|mfg|marketed|mkt|pure|cure|healthcare|pvt|ltd|limited|subsidiary|pharmaceuticals|pharma|plot|sector|sidcul|ranipur|haridwar|uttarakhand|lic|licence|license)\b/i.test(
            part,
          ) &&
          words.every((word) => !rejected.has(word.toLowerCase()))
        );
      })
      .map((part) =>
        part
          .split(/\s+/)
          .map(
            (word) =>
              word.charAt(0).toUpperCase() + word.slice(1).toLowerCase(),
          )
          .join(' '),
      );
  }

  private removeShortOcrPrefix(value: string) {
    const words = value.split(/\s+/).filter(Boolean);
    while (
      words.length >= 2 &&
      /^[a-z]{1,2}$/i.test(words[0]) &&
      !/^(?:d3)$/i.test(words[0])
    ) {
      words.shift();
    }
    return words.join(' ');
  }

  private compositionEvidenceLines(
    sourceLines: string[],
    ingredients: string[],
  ) {
    const ingredientTokens = ingredients.flatMap((ingredient) =>
      ingredient
        .toLowerCase()
        .split(/\s+/)
        .map((token) => token.replace(/[^a-z]/g, ''))
        .filter((token) => token.length >= 4),
    );
    const evidence = sourceLines.filter((line) => {
      const normalized = this.normalizeIngredientText(line);
      return ingredientTokens.some((token) => normalized.includes(token));
    });

    return evidence.length ? evidence : sourceLines.slice(0, 1);
  }

  private compositionSearchTerms(ingredients: string[]) {
    return Array.from(
      new Set([ingredients.join(' + '), ingredients.join(' '), ...ingredients]),
    ).filter((term) => term.length >= 3);
  }

  private looksLikeCompositionVariant(
    line: string,
    composition?: PackageImageCompositionSignal,
  ) {
    if (!composition) return false;
    if (this.looksLikeCompositionLine(line)) return true;

    const lineClean = this.normalizeKey(line);
    const lineTokens = line.toLowerCase().match(/[a-z]{4,}/g) ?? [];
    const ingredientTokens = composition.ingredients
      .flatMap(
        (ingredient) => ingredient.toLowerCase().match(/[a-z]{4,}/g) ?? [],
      )
      .filter(Boolean);

    return ingredientTokens.some((ingredient) => {
      const ingClean = this.normalizeKey(ingredient);
      if (
        lineClean.includes(ingClean) &&
        /\b(?:tablets?|capsules?|ip|usp|bp)\b/i.test(line)
      ) {
        return true;
      }
      return lineTokens.some(
        (token) =>
          token === ingredient &&
          !/\b\d+\b/.test(line) &&
          !this.isBrandCandidateLine(line),
      );
    });
  }

  private brandShapeBonus(name: string) {
    const compact = name.replace(/[^a-z0-9]/gi, '');
    if (compact.length < 5 || compact.length > 24) return 0;

    let bonus = 0.08;
    if (/[a-z][A-Z]/.test(name) || /[A-Z]{2,}$/.test(compact)) bonus += 0.08;
    if (/^[A-Z]{3,}\s*\d+$/i.test(name)) bonus += 0.18;
    if (
      /\b(?:xt|sr|cr|xr|cv|lb|ds|plus|forte)\b/i.test(name) ||
      /(XT|SR|CR|XR|CV|LB|DS)$/i.test(compact)
    ) {
      bonus += 0.08;
    }
    if (/\d/.test(compact)) bonus += 0.04;
    return bonus;
  }

  private looksLikeCompositionLine(line: string) {
    const hasFormWord =
      /\b(?:tablets?|tabs?|capsules?|caps?|injection|syrup|suspension|cream|ointment|gel|solution|drops?)\b/i.test(
        line,
      );
    const hasPharmacopoeia =
      /\b(?:ip|i\.?p\.?|usp|bp|ep|jp|j\.?p\.?|nf|ih)\b/i.test(line);
    const hasStrength =
      /\b\d+(?:\.\d+)?\s*(?:mg|mcg|g|gm|ml|iu|units?|%)\b/i.test(line);
    const hasIngredientJoiner =
      /\b[a-z][a-z '-]{2,}\s*(?:,|\+|&)\s*[a-z]/i.test(line);

    return (
      /\b(?:composition|contains|each|equivalent|eq\.?)\b/i.test(line) ||
      hasPharmacopoeia ||
      (hasFormWord && hasIngredientJoiner)
    );
  }

  private isBrandCandidateLine(line: string) {
    if (
      this.looksLikeCompositionLine(line) ||
      this.looksLikeCorporateText(line) ||
      this.looksLikeAddressText(line) ||
      this.looksLikeRegulatoryText(line) ||
      /[,+&]/.test(line) ||
      /\b(?:tablets?|capsules?|syrup|suspension|drops?|cream|gel|injection)\b/i.test(
        line,
      ) ||
      /\b(?:hydrochloride|dihydrochloride|mononitrate|dinitrate|besylate|maleate|succinate|tartrate|fumarate|citrate|phosphate|sulfate|sulphate|bisulfate|mesylate|valerate|propionate|dipropionate|acetate|gluconate|ascorbate|monohydrate|dihydrate|trihydrate|hydrate)\b/i.test(
        line,
      )
    ) {
      return false;
    }
    const base = normalizeBaseIngredient(line);
    if (
      base &&
      base.length >= 4 &&
      this.normalizeKey(base) !== this.normalizeKey(line)
    ) {
      return false;
    }
    const clean = line.replace(/[^a-z0-9]/gi, '');
    return clean.length >= 3 && clean.length <= 30;
  }

  private looksLikeBrokenOcrLine(line: string) {
    const tokens = this.normalizeLine(line).split(/\s+/).filter(Boolean);
    if (tokens.length < 4) return false;

    const shortTokens = tokens.filter((token) =>
      /^[a-z]{1,2}$/i.test(token),
    ).length;
    const repeatedTokens = tokens.filter((token) => {
      const letters = token.replace(/[^a-z]/gi, '').toLowerCase();
      return letters.length >= 2 && new Set(letters).size === 1;
    }).length;
    const hasStrength =
      /\b\d+(?:\.\d+)?\s*(?:mg|mcg|g|gm|ml|iu|units?|%)\b/i.test(line);
    const hasPharmacopoeia = /\b(?:ip|usp|bp)\b/i.test(line);
    const startsWithTinyToken = /^[a-z]{1,2}\b/i.test(line);

    return (
      (tokens.length >= 5 &&
        (shortTokens + repeatedTokens) / tokens.length >= 0.5) ||
      (shortTokens >= 3 && hasStrength) ||
      (startsWithTinyToken && hasPharmacopoeia && hasStrength)
    );
  }

  private looksLikeTextNoiseLine(line: string) {
    const cleaned = this.normalizeLine(line);
    const tokens = cleaned.split(/\s+/).filter(Boolean);
    const alphaNumeric = cleaned.replace(/[^a-z0-9]/gi, '');
    const separatorCount = (cleaned.match(/[.:;,_\\/]/g) ?? []).length;
    if (
      alphaNumeric.length >= 5 &&
      separatorCount >= 3 &&
      separatorCount / Math.max(alphaNumeric.length, 1) >= 0.25
    ) {
      return true;
    }
    if (tokens.length < 5) return false;

    const symbolCount = (cleaned.match(/[^a-z0-9\s.+/-]/gi) ?? []).length;
    const shortOrNoisy = tokens.filter(
      (token) =>
        /^[a-z]{1,2}$/i.test(token) ||
        /^[A-Z]{2,}$/.test(token) ||
        (/\d/.test(token) && /[a-z]/i.test(token) && token.length <= 4),
    ).length;
    const hasBrandToken = tokens.some((token) => this.isBrandLikeToken(token));

    return !hasBrandToken && (symbolCount >= 3 || shortOrNoisy >= 3);
  }

  private isPotentialBrandLine(line: string) {
    if (line.length < 3 || !/[a-z]/i.test(line)) {
      return false;
    }

    if (
      /^\s*\d+(?:\s*[xX]\s*\d+)?\s+(?:(?:film|sugar|enteric)[- ]?coated\s+)?(?:tablets?|tabs?|capsules?|caps?|strips?|blisters?)\s*$/i.test(
        line,
      )
    ) {
      return false;
    }

    if (
      /\b(batch|b\.?no|mfd|mfr|mfg|manufactured|manufacturer|marketed|mktd|expiry|exp\.?|mrp|price|rs\.?|inclusive|tax|license|lic\.?|schedule|storage|store|warning|keep|children|composition|contains|each|tablet contains|capsule contains|for external use|not for|customer|care|phone|email|www|http|cardiologist|neurologist|physician|oncologist|pediatrician|dermatologist|psychiatrist|practitioner|practitione|specialist|chemist|pharmacist|retail|registered|swallowed|chewed|crushed|ferric|titanium|oxide|dioxide|excipients?|q\.?s\.?|call|toll\s*free|tollfree|helpline|visit|website|customer\s*care|consumer\s*care|for\s*more\s*information|feedback|queries|complaints|leaflet|for\s*oral\s*use|for\s*sale\s*in|for\s*export|sample\s*pack|physician\s*sample|import\s*lic|mon\s*to\s*sat|10am\s*to|keepitpumping)\b/i.test(
        line,
      )
    ) {
      return false;
    }

    if (
      /^\W*(?:rx|ip|usp|bp|i\.?p\.?|u\.?s\.?p\.?|b\.?p\.?|qs|q\.?s\.?|excipients?)\W*$/i.test(
        line,
      ) ||
      /^(?:(?:film|sugar|enteric)[- ]?coated\s+)?(?:tablets?|tabs?|capsules?|caps?|injection|syrup|suspension|drops?|cream|ointment|gel|solution)?\s*(?:i\.?p\.?|u\.?s\.?p\.?|b\.?p\.?|e\.?p\.?|qs|q\.?s\.?)$/i.test(
        line,
      )
    ) {
      return false;
    }

    if (/^[\d\s.,:/%+-]+$/.test(line) || /^\s*\d{3,}/.test(line)) {
      return false;
    }

    if (/\b(?:1800\d{3,}|\d{7,})\b/.test(line.replace(/[\s-]/g, ''))) {
      return false;
    }

    if (
      /^[-–—]?\s*(?:rc\/ff|ff-\d+|imp\/|mfg\.?\s*lic|m\.?l\.?:)/i.test(line)
    ) {
      return false;
    }

    if (
      this.looksLikeCorporateText(line) ||
      this.looksLikeRegulatoryText(line) ||
      this.looksLikeAddressText(line) ||
      /\b(?:prescription|prescriphion|caution|dosage|physician|neurologist|cardiologist|oncologist|pediatrician|dermatologist|psychiatrist|practitioner|practitione|registered|swallowed|chewed|crushed|excipients?|colour|color|titanium|oxide|ferric|q\.?s\.?)\b/i.test(
        line,
      )
    ) {
      return false;
    }

    return true;
  }

  private extractName(line: string, strength?: string, lineStrength?: string) {
    if (
      this.looksLikeCorporateText(line) ||
      this.looksLikeRegulatoryText(line) ||
      this.looksLikeAddressText(line)
    ) {
      return '';
    }

    let text = line
      .replace(
        /^.*?\b(?:mkt\.?\s*by|mfg\.?\s*by|marketed\s*by|manufactured\s*by|a\s+div\.?\s*of|tm-trademark\s*applied\s*for|trademark\s*applied\s*for|trademark|applied\s*for)\b\s*[:.-]?/gi,
        ' ',
      )
      .replace(
        /\b(?:tab|tabs|tablet|tablets|cap|caps|capsule|capsules|syrup|syp|inj|injection|cream|ointment|gel|drops?|strip|blister|oral|solution|suspension|i\.?p\.?|u\.?s\.?p\.?|b\.?p\.?)\b/gi,
        ' ',
      )
      .replace(/\b(?:net|qty|quantity)\s*[:.-]?\s*\d+\b/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    if (
      !text ||
      this.looksLikeCorporateText(text) ||
      this.looksLikeRegulatoryText(text) ||
      this.looksLikeAddressText(text)
    ) {
      return '';
    }

    if (strength) {
      const escaped = strength.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      text = text.replace(new RegExp(`\\b${escaped}\\b`, 'i'), ` ${strength} `);
    }

    const cutAt = [
      /\b\d+(?:\.\d+)?\s*(?:mg|mcg|g|gm|ml|iu|units?|%)\b/i.exec(text)?.index,
      /\b\d+\s*(?:tablets?|capsules?|tabs?|caps?)\b/i.exec(text)?.index,
    ]
      .filter((value): value is number => value !== undefined)
      .sort((left, right) => left - right)[0];

    const base = (cutAt !== undefined ? text.slice(0, cutAt) : text)
      .replace(/^[^a-z0-9]+/i, '')
      .replace(/[^a-z0-9+./ -]/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    if (
      !base ||
      this.looksLikeCorporateText(base) ||
      this.looksLikeRegulatoryText(base) ||
      this.looksLikeAddressText(base)
    ) {
      return '';
    }

    const brandSegment = this.extractBrandSegment(base);
    if (brandSegment) {
      if (
        lineStrength &&
        !this.baseContainsStrength(brandSegment, lineStrength)
      ) {
        return `${brandSegment} ${lineStrength}`.trim();
      }
      return brandSegment;
    }

    if (lineStrength && !this.baseContainsStrength(base, lineStrength)) {
      return `${base} ${lineStrength}`.trim();
    }

    if (strength && this.baseContainsStrength(base, strength)) {
      return base;
    }

    return base;
  }

  private extractBrandSegment(base: string) {
    const tokens = base
      .split(/\s+/)
      .map((token) => token.replace(/^[^a-z0-9]+|[^a-z0-9]+$/gi, ''))
      .filter(Boolean);

    if (!tokens.length) return '';

    const uniqueKeys = new Set(tokens.map((token) => this.normalizeKey(token)));
    if (uniqueKeys.size === 1) {
      return this.isBrandLikeToken(tokens[0])
        ? this.normalizeBrandToken(tokens[0])
        : '';
    }

    const tokenCandidates = tokens
      .map((token, index) => ({
        value: token,
        score: this.brandTokenScore(token) + (index === 0 ? 0.04 : 0),
      }))
      .filter((candidate) => candidate.score > 0);

    const pairCandidates = tokens
      .slice(0, -1)
      .map((token, index) => {
        const next = tokens[index + 1];
        const isDosageNumber = /^(?:[5-9]|\d{2,})$/.test(next);
        const joined =
          isDosageNumber || /^(?:xt|sr|cr|xr|cv|lb|ds)$/i.test(next)
            ? `${token} ${next}`
            : `${token}${next}`;
        return {
          value: joined,
          score:
            this.brandTokenScore(joined) -
            (token.length <= 2 ? 0.04 : 0.12) +
            (/(?:xt|sr|cr|xr|cv|lb|ds)$/i.test(next) ? 0.08 : 0) +
            (isDosageNumber ? 0.28 : 0),
        };
      })
      .filter((candidate) => candidate.score > 0);

    const best = [...tokenCandidates, ...pairCandidates].sort(
      (left, right) => right.score - left.score,
    )[0];

    if (!best || best.score < 0.55) {
      return '';
    }

    return this.normalizeBrandToken(best.value);
  }

  private brandTokenScore(token: string) {
    const compact = token.replace(/[^a-z0-9+-]/gi, '');
    const normalized = this.normalizeKey(compact);
    if (!this.isBrandLikeToken(compact)) return 0;

    let score = 0.45;
    if (compact.length >= 6 && compact.length <= 16) score += 0.16;
    if (/[a-z][A-Z]/.test(compact) || /[A-Z][a-z]/.test(compact)) score += 0.14;
    if (/\d/.test(compact)) score += 0.08;
    if (/(?:xt|sr|cr|xr|cv|lb|ds|plus|forte)$/i.test(compact)) score += 0.2;
    if (this.isCompositionToken(normalized)) score -= 0.7;
    if (/^[A-Z]{3,}$/.test(compact) && compact.length <= 16) score += 0.12;

    return score;
  }

  private isBrandLikeToken(token: string) {
    const compact = token.replace(/[^a-z0-9+-]/gi, '');
    const normalized = this.normalizeKey(compact);

    return (
      compact.length >= 4 &&
      compact.length <= 24 &&
      /[a-z]/i.test(compact) &&
      !this.isCompositionToken(normalized) &&
      !/^\d/.test(compact) &&
      !/^(?:ip|usp|bp|mrp|mfg|exp|bno|eq|qs|no|to|of|for|by)$/i.test(compact)
    );
  }

  private isCompositionToken(normalized: string) {
    return new Set([
      'acid',
      'film',
      'coated',
      'uncoated',
      'extended',
      'sustained',
      'controlled',
      'modified',
      'delayed',
      'prolonged',
      'release',
      'tablets',
      'tablet',
      'capsules',
      'capsule',
      'elemental',
      'iron',
      'excipients',
      'colour',
      'color',
      'oxide',
      'storage',
      'store',
      'cool',
      'dry',
      'dark',
      'place',
      'dosage',
      'directed',
      'physician',
      'therapeutic',
      'composition',
      'contains',
      'equivalent',
      'manufacturer',
      'manufactured',
      'marketed',
      'batch',
      'expiry',
      'pharmaceuticals',
      'pharmaceutical',
      'laboratories',
      'laboratory',
      'healthcare',
      'limited',
      'ltd',
      'pvt',
      'india',
      'prescription',
      'registered',
      'medical',
      'practitioner',
      'trademark',
      'applied',
      'drug',
      'caution',
    ]).has(normalized);
  }

  private looksLikeAddressText(line: string) {
    const compact = this.normalizeKey(line);
    return (
      /\b(?:circle|kamarey|bhasmay|kumrek|sikkim|industrial|area|indl|plot|block|khasra|nagar|road|street|lane|marg|sector|dist|district|village|pincode|pin\s*code|duga|via|provinciale|schito|torre|annunziata|italy|italia|switzerland|swiss|basel|germany|france|gala|complex|kopar|purna|tal|taluka|bhiwandi|zone|building|bus\s*stop|plant[- ]?\d+|dehradun|uttarakhand|himachal|baddi|solan|gujarat|ahmedabad|mumbai|maharashtra|hyderabad|telangana|bangalore|karnataka|chennai|tamil\s*nadu|haryana|delhi|goa|daman)\b/i.test(
        line,
      ) ||
      /\b[1-9]\d{2}\s*\d{3}\b/.test(line) ||
      /(?:circle|kamarey|bhasmay|kumrek|sikkim|industri|khasra|distr|nagar|road|dugacircle|annunziata|provinciale|schito|arihantcomplex|bhiwandi)/.test(
        compact,
      )
    );
  }

  private looksLikeCorporateText(line: string) {
    const compact = this.normalizeKey(line);
    return (
      /\b(?:pharmaceuticals?|laborator(?:y|ies)|healthcare|therapeutics?|biotech|private|pvt\.?|limited|ltd\.?|inc\.?|llp|company|manufacturing|remedies|remedy|cadila|zydus|cipla|intas|windlas|systopic|alembic|lupin|torrent|mankind|aristo|alkem|glenmark|ipca|abbott|pfizer|novartis|sanofi|glaxo|gsk|sandoz|farma|spa|ag|fourrts|skystar|hesling|skystarmel|mkt\.?\s*by|marketed\s*by|mfg\.?\s*by|manufactured\s*by|imported\s*by|a\s+div\.?\s+of|unit[- ]?(?:i|ii|iii|iv|v|ll|\d+))\b/i.test(
        line,
      ) ||
      /(?:pharmaceuticals?|laboratories|healthcare|therapeutics|pvtltd|privatelimited|germanremedies|zydushealthcare|zyduscadila|unitii|unitll|unit1|unit2|sandozprivatelimited|novartisfarmaspa|novartisag|skystarmel)$/.test(
        compact,
      ) ||
      /(?:pharmaceuticals?|laborator(?:y|ies)|healthcare|therapeutics?|biotech|remedies)(?:pvt|private)?(?:ltd|limited)?$/.test(
        compact,
      )
    );
  }

  private looksLikeRegulatoryText(line: string) {
    const compact = this.normalizeKey(line);
    return (
      /(?:prescr.{0,3}tion|prescrption|prescriphion|schedu|cauti|physici|cardiolog|neurolog|oncolog|pediatr|dermatolog|psychiatr|practit|specialist|doctor|chemist|pharmacist|retail|dispens|manufac|excipi|directedby|trademark|appliedfor|registeredmedical|medicalpractitioner|swallowedas|notchewed|notcrushed|keepout|reachof|reachofchildren|storebelow|starebelow|darkplace|protectfrom|dryplace|tollfree|keepitpumping|customercare|consumercare|formoreinformation|helpline|forsaleinindiaonly|notforsale|physiciansample|importlicenseno|readthepackageleaflet|fororaluse|importlic|registeredtrademarkof|trademarkof|baselswitzerland)/.test(
        compact,
      ) ||
      /\b(?:for\s+sale\s+in\s+india\s+only|for\s+export\s+only|not\s+for\s+sale|read\s+the\s+package\s+leaflet|for\s+oral\s+use|import\s+lic(?:ense)?\s*no|call\s*:\s*\d+|toll\s*free)\b/i.test(
        line,
      )
    );
  }

  private extractManufacturerKeys(lines: OcrLine[]) {
    const keys = new Set<string>();
    const ignored = new Set([
      'manufactured',
      'manufacturer',
      'marketed',
      'private',
      'limited',
      'pharmaceutical',
      'pharmaceuticals',
      'laboratory',
      'laboratories',
      'healthcare',
      'india',
      'pvt',
      'ltd',
    ]);

    for (let index = 0; index < lines.length; index += 1) {
      const lineText = lines[index]?.text ?? '';
      if (
        !/\b(?:manufactured|manufacturer|marketed|mktd|mfg|mkt)\b/i.test(lineText) &&
        !this.looksLikeCorporateText(lineText)
      ) {
        continue;
      }
      for (const token of lineText.match(/[a-z][a-z0-9.-]{3,}/gi) ?? []) {
        const key = this.normalizeKey(token);
        if (key.length >= 4 && !ignored.has(key)) keys.add(key);
      }
    }

    return keys;
  }

  private extractStandaloneCompositionCandidates(lines: OcrLine[]) {
    const results: PackageImageCompositionSignal[] = [];
    for (let index = 0; index < lines.length; index += 1) {
      const line = this.normalizeLine(lines[index].text);
      const ingredient = this.extractStandaloneGenericIngredient(line);
      if (!ingredient) continue;

      const nearby = lines
        .slice(Math.max(0, index - 3), index + 4)
        .map((item) => this.normalizeLine(item.text));
      const hasForm = nearby.some((item) =>
        item.split(/\s+/).some((token) => this.looksLikeDosageFormToken(token)),
      );
      const hasStrength = nearby.some((item) =>
        Boolean(this.extractStrength(item)),
      );
      if (!hasForm && !hasStrength) continue;

      results.push({
        displayName: ingredient,
        ingredients: [ingredient],
        rawLine: line,
        sourceLines: [line],
        confidence: Math.min(
          0.88,
          this.normalizeConfidence(lines[index].confidence) + 0.12,
        ),
        searchTerms: [ingredient],
      });
    }
    return results;
  }

  private extractStandaloneGenericIngredient(line: string) {
    if (
      !line ||
      /\d/.test(line) ||
      /^[A-Z0-9 ._-]+$/.test(line) ||
      this.looksLikeCorporateText(line) ||
      this.looksLikeRegulatoryText(line) ||
      /\b(?:store|dosage|warning|caution|colour|color|excipients?|prescription|prescriphion|cardiologist|neurologist|physician|oncologist|pediatrician|dermatologist|psychiatrist|practitioner|specialist|chemist|pharmacist|retail|swallowed?|chewed?|crushed?|ground|floor|road|block|plot|batch|expiry|tablet|capsule)\b/i.test(
        line,
      )
    ) {
      return undefined;
    }
    const words = line
      .replace(/[^a-z '-]/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .split(/\s+/)
      .filter(Boolean);
    if (
      words.length < 1 ||
      words.length > 3 ||
      words.join('').replace(/[^a-z]/gi, '').length < 7
    ) {
      return undefined;
    }
    return words
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
      .join(' ');
  }

  private looksLikeDosageFormToken(token: string) {
    const normalized = token.toLowerCase().replace(/[^a-z]/g, '');
    if (!normalized) return false;
    const forms = [
      'tablet',
      'tablets',
      'capsule',
      'capsules',
      'injection',
      'syrup',
      'suspension',
      'cream',
      'ointment',
      'solution',
      'drops',
    ];
    return forms.some((form) => {
      if (normalized === form) return true;
      if (normalized.length < 6 || form.length < 6) return false;
      return this.editDistance(normalized, form) <= 3;
    });
  }

  private looksLikeStrengthFragment(value: string) {
    const compact = value.replace(/[\s._-]+/g, '');
    return /^[a-z]{0,2}\d+(?:\.\d+)?(?:mg|mcg|ug|g|gm|ml|iu|units?|%)$/i.test(
      compact,
    );
  }

  private looksLikeRepeatedVariantLine(line: string) {
    const tokens = line
      .split(/\s+/)
      .map((token) => token.replace(/[^a-z0-9]/gi, '').toLowerCase())
      .filter((token) => token.length >= 4);
    if (tokens.length < 3) return false;

    const similarityKeys = tokens.map((token) =>
      token
        .replace(/[01]/g, '')
        .replace(/[mw]/g, '')
        .replace(/(.)\1+/g, '$1'),
    );
    const dominant = similarityKeys.filter(
      (key) =>
        similarityKeys.filter(
          (other) =>
            key && other && (other.includes(key) || key.includes(other)),
        ).length >= 3,
    );
    return dominant.length >= 3;
  }

  private normalizeBrandToken(token: string) {
    return token
      .replace(/^[A-Z]{1,2}(?=[A-Z][a-z])/g, '')
      .replace(/^[a-z]{1,2}(?=[A-Z][a-z])/g, '')
      .trim();
  }

  private extractStrength(text: string) {
    const match =
      /\b\d+(?:\.\d+)?\s*(?:mg|mcg|ug|g|gm|ml|iu|units?|%)(?:\s*\/\s*\d+(?:\.\d+)?\s*(?:mg|mcg|ug|g|gm|ml|iu|units?|%))*/i.exec(
        text,
      );
    return match?.[0]?.replace(/\s+/g, '') ?? undefined;
  }

  private extractAdjacentStrength(lines: OcrLine[], originalLine: string) {
    const index = lines.findIndex(
      (line) =>
        this.normalizeLine(line.text) === this.normalizeLine(originalLine),
    );
    if (index < 0) return undefined;

    for (const offset of [1, -1, 2, -2]) {
      const adjacent = lines[index + offset];
      if (!adjacent) continue;
      const normalized = this.normalizeLine(adjacent.text);
      if (
        /^\d+(?:\.\d+)?\s*(?:mg|mcg|ug|g|gm|ml|iu|units?|%)(?:\s*\/\s*\d+(?:\.\d+)?\s*(?:mg|mcg|ug|g|gm|ml|iu|units?|%))*$/i.test(
          normalized,
        )
      ) {
        return this.extractStrength(normalized);
      }
    }

    return undefined;
  }

  private extractStrengthMatchingBrand(lines: OcrLine[], brandName: string) {
    const brandNumbers = new Set(brandName.match(/\d+(?:\.\d+)?/g) ?? []);
    if (!brandNumbers.size) return undefined;

    for (const line of lines) {
      const strength =
        this.extractStrength(line.text) ??
        this.extractStrengthFragment(line.text);
      if (!strength) continue;
      const strengthNumbers = strength.match(/\d+(?:\.\d+)?/g) ?? [];
      if (
        strengthNumbers.length === 1 &&
        brandNumbers.has(strengthNumbers[0])
      ) {
        return strength;
      }
    }

    return undefined;
  }

  private extractStrengthFragment(text: string) {
    const compact = text.replace(/[\s._-]+/g, '');
    const match =
      /^[a-z]{1,2}(\d+(?:\.\d+)?(?:mg|mcg|ug|g|gm|ml|iu|units?|%))$/i.exec(
        compact,
      );
    return match?.[1];
  }

  private extractCompositionStrength(
    composition?: PackageImageCompositionSignal,
    lines: OcrLine[] = [],
  ) {
    if (!composition) return undefined;
    for (const line of composition.sourceLines) {
      const strength = this.extractStrength(line);
      if (strength) return strength;
    }
    const ingredientKeys = composition.ingredients
      .flatMap((ingredient) => ingredient.split(/\s+/))
      .map((token) => this.normalizeKey(token))
      .filter((token) => token.length >= 5);
    for (const line of lines) {
      const normalized = this.normalizeIngredientText(line.text);
      const lineTokens = line.text.toLowerCase().match(/[a-z]{5,}/g) ?? [];
      const ingredientMatches = ingredientKeys.some(
        (key) =>
          normalized.includes(key) ||
          lineTokens.some(
            (token) =>
              this.editDistance(token, key) <=
              Math.max(1, Math.ceil(Math.max(token.length, key.length) * 0.25)),
          ),
      );
      if (!ingredientMatches) continue;
      const strength = this.extractStrength(line.text);
      if (strength) return strength;
    }
    return this.extractStrength(composition.rawLine);
  }

  private editDistance(left: string, right: string) {
    const previous = Array.from(
      { length: right.length + 1 },
      (_, index) => index,
    );
    for (let row = 1; row <= left.length; row += 1) {
      let diagonal = previous[0];
      previous[0] = row;
      for (let column = 1; column <= right.length; column += 1) {
        const above = previous[column];
        previous[column] = Math.min(
          previous[column] + 1,
          previous[column - 1] + 1,
          diagonal + (left[row - 1] === right[column - 1] ? 0 : 1),
        );
        diagonal = above;
      }
    }
    return previous[right.length];
  }

  private extractPack(text: string) {
    const match =
      /\b(?:(?:strip\s+of\s+)?(?:\d+\s*[xX]\s*)?\d+\s*(?:(?:film|enteric)[- ]coated\s+)?(?:tabs?|tablets?|caps?|capsules?|sachets?|strips?|vials?|ampoules?|ml)|\d{2,}\s*(?:s|'s))\b/i.exec(
        text,
      );
    return match?.[0]?.replace(/\s+/g, ' ').trim() ?? undefined;
  }

  private computeGeometryStats(lines: OcrLine[]) {
    const heights = lines
      .map((line) => this.lineHeight(line.bbox))
      .filter((h): h is number => h > 0)
      .sort((a, b) => a - b);

    if (!heights.length) {
      return { medianHeight: 0, maxHeight: 0, hasGeometry: false };
    }

    const mid = Math.floor(heights.length / 2);
    const medianHeight =
      heights.length % 2 === 0
        ? (heights[mid - 1] + heights[mid]) / 2
        : heights[mid];
    const maxHeight = heights[heights.length - 1];

    return { medianHeight, maxHeight, hasGeometry: true };
  }

  private lineHeight(bbox?: number[][]): number {
    if (!bbox || bbox.length < 4) return 0;
    const ys = bbox.map((point) => point[1]);
    return Math.max(0, Math.max(...ys) - Math.min(...ys));
  }

  private fontProminenceScore(
    bbox: number[][] | undefined,
    stats: { medianHeight: number; maxHeight: number; hasGeometry: boolean },
  ): number {
    if (!stats.hasGeometry || !bbox) return this.bboxArea(bbox);
    const height = this.lineHeight(bbox);
    if (height <= 0 || stats.medianHeight <= 0) return 0.4;

    const ratio = height / stats.medianHeight;
    if (ratio >= 1.5) return Math.min(1.0, 0.85 + (ratio - 1.5) * 0.15);
    if (ratio >= 1.0) return 0.65 + (ratio - 1.0) * 0.4;
    return Math.max(0.05, ratio * 0.65);
  }

  private bboxArea(bbox?: number[][]) {
    if (!bbox || bbox.length < 4) return 0.4;
    const xs = bbox.map((point) => point[0]);
    const ys = bbox.map((point) => point[1]);
    const width = Math.max(...xs) - Math.min(...xs);
    const height = Math.max(...ys) - Math.min(...ys);
    const area = Math.max(0, width * height);
    return Math.min(area / 50000, 1);
  }

  private normalizeLine(line: string) {
    return line.replace(/[|_®™©]/g, ' ').replace(/\s+/g, ' ').trim();
  }

  private normalizeConfidence(value?: number) {
    if (!Number.isFinite(value)) return 0;
    const safe = Number(value);
    return safe > 1
      ? Math.max(0, Math.min(safe / 100, 1))
      : Math.max(0, Math.min(safe, 1));
  }

  private normalizeKey(value: string) {
    return value.toLowerCase().replace(/[^a-z0-9]+/g, '');
  }

  private normalizeIngredientText(value: string) {
    return value
      .toLowerCase()
      .replace(/0/g, 'o')
      .replace(/1/g, 'i')
      .replace(/[^a-z]+/g, '');
  }

  private baseContainsStrength(base: string, strength: string) {
    const normalizedBase = this.normalizeKey(base);
    const normalizedStrength = this.normalizeKey(strength);
    const numericStrength = normalizedStrength.replace(/[a-z]+$/i, '');
    return (
      normalizedBase.includes(normalizedStrength) ||
      Boolean(numericStrength && normalizedBase.includes(numericStrength))
    );
  }
}
