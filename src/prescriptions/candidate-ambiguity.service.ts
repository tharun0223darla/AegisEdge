import { Injectable, Logger } from '@nestjs/common';
import { CandidateResult } from './candidate-generator.service';

export interface AmbiguityCheckResult {
  ambiguity: boolean;
  options: CandidateResult[];
  topMatch: CandidateResult | null;
}

@Injectable()
export class CandidateAmbiguityService {
  private readonly logger = new Logger(CandidateAmbiguityService.name);

  /**
   * Checks if a list of generator matches has ambiguous candidates within a dynamic score window.
   */
  checkAmbiguity(rawOcr: string, matches: CandidateResult[]): AmbiguityCheckResult {
    if (matches.length <= 1) {
      return {
        ambiguity: false,
        options: [],
        topMatch: matches[0] || null,
      };
    }

    const topMatch = matches[0];
    const topScore = Math.round(topMatch.similarity * 100);

    // Determine ambiguity window dynamically
    let ambiguityWindow = 10;
    if (topScore > 90) {
      ambiguityWindow = 3;
    } else if (topScore >= 70) {
      ambiguityWindow = 6;
    }

    // Filter candidates within the dynamic window of the top match
    const options = matches.filter((m) => {
      const matchScore = Math.round(m.similarity * 100);
      return (topScore - matchScore) <= ambiguityWindow;
    });

    if (options.length >= 2) {
      this.logger.log(`Ambiguity detected for "${rawOcr}" within window ${ambiguityWindow}. Top score: ${topScore}. Options count: ${options.length}`);
      return {
        ambiguity: true,
        options,
        topMatch,
      };
    }

    return {
      ambiguity: false,
      options: [],
      topMatch,
    };
  }
}
