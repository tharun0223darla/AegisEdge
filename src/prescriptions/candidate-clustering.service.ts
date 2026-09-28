import { createHash } from 'crypto';
import { Injectable, Logger } from '@nestjs/common';
import {
  CandidateMention,
  CandidateCluster,
} from './interfaces/candidate-generation.interface';

@Injectable()
export class CandidateClusteringService {
  private readonly logger = new Logger(CandidateClusteringService.name);

  cluster(mentions: CandidateMention[]): CandidateCluster[] {
    const clusters: CandidateCluster[] = [];
    const mentionById = new Map(
      mentions.map((mention) => [mention.id, mention]),
    );

    for (const mention of mentions) {
      const compatibleCluster = clusters.find((cluster) => {
        if (!this.namesCompatible(cluster.normalizedName, mention.normalized))
          return false;
        return cluster.mentionIds.every((id) => {
          const existing = mentionById.get(id);
          return !existing || this.mentionsCompatible(existing, mention);
        });
      });

      if (!compatibleCluster) {
        clusters.push({
          id: '',
          normalizedName: mention.normalized,
          primaryName: mention.canonicalName || mention.rawText,
          mentionIds: [mention.id],
          dosage: mention.dosage || null,
          frequency: mention.frequency || null,
          timesOfDay: mention.timesOfDay || [],
          durationDays: mention.durationDays ?? null,
          quantity: mention.quantity ?? null,
          instructions: mention.instructions || null,
          maxEvidenceScore: mention.confidence,
          generators: [mention.sourceGenerator],
          variants: mention.variantName ? [mention.variantName] : ['ORIGINAL'],
          evidenceIds: mention.evidenceRef
            ? [mention.evidenceRef.evidenceId]
            : [],
          attributeConflicts: [],
        });
        continue;
      }

      compatibleCluster.mentionIds.push(mention.id);
      if (!compatibleCluster.generators.includes(mention.sourceGenerator)) {
        compatibleCluster.generators.push(mention.sourceGenerator);
      }
      if (
        mention.variantName &&
        !compatibleCluster.variants.includes(mention.variantName)
      ) {
        compatibleCluster.variants.push(mention.variantName);
      }
      if (
        mention.evidenceRef &&
        !compatibleCluster.evidenceIds.includes(mention.evidenceRef.evidenceId)
      ) {
        compatibleCluster.evidenceIds.push(mention.evidenceRef.evidenceId);
      }

      this.mergeAttribute(compatibleCluster, 'dosage', mention.dosage);
      this.mergeAttribute(compatibleCluster, 'frequency', mention.frequency);
      this.mergeAttribute(
        compatibleCluster,
        'durationDays',
        mention.durationDays,
      );
      this.mergeAttribute(compatibleCluster, 'quantity', mention.quantity);
      this.mergeAttribute(
        compatibleCluster,
        'instructions',
        mention.instructions,
      );
      if (
        (!compatibleCluster.timesOfDay ||
          compatibleCluster.timesOfDay.length === 0) &&
        mention.timesOfDay?.length
      ) {
        compatibleCluster.timesOfDay = [...mention.timesOfDay];
      }
      compatibleCluster.maxEvidenceScore = Math.max(
        compatibleCluster.maxEvidenceScore,
        mention.confidence,
      );

      // Prefer a canonical dictionary/LLM name over a raw OCR spelling.
      if (
        mention.canonicalName &&
        mention.canonicalName.length >= compatibleCluster.primaryName.length
      ) {
        compatibleCluster.primaryName = mention.canonicalName;
        compatibleCluster.normalizedName = mention.normalized;
      }
    }

    for (const cluster of clusters) {
      const signature = JSON.stringify({
        name: cluster.normalizedName,
        evidence: [...cluster.evidenceIds].sort(),
        dosage: cluster.dosage || '',
        frequency: cluster.frequency || '',
        variants: [...cluster.variants].sort(),
      });
      cluster.id = createHash('sha256').update(signature).digest('hex');
    }

    return clusters;
  }

