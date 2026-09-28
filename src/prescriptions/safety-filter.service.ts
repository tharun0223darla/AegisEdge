import { Injectable } from '@nestjs/common';
import { VerificationStatus } from '@prisma/client';

export interface FilterResult {
  allowed: boolean;
  status: VerificationStatus;
  reasons: string[];
}

@Injectable()
export class SafetyFilterService {
  /**
   * Evaluates safety of candidate.
   * Reject ONLY if confidence < 5 AND !hasDbMatch AND !hasOcrEvidence.
   */
  evaluateSafety(params: {
    hasCandidate: boolean;
    confidence: number;       // 0 to 100
    layoutConfidence: number; // 0 to 100
    isValidated: boolean;     // from database validation or critic review
    currentStatus: VerificationStatus | 'REJECT';
    medicineName?: string;
    hasDbMatch: boolean;
    hasOcrEvidence: boolean;
  }): FilterResult {
    // Reject ONLY if confidence < 5 AND !hasDbMatch AND !hasOcrEvidence
    if (params.confidence < 5 && !params.hasDbMatch && !params.hasOcrEvidence) {
      return {
        allowed: false,
        status: VerificationStatus.NEEDS_REVIEW,
        reasons: ['Rejected: Confidence score below minimum safety threshold (5%) with no DB match and no OCR evidence'],
      };
    }

    const rulesMet = params.hasCandidate &&
                     params.confidence > params.layoutConfidence &&
                     params.confidence >= 10 &&
                     params.isValidated;

    if (rulesMet) {
      return {
        allowed: true,
        status: params.currentStatus === 'REJECT' ? VerificationStatus.NEEDS_REVIEW : params.currentStatus,
        reasons: ['Passed safety filter gates'],
      };
    } else {
      const reasons: string[] = [];
      if (!params.hasCandidate) reasons.push('Missing candidate name');
      if (params.confidence <= params.layoutConfidence) reasons.push(`Medicine confidence (${params.confidence}%) <= layout confidence (${params.layoutConfidence}%)`);
      if (!params.isValidated) reasons.push('Medicine not clinically validated');
      
      return {
        allowed: true,
        status: VerificationStatus.NEEDS_REVIEW,
        reasons: ['Downgraded to NEEDS_REVIEW: ' + reasons.join(', ')],
      };
    }
  }
}
