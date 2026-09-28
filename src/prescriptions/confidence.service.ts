import { Injectable } from '@nestjs/common';
import { VerificationStatus } from '@prisma/client';

export interface ConfidenceResult {
  score: number;
  status: VerificationStatus | 'REJECT';
  reasons: string[];
  isRecovered: boolean;
  recoverySource: string | null;
}

@Injectable()
export class ConfidenceService {
  /**
   * Calculates a weighted confidence score (0-100) and maps it to a VerificationStatus
   * with explainable reasons, incorporating recovery parameters.
   *
   * Senior Principal Weights (v2):
   * - AI Verification: 45%
   * - OCR Quality: 20%
   * - DB Match: 15%
   * - Fuzzy Similarity: 10%
   * - Recovery Agreement: 10%
   */
  calculateConfidence(params: {
    // Legacy parameters
    aiVerificationScore?: number;    // 0 to 100
    dbMatchScore?: number;           // 0 to 100
    fuzzySimilarityScore?: number;   // 0 to 100
    recoveryAgreementScore?: number;  // 0 to 100

    // Common/shared parameters
    ocrConfidence: number;          // 0 to 100
    rawName: string;
    brandName?: string | null;
    genericName?: string | null;
    hasComposition?: boolean;
    hasUserCorrection?: boolean;
    hasGeminiTesseractAgreement?: boolean;
    hasRecoverySuccess?: boolean;
    historyScore?: number;          // 0 to 100

    // New 3D dimensions
    entityConfidence?: number;       // 0 to 100
    validationConfidence?: number;   // 0 to 100
  }): ConfidenceResult {
    const reasons: string[] = [];
    let score = 0;

    if (params.entityConfidence !== undefined && params.validationConfidence !== undefined) {
      // 3-Dimensional Confidence Logic
      score = (params.ocrConfidence * 0.40) + (params.entityConfidence * 0.30) + (params.validationConfidence * 0.30);

      if (params.validationConfidence >= 80) {
        reasons.push('AI verified or matched medicine master');
      } else if (params.validationConfidence >= 50) {
        reasons.push('Weakly matched or corrected medicine');
      }
      
      if (params.ocrConfidence >= 85) {
        reasons.push('High-quality OCR character capture');
      } else if (params.ocrConfidence >= 60) {
        reasons.push('Acceptable OCR character capture');
      }
      
      if (params.entityConfidence >= 80) {
        reasons.push('High entity extraction confidence');
      }

      if (params.hasGeminiTesseractAgreement) {
        reasons.push('Gemini and Tesseract streams agreed');
      }
    } else {
      // Legacy Calibration Parameters Logic
      const ocrPart = (params.ocrConfidence ?? 0) * 0.45;
      const aiPart = (params.aiVerificationScore ?? 0) * 0.30;
      const historyPart = (params.historyScore ?? params.dbMatchScore ?? 0) * 0.15;
      const consensusPart = (params.hasGeminiTesseractAgreement ? 100 : 0) * 0.10;

      score = ocrPart + aiPart + historyPart + consensusPart;

      if (params.aiVerificationScore && params.aiVerificationScore > 0) {
        reasons.push('AI verified');
      }
      if (params.ocrConfidence >= 85) {
        reasons.push('High-quality OCR character capture');
      } else if (params.ocrConfidence >= 60) {
        reasons.push('Acceptable OCR character capture');
      }
      if ((params.historyScore ?? 0) >= 100 || (params.dbMatchScore ?? 0) >= 100) {
        reasons.push('matched medicine master');
      }
      if (params.hasGeminiTesseractAgreement) {
        reasons.push('Gemini and Tesseract streams agreed');
      }
    }

    // Bound final score between 0 and 100
    const finalScore = Math.min(Math.max(Math.round(score), 0), 100);

    // Determine Status Thresholds (reject only if score < 20)
    let status: VerificationStatus | 'REJECT';
    if (finalScore >= 85) {
      status = VerificationStatus.VERIFIED;
    } else if (finalScore >= 60) {
      status = VerificationStatus.VERIFY_REQUIRED;
    } else if (finalScore >= 20) {
      status = VerificationStatus.NEEDS_REVIEW; // maps to NEEDS_REVIEW
    } else {
      status = 'REJECT';
    }

    const isRecovered = !!params.hasRecoverySuccess;
    const recoverySource = isRecovered ? 'OCR_RECOVERY' : null;

    return {
      score: finalScore,
      status,
      reasons,
      isRecovered,
      recoverySource,
    };
  }
}
