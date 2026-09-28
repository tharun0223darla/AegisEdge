import { Injectable } from '@nestjs/common';
import type {
  MedicineCandidate,
  MedicineCandidateMatch,
  ResolverOutcome,
} from './medicine-candidate';

const STRONG_THRESHOLD = 0.9;
const POSSIBLE_THRESHOLD = 0.7;

@Injectable()
export class MedicineResolverService {
  classify(candidate: MedicineCandidate): ResolverOutcome {
    const matches = [...(candidate.possibleMasterMatches ?? [])]
      .filter((match) => Number.isFinite(match.score))
      .sort((left, right) => right.score - left.score);
    const best = matches[0];

    if (!best || best.score < POSSIBLE_THRESHOLD) {
      return { kind: 'UNKNOWN', needsConfirm: true };
    }

    if (candidate.source === 'BARCODE') {
      return best.score >= 1
        ? { kind: 'STRONG', match: best, needsConfirm: true }
        : { kind: 'UNKNOWN', needsConfirm: true };
    }

    if (best.score >= STRONG_THRESHOLD) {
      return { kind: 'STRONG', match: best, needsConfirm: true };
    }

    return {
      kind: 'POSSIBLE',
      matches: this.possibleMatches(matches),
      needsConfirm: true,
    };
  }

  private possibleMatches(matches: MedicineCandidateMatch[]) {
    return matches.filter((match) => match.score >= POSSIBLE_THRESHOLD).slice(0, 8);
  }
}