  private mentionsCompatible(
    a: CandidateMention,
    b: CandidateMention,
  ): boolean {
    if (!this.isLocationCompatible(a, b)) return false;
    if (
      a.dosage &&
      b.dosage &&
      this.normalizeAttribute(a.dosage) !== this.normalizeAttribute(b.dosage)
    )
      return false;
    if (a.frequency && b.frequency && a.frequency !== b.frequency) return false;
    return true;
  }

  private mergeAttribute(
    cluster: CandidateCluster,
    key: 'dosage' | 'frequency' | 'durationDays' | 'quantity' | 'instructions',
    incoming: string | number | null | undefined,
  ): void {
    if (incoming === null || incoming === undefined || incoming === '') return;
    const current = cluster[key];
    if (current === null || current === undefined || current === '') {
      switch (key) {
        case 'dosage':
        case 'frequency':
        case 'instructions':
          cluster[key] = String(incoming);
          break;
        case 'durationDays':
        case 'quantity':
          cluster[key] = Number(incoming);
          break;
      }
      return;
    }
    if (String(current) !== String(incoming)) {
      const conflict = `${key}:${current} vs ${incoming}`;
      if (!cluster.attributeConflicts.includes(conflict))
        cluster.attributeConflicts.push(conflict);
    }
  }

  private namesCompatible(a: string, b: string): boolean {
    if (a === b) return true;
    if (!a || !b) return false;
    const min = Math.min(a.length, b.length);
    const max = Math.max(a.length, b.length);
    if (min >= 5 && (a.startsWith(b) || b.startsWith(a)) && min / max >= 0.85)
      return true;
    const distance = this.levenshtein(a, b);
    return max >= 6 && 1 - distance / max >= 0.86;
  }

  private isLocationCompatible(
    a: CandidateMention,
    b: CandidateMention,
  ): boolean {
    const refA = a.evidenceRef;
    const refB = b.evidenceRef;
    // Untraceable mentions must not merge distinct prescription occurrences.
    if (!refA || !refB) return false;
    if ((refA.pageIndex ?? 0) !== (refB.pageIndex ?? 0)) return false;
    if (refA.evidenceId === refB.evidenceId) return true;
    if (
      refA.lineNumber === refB.lineNumber &&
      refA.variant === refB.variant &&
      refA.engine === refB.engine
    )
      return true;
    return this.boxesOverlap(
      refA.normalizedBbox || refA.bbox,
      refB.normalizedBbox || refB.bbox,
    );
  }

  private boxesOverlap(boxA?: number[], boxB?: number[]): boolean {
    if (!boxA || !boxB || boxA.length !== 4 || boxB.length !== 4) return false;
    const [x1a, y1a, x2a, y2a] = boxA;
    const [x1b, y1b, x2b, y2b] = boxB;
    const intersection =
      Math.max(0, Math.min(x2a, x2b) - Math.max(x1a, x1b)) *
      Math.max(0, Math.min(y2a, y2b) - Math.max(y1a, y1b));
    if (intersection <= 0) return false;
    const areaA = Math.max(0, x2a - x1a) * Math.max(0, y2a - y1a);
    const areaB = Math.max(0, x2b - x1b) * Math.max(0, y2b - y1b);
    const minimumArea = Math.min(areaA, areaB);
    return minimumArea > 0 && intersection / minimumArea >= 0.4;
  }

  private normalizeAttribute(value: string): string {
    return value.toLowerCase().replace(/\s+/g, '');
  }

  private levenshtein(a: string, b: string): number {
    const previous = Array.from({ length: b.length + 1 }, (_, index) => index);
    for (let i = 1; i <= a.length; i++) {
      let diagonal = previous[0];
      previous[0] = i;
      for (let j = 1; j <= b.length; j++) {
        const old = previous[j];
        previous[j] = Math.min(
          previous[j] + 1,
          previous[j - 1] + 1,
          diagonal + (a[i - 1] === b[j - 1] ? 0 : 1),
        );
        diagonal = old;
      }
    }
    return previous[b.length];
  }
}
