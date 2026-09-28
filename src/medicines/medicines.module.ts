import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { MedicinesService } from './medicines.service';
import { MedicineImportService } from './medicine-import.service';
import { MedicinesController } from './medicines.controller';
import { MedicineResolverService } from './capture/medicine-resolver.service';
import { PackageImageCaptureService } from './capture/package-image-capture.service';
import { StripVerificationService } from './capture/strip-verification.service';
import { OcrAliasCacheService } from './capture/ocr-alias-cache.service';
import { MedicineEnrichmentService } from './enrichment/medicine-enrichment.service';
import { OpenFdaLabelService } from './enrichment/openfda-label.service';
import { DailyMedLabelService } from './enrichment/dailymed-label.service';
import { MedlinePlusConnectService } from './enrichment/medlineplus-connect.service';
import { MedicineEnrichmentQueueService } from './enrichment/medicine-enrichment-queue.service';
import { RxNormService } from './enrichment/rxnorm.service';
import { PatientExplanationService } from './patient-explanations/patient-explanation.service';
import { TrustedWebSourceAssistService } from './web-sources/trusted-web-source-assist.service';
import { CdscoVerifierService } from './capture/cdsco-verifier.service';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { OcrModule } from '../ocr/ocr.module';
import { MedicationSafetyModule } from '../medication-safety/medication-safety.module';

@Module({
  imports: [AuditLogsModule, OcrModule, HttpModule, MedicationSafetyModule],
  controllers: [MedicinesController],
  providers: [
    MedicinesService,
    MedicineImportService,
    MedicineResolverService,
    PackageImageCaptureService,
    StripVerificationService,
    CdscoVerifierService,
    OcrAliasCacheService,
    MedicineEnrichmentService,
    OpenFdaLabelService,
    DailyMedLabelService,
    MedlinePlusConnectService,
    MedicineEnrichmentQueueService,
    RxNormService,
    PatientExplanationService,
    TrustedWebSourceAssistService,
  ],
  exports: [
    MedicinesService,
    MedicineResolverService,
    MedicineEnrichmentService,
    PatientExplanationService,
    OcrAliasCacheService,
    StripVerificationService,
    CdscoVerifierService,
  ],
})
export class MedicinesModule {}
