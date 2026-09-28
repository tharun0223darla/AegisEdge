import { Injectable, Logger } from '@nestjs/common';
import { readFileSync } from 'fs';
import { join } from 'path';

export interface NormalizationResult {
  // Canonical name if a confident match was found, else the cleaned input.
  normalized: string;
  matched: boolean;
  // 0–1 similarity of the best match (1 = exact).
  similarity: number;
}

// Offline medicine-name normalization using a bundled common-drugs list and
// Levenshtein distance. Catches common OCR typos (e.g. "Metformln" ->
// "metformin") without any network dependency.
@Injectable()
export class DrugNormalizer {
  private readonly logger = new Logger(DrugNormalizer.name);
  private readonly drugs: string[];

  constructor() {
    this.drugs = this.loadDrugs();
  }

  private loadDrugs(): string[] {
    const primaryPath = join(__dirname, 'data', 'common-drugs.json');
    const fallbackPath1 = join(process.cwd(), 'src', 'extraction', 'data', 'common-drugs.json');
    const fallbackPath2 = join(process.cwd(), 'dist', 'src', 'extraction', 'data', 'common-drugs.json');

    let filePath = primaryPath;
    const fs = require('fs');

    if (!fs.existsSync(primaryPath)) {
      if (fs.existsSync(fallbackPath1)) {
        filePath = fallbackPath1;
      } else if (fs.existsSync(fallbackPath2)) {
        filePath = fallbackPath2;
      } else {
        this.logger.warn(
          `Could not find common-drugs.json at any path: primary=${primaryPath}, fallback1=${fallbackPath1}, fallback2=${fallbackPath2}`
        );
        return [];
      }
    }

    try {
      const parsed = JSON.parse(readFileSync(filePath, 'utf-8'));
      return Array.isArray(parsed)
        ? parsed.map((d: string) => d.toLowerCase())
        : [];
    } catch (err) {
      this.logger.warn(
        `Could not load common-drugs.json; normalization disabled: ${(err as Error).message}`,
      );
      return [];
    }
  }

  normalize(raw: string): NormalizationResult {
    const cleaned = raw.trim().toLowerCase();
    if (!cleaned || this.drugs.length === 0) {
      return { normalized: raw.trim(), matched: false, similarity: 0 };
    }

    let best = '';
    let bestSim = 0;
    for (const drug of this.drugs) {
      const sim = this.similarity(cleaned, drug);
      if (sim > bestSim) {
        bestSim = sim;
        best = drug;
      }
    }

    // 0.82 threshold: tolerant of 1–2 char OCR errors, strict enough to avoid
    // collapsing distinct drugs together.
    if (bestSim >= 0.82) {
      return {
        normalized: this.titleCase(best),
        matched: true,
        similarity: Number(bestSim.toFixed(3)),
      };
    }
    return { normalized: raw.trim(), matched: false, similarity: Number(bestSim.toFixed(3)) };
  }

  private similarity(a: string, b: string): number {
    const dist = this.levenshtein(a, b);
    const maxLen = Math.max(a.length, b.length) || 1;
    return 1 - dist / maxLen;
  }

  private levenshtein(a: string, b: string): number {
    const m = a.length;
    const n = b.length;
    if (m === 0) return n;
    if (n === 0) return m;
    const prev = new Array<number>(n + 1);
    const curr = new Array<number>(n + 1);
    for (let j = 0; j <= n; j++) prev[j] = j;
    for (let i = 1; i <= m; i++) {
      curr[0] = i;
      for (let j = 1; j <= n; j++) {
        const cost = a[i - 1] === b[j - 1] ? 0 : 1;
        curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
      }
      for (let j = 0; j <= n; j++) prev[j] = curr[j];
    }
    return prev[n];
  }

  private titleCase(s: string): string {
    return s.replace(/\b\w/g, (c) => c.toUpperCase());
  }
}
