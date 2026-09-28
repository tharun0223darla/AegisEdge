import { Injectable } from '@nestjs/common';
import type { OcrResult } from '../ocr/ocr.service';

const STRENGTH_PATTERN_SOURCE = String.raw`\d+(?:\.\d+)?\s*(?:mg|mcg|ug|g|gm|ml|iu|units?|%)(?:\s*\/\s*\d*(?:\.\d+)?\s*(?:mg|mcg|ug|g|gm|ml|iu|units?|%))?`;
const FORM_PATTERN_SOURCE = String.raw`tab|tabs|tablet|tablets|cap|caps|capsule|capsules|syrup|syp|inj|injection|drop|drops|cream|oint|ointment|gel|lotion|solution|susp|suspension|spray|sachet|sachets|strip|strips|vial|vials|ampoule|ampoules`;
const PACK_PATTERN_SOURCE = String.raw`(?:(?:strip\s+of\s+)?(?:\d+\s*[xX]\s*)?\d+\s*(?:tabs?|tablets?|caps?|capsules?|sachets?|strips?|vials?|ampoules?|ml|s|'s)|\d+\s*[xX]\s*\d+\s*'?)`;

export interface BillLineCandidate {
  rawName: string;
  billLine: string;
  extractedStrength?: string;
  extractedPack?: string;
  quantity?: number;
}

@Injectable()
export class BillCaptureService {
  extractCandidates(
    ocrResult: Pick<OcrResult, 'rawText' | 'lines'>,
  ): BillLineCandidate[] {
    const rawLines = this.ocrLines(ocrResult);
    const byKey = new Map<string, BillLineCandidate>();

    for (const line of rawLines) {
      const candidate = this.parseMedicineLine(line);
      if (!candidate) continue;

      const key = `${this.normalizeKey(candidate.rawName)}:${candidate.extractedStrength ?? ''}`;
      if (!byKey.has(key)) {
        byKey.set(key, candidate);
      }
    }

    return Array.from(byKey.values());
  }

  parseMedicineLine(line: string): BillLineCandidate | null {
    const normalized = this.normalizeLine(line);

    if (!this.isPotentialMedicineLine(normalized)) {
      return null;
    }

    const extractedStrength = this.extractStrength(normalized);
    const extractedPack = this.extractPack(normalized);
    const quantity = this.extractQuantity(normalized);
    const rawName = this.extractName(normalized, extractedStrength);

    if (rawName.length < 2) {
      return null;
    }

    return {
      rawName,
      billLine: line.trim(),
      extractedStrength,
      extractedPack,
      quantity,
    };
  }

