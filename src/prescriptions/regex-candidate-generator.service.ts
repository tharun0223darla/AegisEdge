import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'crypto';
import { OcrEvidence } from './interfaces/ocr-evidence.interface';
import { CandidateMention } from './interfaces/candidate-generation.interface';
import { ensureOcrEvidenceId, normalizeOcrText } from './ocr-evidence.util';

@Injectable()
export class RegexCandidateGenerator {
  private readonly logger = new Logger(RegexCandidateGenerator.name);

  private readonly dosageFormPattern =
    /\b(?:tab(?:let)?s?|tob|tb|cap(?:sule)?s?|syp|syrup|inj(?:ection)?s?|cream|ointment|gel|drops?|susp(?:ension)?|rotacap|inhaler|powder|solution|spray)\b\.?/i;
  private readonly strengthPattern =
    /\b(\d+(?:\.\d+)?(?:\s*[/+-]\s*\d+(?:\.\d+)?)?)\s*(mcg|\u00b5g|ug|mg|g|ml|iu|units?)\b/i;
  private readonly durationPattern =
    /\b(?:for\s+|x\s*)?(\d+)\s*(day|days|week|weeks|month|months)\b/i;
  private readonly quantityPattern =
    /(?:#|qty\s*[:-]?\s*)(\d+)|\b(\d+)\s*(?:tablets?|tabs?|capsules?|caps?|pills?)\b/i;

  private readonly frequencyPatterns: Array<{
    pattern: RegExp;
    value: string;
  }> = [
    {
      pattern: /(?:^|\s)\d+\s*[-+]\s*\d+\s*[-+]\s*\d+(?:\s|$)/,
      value: 'CUSTOM',
    },
    {
      pattern: /\b(?:as\s+needed|sos|prn)\b/i,
      value: 'AS_NEEDED',
    },
    {
      pattern: /\b(?:four\s+times\s+(?:a\s+)?day|qid)\b/i,
      value: 'FOUR_TIMES_DAILY',
    },
    {
      pattern: /\b(?:three\s+times\s+(?:(?:a\s+)?day|daily)|tds|tid)\b/i,
      value: 'THREE_TIMES_DAILY',
    },
    {
      pattern: /\b(?:twice\s+daily|twice\s+(?:a\s+)?day|bd|bid)\b/i,
      value: 'TWICE_DAILY',
    },
    {
      pattern: /\b(?:once\s+daily|once\s+(?:a\s+)?day|daily|od)\b/i,
      value: 'DAILY',
    },
    {
      pattern: /\b(?:once\s+weekly|weekly)\b/i,
      value: 'WEEKLY',
    },
  ];

  private readonly sentinelPattern =
    /^(?:empty|empty\s+crop|crop(?:\s+failed)?|no\s+text|no\s+text\s+detected|ocr\s+failed)$/i;
  private readonly headerPattern =
    /^(?:patient|patient\s+name|name|date|doctor|prescriber|rx|prescription|address|hospital|phone|age|sex|gender)\s*[:-]?\s*$/i;

  generateCandidates(evidenceList: OcrEvidence[]): CandidateMention[] {
    const mentions: CandidateMention[] = [];

    for (const rawEvidence of evidenceList) {
      const ev = ensureOcrEvidenceId(rawEvidence);
      const rawLine = ev.text || '';
      const cleanLine = normalizeOcrText(rawLine);
      if (
        cleanLine.length < 3 ||
        this.sentinelPattern.test(cleanLine) ||
        this.headerPattern.test(cleanLine)
      ) {
        continue;
      }

      const formMatch = this.dosageFormPattern.exec(cleanLine);
      const strengthMatch = this.strengthPattern.exec(cleanLine);
      const frequency = this.extractFrequency(cleanLine);
      const frequencyStart = this.findFrequencyStart(cleanLine);
      const durationMatch = this.durationPattern.exec(cleanLine);
      const quantityMatch = this.quantityPattern.exec(cleanLine);

      const hasPharmaceuticalContext =
        !!formMatch || !!strengthMatch || frequencyStart !== undefined;

      const standaloneToken = cleanLine
        .replace(/^[\s\d.)(_-]+/, '')
        .replace(/[\s\d.)(_-]+$/, '')
        .trim();

      const standaloneMedicineLike =
        cleanLine.length <= 35 &&
        /^[\p{L}][\p{L}\p{N}+/]{3,}(?:-[\p{L}\p{N}+/]{1,10})+$/u.test(
          standaloneToken,
        );

      if (!hasPharmaceuticalContext && !standaloneMedicineLike) {
        continue;
      }

      const nameStart =
        formMatch && formMatch.index <= 4
          ? formMatch.index + formMatch[0].length
          : 0;

      const stopCandidates = [
        strengthMatch?.index,
        frequencyStart,
        durationMatch?.index,
        quantityMatch?.index,
      ].filter(
        (value): value is number =>
          typeof value === 'number' && value > nameStart,
      );

      const nameEnd =
        stopCandidates.length > 0
          ? Math.min(...stopCandidates)
          : cleanLine.length;
      let medicineName = cleanLine
        .slice(nameStart, nameEnd)
        .replace(/^[\s:;,._/-]+|[\s:;,._/-]+$/g, '')
        .replace(
          /^(?:raw\s+text\s+recovered|raw\s+text|recovered|medicine|med|drug)\s*[:-]?\s*/i,
          '',
        )
        .trim();

      // With no pharmaceutical context, keep only a conservative leading phrase.
      if (!formMatch && !strengthMatch && frequencyStart === undefined) {
        medicineName = medicineName.split(/\s+/).slice(0, 4).join(' ');
      }

      medicineName = medicineName
        .replace(/[^\p{L}\p{N}\s+/-]/gu, '')
        .replace(/\s+/g, ' ')
        .trim();
      if (!this.isPlausibleName(medicineName)) continue;

      const rawLower = rawLine.toLocaleLowerCase();
      const nameLower = medicineName.toLocaleLowerCase();
      let charStart = rawLower.indexOf(nameLower);
      if (charStart < 0) {
        charStart = Math.max(0, nameStart);
      }
      const charEnd = Math.min(rawLine.length, charStart + medicineName.length);

      const dosage = strengthMatch
        ? `${strengthMatch[1].replace(/\s+/g, '')}${strengthMatch[2].toLowerCase()}`
        : null;
      const durationDays = this.durationToDays(durationMatch);
      const quantity = quantityMatch
        ? Number(quantityMatch[1] ?? quantityMatch[2])
        : null;
      const instructions = this.extractInstructions(cleanLine);
      const confidence = this.normalizeConfidence(ev.confidence);

      const mentionId = createHash('sha256')
        .update(
          [
            'regex',
            ev.id,
            this.normalizeMedicineName(medicineName),
            dosage || '',
            frequency || '',
            durationDays ?? '',
            quantity ?? '',
          ].join('|'),
        )
        .digest('hex');

      mentions.push({
        id: mentionId,
        rawText: medicineName,
        canonicalName: medicineName,
        normalized: this.normalizeMedicineName(medicineName),
        sourceGenerator: 'regex',
        traceabilityStatus: 'RESOLVED',
        confidence,
        variantName: ev.variant || 'ORIGINAL',
        dosage,
        frequency,
        // Never invent clock times from a frequency abbreviation.
        timesOfDay: [],
        durationDays,
        quantity,
        instructions,
        evidenceRef: {
          evidenceId: ev.id!,
          lineNumber: ev.lineNumber,
          text: rawLine,
          charStart,
          charEnd,
          bbox: ev.bbox,
          normalizedBbox: ev.normalizedBbox,
          polygon: ev.polygon,
          pageIndex: ev.pageIndex ?? 0,
          engine: ev.engine,
          variant: ev.variant,
        },
      });
    }

    return mentions;
  }

  private extractFrequency(text: string): string | null {
    for (const item of this.frequencyPatterns) {
      if (item.pattern.test(text)) return item.value;
    }
    return null;
  }

  private findFrequencyStart(text: string): number | undefined {
    const matches = this.frequencyPatterns
      .map(({ pattern }) => pattern.exec(text)?.index)
      .filter((index): index is number => typeof index === 'number');
    return matches.length > 0 ? Math.min(...matches) : undefined;
  }

  private durationToDays(match: RegExpExecArray | null): number | null {
    if (!match) return null;
    const value = Number(match[1]);
    const unit = match[2].toLowerCase();
    if (unit.startsWith('week')) return value * 7;
    if (unit.startsWith('month')) return value * 30;
    return value;
  }

  private extractInstructions(text: string): string | null {
    const instructions: string[] = [];
    if (/\bbefore\s+(?:food|meal|breakfast|lunch|dinner)\b/i.test(text))
      instructions.push('BEFORE_FOOD');
    if (/\bafter\s+(?:food|meal|breakfast|lunch|dinner)\b/i.test(text))
      instructions.push('AFTER_FOOD');
    if (/\bwith\s+food\b/i.test(text)) instructions.push('WITH_FOOD');
    if (/\bat\s+(?:bedtime|night)|\bhs\b/i.test(text))
      instructions.push('AT_BEDTIME');
    return instructions.length > 0 ? instructions.join(',') : null;
  }

  private isPlausibleName(name: string): boolean {
    const normalized = name.normalize('NFKC').replace(/\s+/g, ' ').trim();

    const letters = normalized.replace(/[^\p{L}]/gu, '');

    if (letters.length < 3 || normalized.length > 60) return false;
    if (/^\d+$/.test(normalized)) return false;

    if (
      /\b(?:surgery|allerg(?:y|ies)|addictions?|thyroid|history|validity|consultation|before|hospital|doctor|patient|phone|address|date|gender|female|male|weight|height|new)\b/i.test(
        normalized,
      )
    ) {
      return false;
    }

    const tokens = normalized.split(/[^\p{L}\p{N}]+/u).filter(Boolean);

    if (!tokens.some((token) => token.replace(/[^\p{L}]/gu, '').length >= 4)) {
      return false;
    }

    return !/^(?:take|morning|evening|night|food|meal|days?|weeks?|months?|daily)$/i.test(
      normalized,
    );
  }

  private normalizeMedicineName(name: string): string {
    return name
      .normalize('NFKC')
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]/gu, '');
  }

  private normalizeConfidence(value: number): number {
    if (!Number.isFinite(value)) return 0;
    return Math.max(0, Math.min(1, value > 1 ? value / 100 : value));
  }
}
