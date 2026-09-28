import { Test, TestingModule } from '@nestjs/testing';
import { ConfidenceService } from './confidence.service';
import { VerificationStatus } from '@prisma/client';

describe('ConfidenceService', () => {
  let service: ConfidenceService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [ConfidenceService],
    }).compile();

    service = module.get<ConfidenceService>(ConfidenceService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('calculateConfidence', () => {
    it('should assign VERIFIED status for high-scoring matches', () => {
      // OCR (90 * 0.45 = 40.5) + AI (100 * 0.30 = 30) + History (100 * 0.15 = 15) + Consensus (100 * 0.10 = 10) = 95.5 -> 96
      const result = service.calculateConfidence({
        aiVerificationScore: 100,
        ocrConfidence: 90,
        dbMatchScore: 100,
        fuzzySimilarityScore: 0,
        recoveryAgreementScore: 0,
        rawName: 'Pregamax M',
        brandName: 'Pregamax M',
        genericName: 'Pregabalin + Methylcobalamin',
        hasGeminiTesseractAgreement: true,
        historyScore: 100,
      });

      expect(result.score).toBe(96);
      expect(result.status).toBe(VerificationStatus.VERIFIED);
      expect(result.reasons).toContain('AI verified');
      expect(result.reasons).toContain('High-quality OCR character capture');
      expect(result.reasons).toContain('matched medicine master');
      expect(result.reasons).toContain('Gemini and Tesseract streams agreed');
    });

    it('should assign VERIFY_REQUIRED status for moderate scores', () => {
      // OCR (80 * 0.45 = 36) + AI (75 * 0.30 = 22.5) + History (65 * 0.15 = 9.75) = 68.25 -> 68
      const result = service.calculateConfidence({
        aiVerificationScore: 75,
        ocrConfidence: 80,
        dbMatchScore: 65,
        fuzzySimilarityScore: 0,
        recoveryAgreementScore: 0,
        rawName: 'Pregamax M',
        brandName: 'Pregamax M',
        genericName: 'Pregabalin',
        hasGeminiTesseractAgreement: false,
        historyScore: 65,
      });

      expect(result.score).toBe(68);
      expect(result.status).toBe(VerificationStatus.VERIFY_REQUIRED);
      expect(result.reasons).toContain('AI verified');
      expect(result.reasons).toContain('Acceptable OCR character capture');
    });

    it('should assign NEEDS_REVIEW status for scores between 20 and 59', () => {
      // OCR (50 * 0.45 = 22.5) -> 23
      const result = service.calculateConfidence({
        aiVerificationScore: 0,
        ocrConfidence: 50,
        dbMatchScore: 0,
        fuzzySimilarityScore: 0,
        recoveryAgreementScore: 0,
        rawName: 'UnknownMed',
        brandName: null,
        genericName: null,
      });

      expect(result.score).toBe(23);
      expect(result.status).toBe(VerificationStatus.NEEDS_REVIEW);
    });

    it('should assign REJECT status for extremely low scores (< 20)', () => {
      // OCR (30 * 0.45 = 13.5) -> 14
      const result = service.calculateConfidence({
        aiVerificationScore: 0,
        ocrConfidence: 30,
        dbMatchScore: 0,
        fuzzySimilarityScore: 0,
        recoveryAgreementScore: 0,
        rawName: 'UnknownMed',
        brandName: null,
        genericName: null,
      });

      expect(result.score).toBe(14);
      expect(result.status).toBe('REJECT');
    });
  });
});
