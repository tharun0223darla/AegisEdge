import { Injectable, Logger } from '@nestjs/common';

export interface LearnedOcrAlias {
  ocrKey: string;
  rawOcrText: string;
  masterId: string;
  masterBrand: string;
  masterStrength?: string | null;
  hitCount: number;
  lastUsedAt: Date;
}

@Injectable()
export class OcrAliasCacheService {
  private readonly logger = new Logger(OcrAliasCacheService.name);
  private readonly cache = new Map<string, LearnedOcrAlias>();

  constructor() {
    this.seedKnownAliases();
  }

  /**
   * Normalize an OCR string into a canonical lookup key
   */
  private toKey(text: string): string {
    return text.toLowerCase().replace(/[^a-z0-9]/g, '');
  }

  /**
   * Learn a new OCR typo mapping to a verified master medicine
   */
  learn(
    rawOcrText: string,
    masterId: string,
    masterBrand: string,
    masterStrength?: string | null,
  ): void {
    const key = this.toKey(rawOcrText);
    if (!key || key.length < 3) return;

    const existing = this.cache.get(key);
    if (existing) {
      existing.hitCount += 1;
      existing.lastUsedAt = new Date();
      existing.masterId = masterId;
      existing.masterBrand = masterBrand;
      if (masterStrength) existing.masterStrength = masterStrength;
    } else {
      this.cache.set(key, {
        ocrKey: key,
        rawOcrText,
        masterId,
        masterBrand,
        masterStrength,
        hitCount: 1,
        lastUsedAt: new Date(),
      });
      this.logger.log(
        `Learned new OCR alias: "${rawOcrText}" -> "${masterBrand}" (${masterId})`,
      );
    }
  }

  /**
   * Lookup if an OCR string is already learned
   */
  lookup(rawOcrText: string): LearnedOcrAlias | null {
    const key = this.toKey(rawOcrText);
    if (!key) return null;

    const hit = this.cache.get(key);
    if (hit) {
      hit.hitCount += 1;
      hit.lastUsedAt = new Date();
      return hit;
    }

    return null;
  }

  /**
   * Pre-seed with common OCR optical confusions
   */
  private seedKnownAliases() {
    // Seed Selexipag optical typo
    this.learn('selexipcg', 'seed-selexipag', 'Selexipag', '200mcg');
    this.learn('selexipcg200', 'seed-selexipag-200', 'Selexipag 200', '200mcg');
    this.learn('selexipcg 200', 'seed-selexipag-200', 'Selexipag 200', '200mcg');
  }
}
