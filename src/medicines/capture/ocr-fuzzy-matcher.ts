/**
 * OCR-Aware Fuzzy Matcher
 * Combines character N-gram (Trigram) indexing with a visual OCR confusion cost matrix.
 * Specifically tuned for medicine packaging fonts, blister pack glare, and low-res captures.
 */

const OCR_VISUAL_CONFUSION_COSTS: Record<string, number> = {
  // a <-> c, o, e, u (extremely common in small sans-serif fonts)
  'a:c': 0.2,
  'c:a': 0.2,
  'a:o': 0.25,
  'o:a': 0.25,
  'a:e': 0.25,
  'e:a': 0.25,
  'a:u': 0.3,
  'u:a': 0.3,

  // o <-> 0, d, q, u, c
  'o:0': 0.1,
  '0:o': 0.1,
  'o:d': 0.25,
  'd:o': 0.25,
  'o:q': 0.25,
  'q:o': 0.25,
  'o:u': 0.3,
  'u:o': 0.3,
  'o:c': 0.25,
  'c:o': 0.25,

  // l <-> 1, i, I, |, !, t, j
  'l:1': 0.1,
  '1:l': 0.1,
  'l:i': 0.1,
  'i:l': 0.1,
  'l:|': 0.1,
  '|:l': 0.1,
  'l:!': 0.15,
  '!:l': 0.15,
  'l:t': 0.25,
  't:l': 0.25,
  'l:j': 0.3,
  'j:l': 0.3,
  'i:1': 0.1,
  '1:i': 0.1,

  // s <-> 5, z
  's:5': 0.15,
  '5:s': 0.15,
  's:z': 0.25,
  'z:s': 0.25,

  // z <-> 2
  'z:2': 0.15,
  '2:z': 0.15,

  // b <-> 8, 6, d
  'b:8': 0.15,
  '8:b': 0.15,
  'b:6': 0.25,
  '6:b': 0.25,
  'b:d': 0.3,
  'd:b': 0.3,

  // g <-> 9, q, y, p
  'g:9': 0.15,
  '9:g': 0.15,
  'g:q': 0.2,
  'q:g': 0.2,
  'g:y': 0.3,
  'y:g': 0.3,

  // e <-> c
  'e:c': 0.2,
  'c:e': 0.2,

  // u <-> v
  'u:v': 0.2,
  'v:u': 0.2,

  // f <-> t
  'f:t': 0.25,
  't:f': 0.25,

  // p <-> b
  'p:b': 0.3,
  'b:p': 0.3,
};

export class OcrFuzzyMatcher {
  /**
   * Pre-normalize text for OCR comparison
   */
  normalize(text: string): string {
    return text.toLowerCase().replace(/[^a-z0-9]/g, '');
  }

  /**
   * Extract character trigrams
   */
  trigrams(text: string): Set<string> {
    const norm = this.normalize(text);
    const set = new Set<string>();
    if (norm.length < 3) {
      if (norm.length > 0) set.add(norm);
      return set;
    }
    for (let i = 0; i <= norm.length - 3; i++) {
      set.add(norm.slice(i, i + 3));
    }
    return set;
  }

  /**
   * Calculate Dice/Sørensen coefficient on trigrams (0.0 to 1.0)
   */
  trigramSimilarity(a: string, b: string): number {
    const aSet = this.trigrams(a);
    const bSet = this.trigrams(b);
    if (aSet.size === 0 || bSet.size === 0) return 0;

    let intersection = 0;
    for (const gram of aSet) {
      if (bSet.has(gram)) intersection++;
    }

    return (2 * intersection) / (aSet.size + bSet.size);
  }

  /**
   * Compute OCR-weighted Levenshtein edit distance
   * Substitutions that match known OCR confusions (like a <-> c or 0 <-> o) have fractional cost (0.1 - 0.25).
   * Also handles multi-char homoglyphs like 'rn' <-> 'm', 'vv' <-> 'w', 'cl' <-> 'd'.
   */
  weightedOcrEditDistance(rawA: string, rawB: string): number {
    const a = this.preprocessMultiCharHomoglyphs(this.normalize(rawA));
    const b = this.preprocessMultiCharHomoglyphs(this.normalize(rawB));

    if (a === b) return 0;
    if (a.length === 0) return b.length;
    if (b.length === 0) return a.length;

    const matrix: number[][] = [];

    for (let i = 0; i <= a.length; i++) {
      matrix[i] = [i];
    }
    for (let j = 0; j <= b.length; j++) {
      matrix[0][j] = j;
    }

    for (let i = 1; i <= a.length; i++) {
      for (let j = 1; j <= b.length; j++) {
        const charA = a[i - 1];
        const charB = b[j - 1];

        let subCost = 1.0;
        if (charA === charB) {
          subCost = 0;
        } else {
          const key = `${charA}:${charB}`;
          subCost = OCR_VISUAL_CONFUSION_COSTS[key] ?? 1.0;
        }

        matrix[i][j] = Math.min(
          matrix[i - 1][j] + 1.0, // deletion
          matrix[i][j - 1] + 1.0, // insertion
          matrix[i - 1][j - 1] + subCost, // substitution
        );
      }
    }

    return matrix[a.length][b.length];
  }

  /**
   * Compute normalized similarity score between 0.0 and 1.0
   */
  similarity(rawA: string, rawB: string): number {
    const a = this.normalize(rawA);
    const b = this.normalize(rawB);
    if (!a || !b) return 0;
    if (a === b) return 1.0;

    const maxLen = Math.max(a.length, b.length);
    const dist = this.weightedOcrEditDistance(a, b);
    const editSim = Math.max(0, 1 - dist / maxLen);
    const triSim = this.trigramSimilarity(a, b);

    // Weighted combination of character trigram overlap and OCR Levenshtein
    return editSim * 0.7 + triSim * 0.3;
  }

  /**
   * Determine if an OCR token is a high-confidence match for a candidate master token
   */
  isOcrMatch(
    ocrText: string,
    masterText: string,
    threshold = 0.78,
  ): { isMatch: boolean; score: number; isVisualConfusion: boolean } {
    const normA = this.normalize(ocrText);
    const normB = this.normalize(masterText);
    if (!normA || !normB) {
      return { isMatch: false, score: 0, isVisualConfusion: false };
    }

    if (normA === normB) {
      return { isMatch: true, score: 1.0, isVisualConfusion: false };
    }

    const score = this.similarity(normA, normB);
    const weightedDist = this.weightedOcrEditDistance(normA, normB);
    const standardDist = this.standardEditDistance(normA, normB);
    const isVisualConfusion = weightedDist < standardDist;

    return {
      isMatch: score >= threshold,
      score,
      isVisualConfusion,
    };
  }

  private preprocessMultiCharHomoglyphs(val: string): string {
    return val
      .replace(/vv/g, 'w')
      .replace(/rn/g, 'm')
      .replace(/cl/g, 'd')
      .replace(/ph/g, 'f')
      .replace(/ri/g, 'n')
      .replace(/li/g, 'h');
  }

  private standardEditDistance(a: string, b: string): number {
    const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
    for (let i = 1; i <= a.length; i++) {
      let diag = prev[0];
      prev[0] = i;
      for (let j = 1; j <= b.length; j++) {
        const above = prev[j];
        prev[j] = Math.min(
          prev[j] + 1,
          prev[j - 1] + 1,
          diag + (a[i - 1] === b[j - 1] ? 0 : 1),
        );
        diag = above;
      }
    }
    return prev[b.length];
  }
}
