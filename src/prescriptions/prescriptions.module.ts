import { Module } from '@nestjs/common';
import { PrescriptionsService } from './prescriptions.service';
import { PrescriptionsController } from './prescriptions.controller';
import { PrescriptionVisionService } from './prescription-vision.service';
import { PrescriptionVisionJobService } from './prescription-vision-job.service';
import { MedicineValidationService } from './medicine-validation.service';
import { ConfidenceService } from './confidence.service';
import { MedicineVerificationService } from './medicine-verification.service';
import { PrescriptionAiService } from './prescription-ai.service';
import { MedicineIntelligenceService } from './medicine-intelligence.service';
import { PrescriptionLayoutService } from './prescription-layout.service';
import { ImageEnhancementService } from './image-enhancement.service';
import { OcrOrchestratorService } from './ocr-orchestrator.service';
import { OcrCacheService } from './ocr-cache.service';
import { OcrFailureService } from './ocr-failure.service';
import { OcrReviewService } from './ocr-review.service';
import { PrescriptionContextService } from './prescription-context.service';
import { MedicalTokenService } from './medical-token.service';
import { CandidateGeneratorService } from './candidate-generator.service';
import { OcrRecoveryService } from './recovery/ocr-recovery.service';
import { MedicalContextService } from './medical-context.service';
import { HandwritingNormalizerService } from './handwriting-normalizer.service';
import { SafetyFilterService } from './safety-filter.service';
import { OcrMetricsService } from './ocr-metrics.service';
import { LearningService } from './learning.service';
import { CandidateAmbiguityService } from './candidate-ambiguity.service';
import { OcrObservabilityService } from './ocr-observability.service';
import { RegexCandidateGenerator } from './regex-candidate-generator.service';
import { DictionaryCandidateGenerator } from './dictionary-candidate-generator.service';
import { LlmCandidateAdapter } from './llm-candidate-adapter.service';
import { CandidateClusteringService } from './candidate-clustering.service';
import { CandidateGenerationService } from './candidate-generation.service';
import { OcrModule } from '../ocr/ocr.module';
import { ExtractionModule } from '../extraction/extraction.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';

@Module({
  imports: [
    OcrModule,         // for OCR text extraction
    ExtractionModule,  // for local LLM structured extraction (Ollama)
    AuditLogsModule,   // for upload + confirm audit trail
  ],
  controllers: [PrescriptionsController],
  providers: [
    PrescriptionsService,
    PrescriptionVisionService,
    PrescriptionVisionJobService,
    MedicineValidationService,
    ConfidenceService,
    MedicineVerificationService,
    PrescriptionAiService,
    MedicineIntelligenceService,
    PrescriptionLayoutService,
    ImageEnhancementService,
    OcrOrchestratorService,
    OcrCacheService,
    OcrFailureService,
    OcrReviewService,
    PrescriptionContextService,
    MedicalTokenService,
    CandidateGeneratorService,
    OcrRecoveryService,
    MedicalContextService,
    HandwritingNormalizerService,
    SafetyFilterService,
    OcrMetricsService,
    LearningService,
    CandidateAmbiguityService,
    OcrObservabilityService,
    RegexCandidateGenerator,
    DictionaryCandidateGenerator,
    LlmCandidateAdapter,
    CandidateClusteringService,
    CandidateGenerationService,
  ],
  exports: [
    PrescriptionsService,
    MedicineValidationService,
    ConfidenceService,
    MedicineVerificationService,
    PrescriptionAiService,
    MedicineIntelligenceService,
    PrescriptionLayoutService,
    ImageEnhancementService,
    OcrOrchestratorService,
    OcrCacheService,
    OcrFailureService,
    OcrReviewService,
    PrescriptionContextService,
    MedicalTokenService,
    CandidateGeneratorService,
    OcrRecoveryService,
    MedicalContextService,
    HandwritingNormalizerService,
    SafetyFilterService,
    OcrMetricsService,
    LearningService,
    CandidateAmbiguityService,
    OcrObservabilityService,
    RegexCandidateGenerator,
    DictionaryCandidateGenerator,
    LlmCandidateAdapter,
    CandidateClusteringService,
    CandidateGenerationService,
  ],
})
export class PrescriptionsModule {}