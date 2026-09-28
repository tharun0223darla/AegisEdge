import { Injectable } from '@nestjs/common';

@Injectable()
export class HandwritingNormalizerService {
  /**
   * Normalizes ambiguous character shapes and removes non-essential delimiters
   * to align raw text with standard pharmacy product strings.
   */
  normalizeText(text: string): string {
    if (!text) return '';
    let normalized = text;

    // Apply common OCR misread character corrections in medicine names
    normalized = normalized
      .replace(/rn/gi, 'm')
      .replace(/vv/gi, 'w')
      .replace(/cl/gi, 'd')
      .replace(/0/g, 'O')
      .replace(/5/g, 'S')
      .replace(/I/g, 'l');

    // Suffix/end-of-word adjustments for ambiguous l/I (e.g. TELMl -> TELMI)
    normalized = normalized.replace(/([A-Z]+)l\b/g, '$1I');

    // Remove dots, slashes, and duplicate spaces
    normalized = normalized
      .replace(/[\/\.]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    return normalized;
  }
}