  buildMasterSearchTerms(candidate: BillLineCandidate): string[] {
    const rawName = this.normalizeLine(candidate.rawName);
    const unitlessName = rawName
      .replace(
        /(\d+(?:\.\d+)?)\s*(mg|mcg|ug|g|gm|ml|iu|units?|%)(?=\b|\/)/gi,
        '$1',
      )
      .replace(/\s*\/\s*/g, '/')
      .replace(/\s+/g, ' ')
      .trim();
    const nameWithoutStrength = rawName
      .replace(new RegExp(`\\b${STRENGTH_PATTERN_SOURCE}\\b`, 'gi'), ' ')
      .replace(/[-/]+\s*$/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    const nameWithoutTrailingDose = unitlessName
      .replace(/(?:\s+|-)\d+(?:\.\d+)?(?:\/\d+(?:\.\d+)?)?$/i, ' ')
      .replace(/[-/]+\s*$/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    return Array.from(
      new Set(
        [
          rawName,
          unitlessName,
          nameWithoutStrength,
          nameWithoutTrailingDose,
        ].filter((value) => value.length >= 2),
      ),
    ).slice(0, 4);
  }

  private ocrLines(ocrResult: Pick<OcrResult, 'rawText' | 'lines'>) {
    const structured = (ocrResult.lines ?? [])
      .map((line) => ({ ...line, text: line.text.trim() }))
      .filter((line) => Boolean(line.text));

    if (structured.length) {
      return this.reconstructRows(structured);
    }

    return (ocrResult.rawText ?? '')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
  }

  private reconstructRows(lines: NonNullable<OcrResult['lines']>) {
    const positioned = lines
      .map((line) => {
        const xs = line.bbox?.map((point) => Number(point[0])) ?? [];
        const ys = line.bbox?.map((point) => Number(point[1])) ?? [];
        if (
          xs.length < 4 ||
          ys.length < 4 ||
          xs.some((value) => !Number.isFinite(value)) ||
          ys.some((value) => !Number.isFinite(value))
        ) {
          return null;
        }
        const top = Math.min(...ys);
        const bottom = Math.max(...ys);
        return {
          text: line.text,
          left: Math.min(...xs),
          top,
          bottom,
          center: (top + bottom) / 2,
          height: Math.max(1, bottom - top),
        };
      })
      .filter((line): line is NonNullable<typeof line> => Boolean(line))
      .sort(
        (left, right) => left.center - right.center || left.left - right.left,
      );

    if (positioned.length < 2) {
      return lines.map((line) => line.text);
    }

    const rows: Array<{
      top: number;
      bottom: number;
      center: number;
      parts: typeof positioned;
    }> = [];

    for (const part of positioned) {
      const row = rows.find((candidate) => {
        const overlap =
          Math.max(
            0,
            Math.min(candidate.bottom, part.bottom) -
              Math.max(candidate.top, part.top),
          ) /
          Math.max(1, Math.min(candidate.bottom - candidate.top, part.height));
        const centerDistance = Math.abs(candidate.center - part.center);
        return (
          overlap >= 0.4 || centerDistance <= Math.max(7, part.height * 0.55)
        );
      });

      if (!row) {
        rows.push({
          top: part.top,
          bottom: part.bottom,
          center: part.center,
          parts: [part],
        });
        continue;
      }

      row.parts.push(part);
      row.top = Math.min(row.top, part.top);
      row.bottom = Math.max(row.bottom, part.bottom);
      row.center = (row.top + row.bottom) / 2;
    }

    const reconstructed = rows
      .sort((left, right) => left.center - right.center)
      .map((row) =>
        this.normalizeLine(
          row.parts
            .sort((left, right) => left.left - right.left)
            .map((part) => part.text)
            .join(' '),
        ),
      )
      .filter(Boolean);
    const unpositioned = lines
      .filter((line) => !line.bbox || line.bbox.length < 4)
      .map((line) => this.normalizeLine(line.text))
      .filter(Boolean);

    return Array.from(new Set([...reconstructed, ...unpositioned]));
  }

  private normalizeLine(line: string) {
    return line
      .replace(/[|]/g, ' ')
      .replace(
        /([a-z])(?=\d{1,4}(?:tab|tabs|tablet|tablets|cap|caps|capsule|capsules)\b)/gi,
        '$1 ',
      )
      .replace(
        /(\d{1,4})(?=(?:tab|tabs|tablet|tablets|cap|caps|capsule|capsules)\b)/gi,
        '$1 ',
      )
      .replace(/\s+/g, ' ')
      .trim();
  }

  private isPotentialMedicineLine(line: string) {
    const lower = line.toLowerCase();

    if (line.length < 4 || !/[a-z]/i.test(line)) {
      return false;
    }

    if (/^[\d\s.,:/-]+$/.test(line)) {
      return false;
    }

    if (this.isStandaloneBillMetadata(line)) {
      return false;
    }

    if (
      /\b(cgst|sgst|igst|gst|tax|discount|subtotal|sub total|grand total|round off|cash|card|upi|balance|invoice|bill no|receipt|phone|address|patient|doctor|consultation|registration)\b/i.test(
        lower,
      )
    ) {
      return false;
    }

    if (/\bdr\.?\s*(?:name|[a-z])/i.test(line)) {
      return false;
    }

    const hasStrength = new RegExp(`\\b${STRENGTH_PATTERN_SOURCE}`, 'i').test(
      line,
    );
    const hasForm = new RegExp(`\\b(?:${FORM_PATTERN_SOURCE})\\b`, 'i').test(
      line,
    );
    const hasPack = new RegExp(`\\b${PACK_PATTERN_SOURCE}\\b`, 'i').test(line);
    const hasLikelyBrandWithNumber = /\b[a-z][a-z0-9-]{2,}\s+\d{2,4}\b/i.test(
      line,
    );
    const hasPharmacyCodeRow =
      /^(?:[A-Z]{2,5}\s*)?\d{4,10}[A-Z][A-Z0-9+./ -]{2,}/i.test(line) ||
      (/\b[A-Z][A-Z0-9]+-[A-Z0-9]*\d\b/i.test(line) &&
        (line.match(/\b\d+\.\d{1,2}\b/g)?.length ?? 0) >= 2);
    const hasMedicineSignal =
      hasStrength ||
      hasForm ||
      hasPack ||
      hasLikelyBrandWithNumber ||
      hasPharmacyCodeRow;

    if (/\b(hsn|batch|expiry|exp\.?)\b/i.test(lower) && !hasMedicineSignal) {
      return false;
    }

    return hasMedicineSignal;
  }

  private isStandaloneBillMetadata(line: string) {
    const month =
      '(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)';
    const dateValue =
      `(?:${month}[\\s./-]*(?:19|20)?\\d{2}` +
      `|\\d{1,2}[\\s./-]+${month}[\\s./-]+(?:19|20)?\\d{2}` +
      `|\\d{1,2}[./-]\\d{1,2}[./-](?:19|20)?\\d{2}` +
      `|(?:19|20)\\d{2}[./-]\\d{1,2}(?:[./-]\\d{1,2})?)`;

    if (new RegExp(`^${dateValue}$`, 'i').test(line.trim())) {
      return true;
    }

    return new RegExp(
      `^(?:mfg|mfd|manufactured|exp|expiry|expires|date|batch|b\\.?no|hsn|qty|quantity|rate|amount|mrp)` +
        `\\s*[:.-]?\\s*(?:${dateValue}|[a-z0-9/-]{0,24})$`,
      'i',
    ).test(line.trim());
  }

  private extractStrength(line: string) {
    const match = new RegExp(`\\b${STRENGTH_PATTERN_SOURCE}`, 'i').exec(line);
    return match?.[0]?.replace(/\s+/g, '') ?? undefined;
  }

  private extractPack(line: string) {
    const matches = Array.from(
      line.matchAll(new RegExp(`\\b${PACK_PATTERN_SOURCE}\\b`, 'gi')),
    );
    const match = matches[matches.length - 1];
    return match?.[0]?.replace(/\s+/g, ' ').trim() ?? undefined;
  }

  private extractQuantity(line: string) {
    const explicit = /\b(?:qty|quantity)\s*[:x-]?\s*(\d{1,4}(?:\.0+)?)\b/i.exec(
      line,
    );
    const explicitQuantity = this.asWholeQuantity(explicit?.[1]);
    if (explicitQuantity !== undefined) return explicitQuantity;

    // Common pharmacy tables end in Qty, Rate, Amount. Requiring the amount
    // arithmetic to agree prevents strengths, packs, dates, or batch numbers
    // from being mistaken for purchased quantity.
    const financialColumns =
      /(?:^|\s)(\d{1,4}(?:\.0+)?)\s+(\d+(?:\.\d{1,4})?)\s+(\d+(?:\.\d{1,2})?)\s*$/.exec(
        line,
      );
    const columnQuantity = this.asWholeQuantity(financialColumns?.[1]);
    if (columnQuantity !== undefined && financialColumns) {
      const rate = Number(financialColumns[2]);
      const amount = Number(financialColumns[3]);
      const tolerance = Math.max(0.5, Math.abs(amount) * 0.02);
      if (
        Number.isFinite(rate) &&
        Number.isFinite(amount) &&
        Math.abs(columnQuantity * rate - amount) <= tolerance
      ) {
        return columnQuantity;
      }
    }

    const afterPack = new RegExp(
      `\\b${PACK_PATTERN_SOURCE}\\b\\s+(\\d{1,3}(?:\\.0+)?)(?=\\s+(?:(?:rs\\.?|inr|mrp)\\s*)?\\d)`,
      'i',
    ).exec(line);
    return this.asWholeQuantity(afterPack?.[1]);
  }

  private asWholeQuantity(value?: string) {
    if (!value) return undefined;
    const quantity = Number(value);
    if (
      !Number.isFinite(quantity) ||
      !Number.isInteger(quantity) ||
      quantity < 1 ||
      quantity > 10_000
    ) {
      return undefined;
    }
    return quantity;
  }

  private extractName(line: string, strength?: string) {
    const packMatch = Array.from(
      line.matchAll(new RegExp(`\\b${PACK_PATTERN_SOURCE}\\b`, 'gi')),
    )
      .reverse()
      .find((match) => /x|s|'$/i.test(match[0]));
    const identitySegment = packMatch ? line.slice(0, packMatch.index) : line;
    const withoutMoney = identitySegment
      .replace(/^\s*\d+\s*[.)-]\s*/, ' ')
      .replace(/^\s*\d{1,3}\s+\d{4,10}\s+/i, ' ')
      .replace(/^\s*[A-Z]{2,5}-?\s+\d{4,10}\s+/i, ' ')
      .replace(/^\s*[A-Z]{2,5}-?\s+\d{4,10}(?=[A-Z])/i, ' ')
      .replace(/^\s*[A-Z]{2,5}-?\d{4,10}(?=[A-Z])/i, ' ')
      .replace(
        /\s+[A-Z0-9/-]{4,}\s+(?:(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[/-]?\d{2,4}|\d{1,2}\/\d{2,4})\b.*$/i,
        ' ',
      )
      .replace(
        /(?:rs\.?|inr|mrp|rate|amount|amt|price)\s*[:.-]?\s*\d+(?:\.\d{1,2})?/gi,
        ' ',
      )
      .replace(/\b\d+\.\d{1,2}\b/g, ' ')
      .replace(/\b(?:qty|quantity)\s*[:x-]?\s*\d{1,4}\b/gi, ' ')
      .replace(
        /\b(?:tab|tabs|tablet|cap|caps|capsule|strip|strips|bottle|box)\s*(?:of)?\s*\d+\b/gi,
        ' ',
      )
      .replace(/\b(?:hsn|batch|b\.?no|expiry|exp\.?)\b.*$/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    const formPattern = new RegExp(`\\b(?:${FORM_PATTERN_SOURCE})\\b`, 'i');
    const formMatch = formPattern.exec(withoutMoney);
    const strengthMatch = strength
      ? new RegExp(`\\b${STRENGTH_PATTERN_SOURCE}`, 'i').exec(withoutMoney)
      : null;
    const endIndex = [formMatch?.index, strengthMatch?.index]
      .filter((value): value is number => value !== undefined)
      .sort((left, right) => left - right)[0];
    const base = (
      endIndex !== undefined ? withoutMoney.slice(0, endIndex) : withoutMoney
    )
      .replace(/^[^a-z0-9]+/i, '')
      .replace(/[^a-z0-9+./ -]/gi, ' ')
      .replace(/\s+/g, ' ')
      .replace(/-\s+(?=\d)/g, '-')
      .trim();

    if (
      strength &&
      !this.normalizeKey(base).includes(this.normalizeKey(strength))
    ) {
      return `${base} ${strength}`.replace(/-\s+(?=\d)/g, '-').trim();
    }

    return base;
  }

  private normalizeKey(value: string) {
    return value.toLowerCase().replace(/[^a-z0-9]+/g, '');
  }
}
