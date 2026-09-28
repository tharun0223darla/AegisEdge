import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { DocumentStatus, VerificationStatus } from '@prisma/client';
import { join } from 'path';
import { createReadStream, readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { OcrService } from '../ocr/ocr.service';
import { ExtractionService } from '../extraction/extraction.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { MedicineValidationService } from './medicine-validation.service';
import { PrescriptionAiService } from './prescription-ai.service';
import { MedicineIntelligenceService } from './medicine-intelligence.service';
import { PrescriptionLayoutService } from './prescription-layout.service';
import { ImageEnhancementService } from './image-enhancement.service';
import { OcrOrchestratorService } from './ocr-orchestrator.service';
import { PrescriptionVisionJobService } from './prescription-vision-job.service';
import { OcrCacheService } from './ocr-cache.service';
import { OcrFailureService } from './ocr-failure.service';
import { OcrReviewService } from './ocr-review.service';
import { PrescriptionContextService } from './prescription-context.service';
import { OcrMetricsService } from './ocr-metrics.service';
import { OcrRecoveryService } from './recovery/ocr-recovery.service';
import { CandidateGeneratorService } from './candidate-generator.service';
import { MedicalContextService } from './medical-context.service';
import { SafetyFilterService } from './safety-filter.service';
import { HandwritingNormalizerService } from './handwriting-normalizer.service';
import { ConfidenceService } from './confidence.service';
import { CandidateAmbiguityService } from './candidate-ambiguity.service';
import { CreatePrescriptionDto } from './dto/create-prescription.dto';
import { ConfirmPrescriptionDto, ConfirmedMedicineItemDto } from './dto/confirm-prescription.dto';
import { OcrObservabilityService } from './ocr-observability.service';
import { buildRelativePath } from '../common/utils/file-upload.util';
import { v4 as uuidv4 } from 'uuid';
import { CandidateGenerationService } from './candidate-generation.service';
import { CandidateClusteringService } from './candidate-clustering.service';
import { CandidateMention, CandidateGenerationResult } from './interfaces';

// Unified candidate shape across the LLM and regex extraction paths.
interface ExtractedCandidate {
  medicineName: string;
  dosage?: string;
  frequency?: string;
  durationDays?: number;
  quantity?: number;
  instructions?: string;
  confidenceScore: number;
  needsReview: boolean;
  fieldConfidence?: Record<string, number>;
}
class LowOcrQualityError extends Error {
  constructor(message: string, public readonly ocrResult: any) {
    super(message);
    this.name = 'LowOcrQualityError';
  }
}

@Injectable()
export class PrescriptionsService {
  private readonly logger = new Logger(PrescriptionsService.name);

  constructor(
    private prisma: PrismaService,
    private ocrService: OcrService,
    private extractionService: ExtractionService,
    private auditLogs: AuditLogsService,
    private configService: ConfigService,
    private validationService: MedicineValidationService,
    private prescriptionAiService: PrescriptionAiService,
    private intelligenceService: MedicineIntelligenceService,
    private layoutService: PrescriptionLayoutService,
    private enhancementService: ImageEnhancementService,
    private orchestratorService: OcrOrchestratorService,
    private readonly prescriptionVisionJobService: PrescriptionVisionJobService,
    private cacheService: OcrCacheService,
    private failureService: OcrFailureService,
    private criticService: OcrReviewService,
    private contextService: PrescriptionContextService,
    private metricsService: OcrMetricsService,
    private recoveryService: OcrRecoveryService,
    private safetyFilter: SafetyFilterService,
    private normalizer: HandwritingNormalizerService,
    private generatorService: CandidateGeneratorService,
    private medicalContext: MedicalContextService,
    private confidenceService: ConfidenceService,
    private ambiguityService: CandidateAmbiguityService,
    private observabilityService: OcrObservabilityService,
    private candidateGenService: CandidateGenerationService,
    private candidateClusteringService: CandidateClusteringService,
  ) { }

  // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // UPLOAD: save file metadata + run OCR + store raw text
  // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  async upload(
    userId: string,
    file: Express.Multer.File,
    dto: CreatePrescriptionDto,
  ) {
    const relativePath = buildRelativePath(
      'prescriptions',
      file.filename,
    );

    // Persist the original image as the permanent source of truth.
    const prescription =
      await this.prisma.prescription.create({
        data: {
          userId,
          fileName: file.originalname,
          storedName: file.filename,
          localPath: relativePath,
          mimeType: file.mimetype,
          fileSize: file.size,
          status: DocumentStatus.UPLOADED,
          notes: dto.notes,
          doctorName: dto.doctorName,
          prescribedAt: dto.prescribedAt
            ? new Date(dto.prescribedAt)
            : null,
        },
      });

    await this.auditLogs.log({
      userId,
      action: 'FILE_UPLOADED',
      entityType: 'Prescription',
      entityId: prescription.id,
      newValues: {
        fileName: file.originalname,
        fileSize: file.size,
      },
    });

    this.logger.log(
      `Prescription uploaded: ${prescription.id} by user ${userId}`,
    );

    // Canonical extraction path:
    // upload -> persistent DB queue -> vision worker.
    const queuedPrescription =
      await this.prisma.prescription.update({
        where: {
          id: prescription.id,
        },
        data: {
          status: DocumentStatus.OCR_PROCESSING,
        },
      });

    try {
      const visionJob =
        await this.prescriptionVisionJobService.enqueue(
          userId,
          prescription.id,
        );

      this.logger.log(
        `Vision job ${visionJob.id} queued automatically for ` +
        `prescription ${prescription.id}`,
      );

      return {
        extractionMode: 'VISION_JOB_QUEUED',
        visionJob,
        prescription: {
          ...queuedPrescription,
          fileUrl: this.buildPrescriptionFileUrl(prescription.id),
          localPath: undefined,
        },
        ocr: {
          success: true,
          status: 'QUEUED',
          confidence: 0,
          wordsCount: 0,
          candidateCount: 0,
          rawText: null,
          failureStage: null,
          reviewRequired: true,
          finalMedicines: [],
          message: 'Vision extraction queued',
        },
        extractedMedicines: [],
        reviewRequired: true,
        message:
          'Prescription uploaded successfully. ' +
          'Vision extraction is processing.',
      };
    } catch (error) {
      // Fail closed when the persistent job could not be created.
      await this.prisma.prescription.update({
        where: {
          id: prescription.id,
        },
        data: {
          status: DocumentStatus.FAILED,
        },
      });

      const message =
        error instanceof Error
          ? error.message
          : String(error);

      this.logger.error(
        `Unable to queue vision extraction for ` +
        `${prescription.id}: ${message}`,
      );

      throw error;
    }
  }

  async runVisionReview(
    userId: string,
    prescriptionId: string,
  ) {
    return this.prescriptionVisionJobService.enqueue(
      userId,
      prescriptionId,
    );
  }

  async getLatestVisionReviewJob(
    userId: string,
    prescriptionId: string,
  ) {
    return this.prescriptionVisionJobService.getLatestForPrescription(
      userId,
      prescriptionId,
    );
  }

  async getVisionReviewJob(
    userId: string,
    prescriptionId: string,
    jobId: string,
  ) {
    const job = await this.prescriptionVisionJobService.getJob(
      userId,
      jobId,
    );

    if (job.prescriptionId !== prescriptionId) {
      throw new NotFoundException(
        'Prescription vision job not found.',
      );
    }

    return job;
  }

  async confirm(
    userId: string,
    prescriptionId: string,
    dto: ConfirmPrescriptionDto,
  ) {
    const prescription = await this.findOne(userId, prescriptionId);

    if (prescription.status === DocumentStatus.CONFIRMED) {
      throw new BadRequestException(
        'This prescription has already been confirmed.',
      );
    }

    if (prescription.status === DocumentStatus.FAILED) {
      throw new BadRequestException(
        'This prescription has a failed status and cannot be confirmed. ' +
        'Please re-upload the file.',
      );
    }

    if (!dto.medicines || dto.medicines.length === 0) {
      throw new BadRequestException(
        'At least one medicine must be provided for confirmation.',
      );
    }

    const createdRecords: {
      medicineId: string;
      medicineName: string;
      scheduleId: string | null;
    }[] = [];

    // Process each confirmed medicine â€” inside a transaction
    await this.prisma.$transaction(async (tx) => {
      // Find all extracted suggestions to track manual edits and false positives
      const allExtracted = await tx.extractedMedicine.findMany({
        where: { prescriptionId },
      });
      const confirmedIds = dto.medicines.map((m) => m.extractedMedicineId).filter(Boolean);

      // Track completely rejected candidates as false positives
      for (const ext of allExtracted) {
        if (!confirmedIds.includes(ext.id)) {
          this.metricsService.recordFalsePositive();
        }
      }

      for (const item of dto.medicines) {
        const { medicine, schedule } = await this.createMedicineAndSchedule(
          tx,
          userId,
          prescriptionId,
          item,
        );

        // If linked to an extracted medicine record, mark it confirmed and track telemetry
        if (item.extractedMedicineId) {
          const extracted = await tx.extractedMedicine.findUnique({
            where: { id: item.extractedMedicineId },
          });
          if (!extracted) {
            throw new NotFoundException(`Extracted medicine record ${item.extractedMedicineId} not found`);
          }
          if (extracted.userId !== userId) {
            throw new ForbiddenException(`You do not have access to extracted medicine record ${item.extractedMedicineId}`);
          }
          if (extracted.isUserConfirmed) {
            throw new BadRequestException(`Extracted medicine record ${item.extractedMedicineId} is already confirmed`);
          }

          // Track manual edit if fields differ
          const isNameEdit = extracted.medicineName.toLowerCase() !== item.medicineName.trim().toLowerCase();
          const isDosageEdit = (extracted.dosage || '') !== (item.dosage || '');
          const isFrequencyEdit = (extracted.frequency || '') !== (item.frequency || '');

          if (isNameEdit) {
            this.metricsService.recordManualEdit();
            this.metricsService.recordFalsePositive(); // Name misspelling is a false positive
          } else if (isDosageEdit || isFrequencyEdit) {
            this.metricsService.recordManualEdit();
          }

          // Save learning correction if name corrected
          if (isNameEdit) {
            this.logger.log(`Recording learning correction for user ${userId}: "${extracted.medicineName}" -> "${item.medicineName.trim()}"`);
            
            const existingCorrection = await tx.medicineCorrection.findUnique({
              where: {
                userId_rawExtractedName: {
                  userId,
                  rawExtractedName: extracted.medicineName,
                },
              },
            });

            if (existingCorrection) {
              await tx.medicineCorrection.update({
                where: { id: existingCorrection.id },
                data: {
                  count: { increment: 1 },
                  lastUsed: new Date(),
                },
              });
            } else {
              await tx.medicineCorrection.create({
                data: {
                  userId,
                  rawExtractedName: extracted.medicineName,
                  correctedName: item.medicineName.trim(),
                  count: 1,
                  lastUsed: new Date(),
                },
              });
            }
          }

          await tx.extractedMedicine.update({
            where: { id: item.extractedMedicineId },
            data: {
              isConfirmed: true,
              isUserConfirmed: true,
              isActiveMedication: true,
              confirmedAt: new Date(),
              createdMedicineId: medicine.id,
              createdScheduleId: schedule?.id ?? null,
              timesOfDay: item.timesOfDay,
              frequency: item.frequency,
              resolutionState: 'VERIFIED',
            },
          });
        }

        createdRecords.push({
          medicineId: medicine.id,
          medicineName: medicine.name,
          scheduleId: schedule?.id ?? null,
        });
      }

      // Mark prescription as CONFIRMED
      await tx.prescription.update({
        where: { id: prescriptionId },
        data: {
          status: DocumentStatus.CONFIRMED,
          doctorName: dto.doctorName ?? prescription.doctorName,
          prescribedAt: dto.prescribedAt
            ? new Date(dto.prescribedAt)
            : prescription.prescribedAt,
        },
      });
    });

    await this.auditLogs.log({
      userId,
      action: 'PRESCRIPTION_CONFIRMED',
      entityType: 'Prescription',
      entityId: prescriptionId,
      newValues: {
        medicinesCreated: createdRecords.length,
        medicines: createdRecords.map((r) => r.medicineName),
      },
    });

    this.logger.log(
      `Prescription ${prescriptionId} confirmed â€” ${createdRecords.length} medicine(s) created`,
    );

    return {
      prescriptionId,
      status: 'CONFIRMED',
      createdRecords,
      message: `${createdRecords.length} medicine(s) successfully added to your medicines list.`,
      safetyReminder:
        'Your medicines have been added based on your confirmation. ' +
        'Always follow your doctor\'s prescribed dosage and schedule. ' +
        'Do not change your medication without consulting your doctor.',
    };
  }

  // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // LIST: paginated list of user's prescriptions
  // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  async findAll(userId: string, page = 1, limit = 20) {
    const skip = (page - 1) * limit;

    const [total, prescriptions] = await Promise.all([
      this.prisma.prescription.count({ where: { userId } }),
      this.prisma.prescription.findMany({
        where: { userId },
        skip,
        take: Math.min(limit, 50),
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          fileName: true,
          storedName: true,
          mimeType: true,
          fileSize: true,
          status: true,
          doctorName: true,
          prescribedAt: true,
          notes: true,
          createdAt: true,
          updatedAt: true,
          _count: { select: { extractedMedicines: true } },
        },
      }),
    ]);

    return {
      data: prescriptions.map((p) => ({
        ...p,
        fileUrl: this.buildPrescriptionFileUrl(p.id),
      })),
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }

  // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // GET ONE: prescription + its extracted medicines
  // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  async findOne(userId: string, id: string) {
    const prescription = await this.prisma.prescription.findUnique({
      where: { id },
      include: {
        extractedMedicines: {
          orderBy: { createdAt: 'asc' },
        },
      },
    });

    if (!prescription) throw new NotFoundException('Prescription not found');
    if (prescription.userId !== userId) {
      throw new ForbiddenException(
        'You do not have access to this prescription',
      );
    }

    let explainability: any = null;
    try {
      if (prescription.explainabilityJson) {
        explainability = typeof prescription.explainabilityJson === 'string'
          ? JSON.parse(prescription.explainabilityJson)
          : prescription.explainabilityJson;
      }
    } catch (err) {
      // ignore
    }

    const finalMeds = explainability?.finalMedicines || [];

    return {
      ...prescription,
      fileUrl: this.buildPrescriptionFileUrl(prescription.id),
      localPath: undefined, // never expose server path
      extractedMedicines: prescription.extractedMedicines.map((m, index) => {
        const matchedCand = finalMeds.find(c => c.medicineName.toLowerCase() === m.medicineName.toLowerCase());
        const candidateState = matchedCand?.candidateState || (m.verificationStatus === 'VERIFIED' ? 'KNOWN' : m.verificationStatus === 'VERIFY_REQUIRED' ? 'LOW_CONFIDENCE' : 'UNKNOWN');

        return {
          id: m.id,
          medicineName: m.medicineName,
          brandName: m.brandName,
          genericName: m.genericName,
          strength: m.strength,
          verificationStatus: m.verificationStatus,
          dosage: m.dosage,
          frequency: m.frequency,
          durationDays: m.durationDays,
          quantity: m.quantity,
          confidenceScore: m.confidenceScore,
          isConfirmed: m.isConfirmed,
          timesOfDay: m.timesOfDay,
          instructions: m.instructions,
          reasons: m.reasons,
          verificationSource: m.verificationSource,
          rank: index + 1,
          candidateState,
        };
      }),
    };
  }

  // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  async getFile(userId: string, id: string) {
    const prescription = await this.prisma.prescription.findUnique({ where: { id } });

    if (!prescription) throw new NotFoundException('Prescription not found');
    if (prescription.userId !== userId) {
      throw new ForbiddenException('You do not have access to this prescription');
    }

    const absolutePath = join(process.cwd(), prescription.localPath);
    if (!existsSync(absolutePath)) {
      throw new NotFoundException('Prescription file not found');
    }

    return {
      stream: createReadStream(absolutePath),
      mimeType: prescription.mimeType,
      fileName: prescription.fileName,
      fileSize: prescription.fileSize,
    };
  }

  private buildPrescriptionFileUrl(prescriptionId: string) {
    const baseUrl = process.env.API_BASE_URL ?? 'http://localhost:3001';
    return `${baseUrl}/api/prescriptions/${prescriptionId}/file`;
  }
  // INTERNAL: create Medicine + optional Schedule in transaction
  // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  private async createMedicineAndSchedule(
    tx: Parameters<Parameters<typeof this.prisma.$transaction>[0]>[0],
    userId: string,
    prescriptionId: string,
    item: ConfirmedMedicineItemDto,
  ) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Calculate end date from durationDays
    let endDate: Date | undefined;
    if (item.durationDays) {
      endDate = new Date(today);
      endDate.setDate(endDate.getDate() + item.durationDays);
    }

    // Create Medicine
    const medicine = await tx.medicine.create({
      data: {
        userId,
        name: item.medicineName,
        brandName: item.brandName,
        genericName: item.genericName,
        strength: item.dosage,
        instructions: item.instructions,
        totalQuantity: item.totalQuantity,
        remainingQuantity: item.totalQuantity,
        isActive: true,
        notes: `Added from prescription ${prescriptionId}`,
      },
    });

    // Create Schedule only if requested (default true)
    let schedule: any = null;
    const shouldCreateSchedule = item.createSchedule !== false;

    if (shouldCreateSchedule && item.timesOfDay.length > 0) {
      schedule = await tx.medicineSchedule.create({
        data: {
          userId,
          medicineId: medicine.id,
          frequency: item.frequency,
          timesOfDay: item.timesOfDay,
          daysOfWeek: [],
          startDate: today,
          endDate: endDate ?? null,
          dosesPerIntake: 1,
          unit: 'tablet',
          isActive: true,
          notes: `Schedule from confirmed prescription ${prescriptionId}`,
        },
      });

      // Generate dose logs for next 7 days
      await this.generateInitialDoseLogs(
        tx,
        userId,
        medicine.id,
        schedule.id,
        item.timesOfDay,
        today,
        endDate ?? null,
      );
    }

    return { medicine, schedule };
  }

  // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // INTERNAL: generate first 7 days of dose logs for new schedule
  // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  private async generateInitialDoseLogs(
    tx: Parameters<Parameters<typeof this.prisma.$transaction>[0]>[0],
    userId: string,
    medicineId: string,
    scheduleId: string,
    timesOfDay: string[],
    startDate: Date,
    endDate: Date | null,
  ) {
    const logsToCreate: {
      userId: string;
      medicineId: string;
      scheduleId: string;
      scheduledAt: Date;
    }[] = [];

    for (let dayOffset = 0; dayOffset < 7; dayOffset++) {
      const date = new Date(startDate);
      date.setDate(date.getDate() + dayOffset);

      if (endDate && date > endDate) break;

      for (const timeStr of timesOfDay) {
        const [hours, minutes] = timeStr.split(':').map(Number);
        const scheduledAt = new Date(date);
        scheduledAt.setHours(hours, minutes, 0, 0);
        logsToCreate.push({ userId, medicineId, scheduleId, scheduledAt });
      }
    }

    if (logsToCreate.length > 0) {
      await tx.doseLog.createMany({ data: logsToCreate, skipDuplicates: true });
    }
  }

  // â”€â”€ DELETE: remove prescription and extracted suggestions â”€â”€
  async remove(userId: string, id: string) {
    const prescription = await this.prisma.prescription.findUnique({
      where: { id },
    });
    if (!prescription) {
      throw new NotFoundException('Prescription not found');
    }
    if (prescription.userId !== userId) {
      throw new ForbiddenException('You do not have permission to delete this prescription');
    }

    await this.prisma.extractedMedicine.deleteMany({
      where: { prescriptionId: id },
    });

    await this.prisma.prescription.delete({
      where: { id: id },
    });

    await this.auditLogs.log({
      userId,
      action: 'DELETED',
      entityType: 'Prescription',
      entityId: id,
      newValues: { fileName: prescription.fileName },
    });

    return { success: true };
  }

  private rankCandidates(candidates: any[]): any[] {
    return candidates
      .map((c) => {
        const ocr = c.ocrConfidence !== undefined ? c.ocrConfidence : Math.round((c.confidenceScore || 0.8) * 100);
        const db = c.dbMatchScore !== undefined ? c.dbMatchScore : 0;
        const ai = c.aiVerificationScore !== undefined ? c.aiVerificationScore : 0;
        const freq = c.frequencyScore !== undefined ? c.frequencyScore : 0;
        const finalScore = (0.35 * ocr) + (0.30 * db) + (0.20 * ai) + (0.15 * freq);
        return {
          ...c,
          finalScore: Math.round(finalScore * 100) / 100,
        };
      })
      .sort((a, b) => b.finalScore - a.finalScore)
      .map((c, index) => ({
        ...c,
        rank: index + 1,
      }));
  }

  private async runRecoveryAsynchronously(
    prescriptionId: string,
    userId: string,
    fileBuffer: Buffer,
    rxCrop: Buffer,
    rawText: string,
    mimeType: string,
    imageHash: string,
    startTime: number,
  ): Promise<void> {
    this.logger.log(`[ASYNC RECOVERY] Starting async recovery execution for prescription: ${prescriptionId}`);
    try {
      const currentPrescription = await this.prisma.prescription.findUnique({
        where: { id: prescriptionId },
      });
      if (!currentPrescription || currentPrescription.status === DocumentStatus.CONFIRMED) {
        this.logger.log(`[ASYNC RECOVERY] Skipping recovery execution for prescription ${prescriptionId} because status is already CONFIRMED.`);
        return;
      }

      let existingEvidence: any[] = [];
      if (currentPrescription.explainabilityJson) {
        const parsed: unknown = typeof currentPrescription.explainabilityJson === 'string'
          ? JSON.parse(currentPrescription.explainabilityJson)
          : currentPrescription.explainabilityJson;
        if (
          parsed &&
          typeof parsed === 'object' &&
          'evidence' in parsed &&
          Array.isArray(parsed.evidence)
        ) {
          existingEvidence = parsed.evidence;
        }
      }

      const layoutConfidence = 100;
      const recoveryResult = await this.recoveryService.runRecoveryPipeline(
        fileBuffer,
        rxCrop,
        rawText,
        userId,
        mimeType
      );
      
      const recoveredCandidates: any[] = [];
      const rejectedCandidates: any[] = [];
      
      for (const item of recoveryResult) {
        if (item.suggestions.length === 0) continue;
        
        const bestSuggestionName = item.suggestions[0];
        
        const masterMatch = await this.prisma.medicineMaster.findFirst({
          where: { brandName: { equals: bestSuggestionName, mode: 'insensitive' } }
        });
        
        const lines = rawText.split('\n');
        const neighborText = lines.find(line => line.toLowerCase().includes(item.raw.toLowerCase())) || '';
        
        const contextResult = this.medicalContext.inferContext(bestSuggestionName, neighborText);
        
        const normalizedRaw = this.normalizer.normalizeText(item.raw);
        const scoredGenerator = await this.generatorService.generateCandidates(item.raw, normalizedRaw, userId);
        const matchedGenerator = scoredGenerator.find(g => g.candidate.toLowerCase() === bestSuggestionName.toLowerCase());
        
        let baseScore = matchedGenerator ? Math.round(matchedGenerator.similarity * 100) : 55;
        
        if (contextResult.hasContext) {
          baseScore += 10;
        }
        
        const review = await this.criticService.reviewPrescription(bestSuggestionName, contextResult.strength || null, '');
        const isOcrValidated = review.status === 'VALID' || (matchedGenerator?.source === 'MEDICINE_MASTER') || (matchedGenerator?.source === 'USER_CORRECTION');
        
        let dbMatchScore = 0;
        let aiVerificationScore = isOcrValidated ? 100 : 0;
        if (matchedGenerator?.source === 'MEDICINE_MASTER' || masterMatch) {
          dbMatchScore = 100;
        }
        let frequencyScore = 0;
        if (matchedGenerator?.source === 'USER_CORRECTION') {
          frequencyScore = 70;
        }
        
        const ocrConfidenceScore = Math.min(100, Math.max(0, baseScore));
        const entityConfidenceScore = 70;
        const validationConfidenceScore = Math.max(dbMatchScore, aiVerificationScore, frequencyScore);

        const confResult = this.confidenceService.calculateConfidence({
          ocrConfidence: ocrConfidenceScore,
          entityConfidence: entityConfidenceScore,
          validationConfidence: validationConfidenceScore,
          rawName: item.raw,
          brandName: bestSuggestionName,
          genericName: masterMatch?.genericName || null,
          hasComposition: !!(masterMatch?.genericName),
          hasUserCorrection: matchedGenerator?.source === 'USER_CORRECTION',
          hasGeminiTesseractAgreement: false,
          hasRecoverySuccess: true,
        });

        // Map candidateState for recovery candidate
        let candidateState: 'KNOWN' | 'UNKNOWN' | 'LOW_CONFIDENCE' | 'REJECTED';
        if (confResult.status === 'REJECT') {
          candidateState = 'REJECTED';
        } else if (!masterMatch && matchedGenerator?.source !== 'USER_CORRECTION' && !isOcrValidated) {
          candidateState = 'UNKNOWN';
        } else if (confResult.status === 'NEEDS_REVIEW' || confResult.score < 60) {
          candidateState = 'LOW_CONFIDENCE';
        } else {
          candidateState = 'KNOWN';
        }

        if (confResult.score < 20) {
          this.logger.warn(`Discarding recovery candidate "${bestSuggestionName}": score ${confResult.score} < 20`);
          rejectedCandidates.push({
            medicineName: bestSuggestionName,
            confidenceScore: confResult.score / 100,
            reasons: confResult.reasons,
            verificationStatus: 'REJECTED_LOW_CONFIDENCE',
            candidateState,
            ocrConfidence: ocrConfidenceScore,
            entityConfidence: entityConfidenceScore,
            validationConfidence: validationConfidenceScore,
          });
          continue;
        }

        // Check ambiguity
        let isAmbiguous = false;
        let ambiguousOptions: string[] = [];
        const ambiguityCheck = this.ambiguityService.checkAmbiguity(item.raw, scoredGenerator);
        if (ambiguityCheck.ambiguity) {
          isAmbiguous = true;
          ambiguousOptions = ambiguityCheck.options.map(o => o.candidate);
        }

        const reasonsList = [...confResult.reasons];
        if (isAmbiguous && ambiguousOptions.length > 0) {
          reasonsList.push(`AMBIGUOUS:${ambiguousOptions.join(',')}`);
          reasonsList.push('Multiple possible medicines detected');
        }
        
        recoveredCandidates.push({
          medicineName: bestSuggestionName,
          brandName: bestSuggestionName,
          genericName: masterMatch?.genericName || null,
          strength: contextResult.strength || masterMatch?.strength || null,
          dosage: contextResult.strength || masterMatch?.strength || null,
          frequency: contextResult.frequency || null,
          timesOfDay: [],
          durationDays: contextResult.durationDays ?? null,
          quantity: null,
          instructions: null,
          confidenceScore: confResult.score / 100,
          verificationStatus: candidateState === 'UNKNOWN' || candidateState === 'REJECTED' ? 'NEEDS_REVIEW' : confResult.status,
          reasons: reasonsList,
          verificationSource: 'OCR_RECOVERY',
          criticStatus: review.status,
          criticReason: review.reason,
          recovered: true,
          ocrConfidence: ocrConfidenceScore,
          entityConfidence: entityConfidenceScore,
          validationConfidence: validationConfidenceScore,
          candidateState,
          explainability: {
            rawOCR: rawText,
            normalizedOCR: normalizedRaw,
            candidate: bestSuggestionName,
            confidence: confResult.score,
            method: 'OCR_RECOVERY',
            recovered: true,
            reason: confResult.reasons.join(', '),
            layoutConfidence,
            ocrConfidence: baseScore,
            recoveryTriggered: true,
          }
        });
      }
      
      let finalCandidates = recoveredCandidates;
      
      const validCandidates: any[] = [];
      for (const c of finalCandidates) {
        const review = await this.criticService.reviewPrescription(c.medicineName, c.strength || c.dosage, c.instructions);
        const isOcrValidated = review.status === 'VALID' || c.verificationSource === 'MASTER_DB' || c.verificationSource === 'USER_CORRECTION';
        
        const ocrTextLower = rawText.toLowerCase();
        const candidateName = c.medicineName || '';
        let hasOcrEvidence = ocrTextLower.includes(candidateName.toLowerCase().trim());
        if (!hasOcrEvidence && candidateName) {
          const tokens = candidateName.toLowerCase().split(/[^a-zA-Z0-9]/).filter(t => t.length >= 3);
          for (const tok of tokens) {
            if (ocrTextLower.includes(tok)) {
              hasOcrEvidence = true;
              break;
            }
          }
        }

        const hasDbMatch = c.verificationSource === 'MEDICINE_MASTER' || c.verificationSource === 'USER_MEDICINES' || c.verificationSource === 'USER_CORRECTION';

        const safetyResult = this.safetyFilter.evaluateSafety({
          hasCandidate: !!c.medicineName,
          confidence: Math.round(c.confidenceScore * 100),
          layoutConfidence,
          isValidated: isOcrValidated,
          currentStatus: c.verificationStatus,
          medicineName: c.medicineName,
          hasDbMatch,
          hasOcrEvidence,
        });

        if (!safetyResult.allowed) {
          rejectedCandidates.push({
            ...c,
            verificationStatus: safetyResult.status,
            reasons: [...new Set([...(c.reasons || []), ...(safetyResult.reasons || [])])],
          });
          continue;
        }
        
        const inferred = this.contextService.inferContext(c.instructions, c.strength || c.dosage, c.frequency);
        validCandidates.push({
          ...c,
          verificationStatus: safetyResult.status,
          reasons: [...new Set([...(c.reasons || []), ...(safetyResult.reasons || [])])],
          dosage: inferred.dosage || c.dosage || c.strength,
          frequency: inferred.frequency || c.frequency,
          timesOfDay: inferred.timesOfDay.length > 0 ? inferred.timesOfDay : c.timesOfDay,
          durationDays: inferred.durationDays !== null ? inferred.durationDays : c.durationDays,
          instructions: inferred.instructions || c.instructions,
          criticStatus: review.status,
          criticReason: review.reason,
        });
      }
      
      finalCandidates = validCandidates;
      
      if (finalCandidates.length === 0) {
        const rawTokens = rawText.split(/[^a-zA-Z0-9]/).map((w) => w.trim()).filter((w) => w.length >= 3);
        const fallbackCandidates: any[] = [];
        
        for (const token of rawTokens) {
          if (fallbackCandidates.length >= 3) break;
          const normalized = this.normalizer.normalizeText(token);
          const suggestions = await this.generatorService.generateCandidates(token, normalized, userId);

          // Check ambiguity
          let isAmbiguous = false;
          let ambiguousOptions: string[] = [];
          const ambiguityCheck = this.ambiguityService.checkAmbiguity(token, suggestions);
          if (ambiguityCheck.ambiguity) {
            isAmbiguous = true;
            ambiguousOptions = ambiguityCheck.options.map(o => o.candidate);
          }
          
          for (const sug of suggestions) {
            if (fallbackCandidates.length >= 3) break;
            if (fallbackCandidates.some(f => f.medicineName.toLowerCase() === sug.candidate.toLowerCase())) continue;
            
            const confScore = Math.round(sug.similarity * 100);
            if (confScore < 20) continue;

            const reasonsList = ['Possible medicines recovered (Never Empty Policy)'];
            if (isAmbiguous && ambiguousOptions.length > 0) {
              reasonsList.push(`AMBIGUOUS:${ambiguousOptions.join(',')}`);
              reasonsList.push('Multiple possible medicines detected');
            }
            
            fallbackCandidates.push({
              medicineName: sug.candidate,
              brandName: sug.brandName || sug.candidate,
              genericName: sug.genericName || null,
              strength: sug.strength || null,
              dosage: sug.strength || null,
              frequency: null,
              timesOfDay: [],
              durationDays: null,
              quantity: null,
              instructions: null,
              confidenceScore: sug.similarity,
              verificationStatus: 'NEEDS_REVIEW',
              reasons: reasonsList,
              verificationSource: sug.source,
              criticStatus: 'VALID',
              criticReason: 'Recovered via fallback policy',
              recovered: true,
              ocrConfidence: confScore,
              dbMatchScore: sug.source === 'MEDICINE_MASTER' ? 100 : 0,
              aiVerificationScore: 0,
              frequencyScore: (sug.source === 'USER_CORRECTION' || sug.source === 'USER_MEDICINES') ? 100 : 0,
              explainability: {
                rawOCR: rawText,
                normalizedOCR: normalized,
                candidate: sug.candidate,
                confidence: confScore,
                method: 'NEVER_EMPTY_FALLBACK',
                recovered: true,
                reason: 'Never Empty Policy fallback',
                layoutConfidence,
                ocrConfidence: confScore,
                recoveryTriggered: true,
              }
            });
          }
        }
        finalCandidates = fallbackCandidates;
      }
      
      const ocrSuccess = finalCandidates.length > 0;
      const overallConfidence = finalCandidates.length > 0
        ? Math.round(Math.max(...finalCandidates.map(fc => fc.confidenceScore * 100), 0))
        : 50;
      
      finalCandidates = this.rankCandidates(finalCandidates);
      
      // Prefix match logging for async candidates
      for (const c of finalCandidates) {
        if (c.brandName && c.rawName) {
          const cleanBrand = c.brandName.toLowerCase().replace(/\s+/g, '');
          const cleanRaw = c.rawName.toLowerCase().replace(/\s+/g, '');
          if (cleanRaw.length >= 3 && cleanBrand.startsWith(cleanRaw) && cleanRaw.length < cleanBrand.length) {
            this.metricsService.recordPrefixMatch(c.rawName.trim().toLowerCase());
          }
        }
      }
      
      if (ocrSuccess) {
        this.cacheService.set(imageHash, {
          rawText,
          ocrSource: 'OCR_RECOVERY',
          ocrConfidence: overallConfidence,
          layout: {
            rxRegion: rxCrop.toString('base64').substring(0, 100),
            instructionRegion: '',
            confidence: 1.0,
            zones: {},
          },
          candidates: [], // final decisions are user-specific and are never cached
          evidence: existingEvidence,
        });
      }
      
      const explainabilityObjWithoutEvidence = {
        variant: 'ASYNC_RECOVERY',
        confidence: overallConfidence,
        candidateCount: finalCandidates.length,
        processingTime: Date.now() - startTime,
        extractionVersion: 2,
        // Candidate details
        candidateStates: {
          known: finalCandidates.filter(c => c.candidateState === 'KNOWN').length,
          unknown: finalCandidates.filter(c => c.candidateState === 'UNKNOWN').length,
          lowConfidence: finalCandidates.filter(c => c.candidateState === 'LOW_CONFIDENCE').length,
          rejected: rejectedCandidates.length,
        },
        finalMedicines: finalCandidates,
        rejectedCandidates: rejectedCandidates,
        rawOcrText: rawText,
      };

      const explainabilityJson = JSON.stringify(explainabilityObjWithoutEvidence);

      const explainabilityObjWithEvidence = {
        ...explainabilityObjWithoutEvidence,
        evidence: existingEvidence,
      };
      
      await this.prisma.prescription.update({
        where: { id: prescriptionId },
        data: {
          rawOcrText: explainabilityJson,
          explainabilityJson: explainabilityObjWithEvidence,
          status: ocrSuccess ? DocumentStatus.OCR_PROCESSED : DocumentStatus.FAILED,
        },
      });
      
      // Clear temporary primary/fallback extraction suggestions
      await this.prisma.extractedMedicine.deleteMany({
        where: { prescriptionId },
      });
      
      if (ocrSuccess && finalCandidates.length > 0) {
        await Promise.all(
          finalCandidates.map((c) =>
            this.prisma.extractedMedicine.create({
              data: {
                userId,
                prescriptionId,
                medicineName: c.medicineName,
                dosage: c.dosage ? String(c.dosage) : null,
                frequency: c.frequency || null,
                timesOfDay: c.timesOfDay || [],
                durationDays: c.durationDays ? Number(c.durationDays) : null,
                quantity: c.quantity ? Number(c.quantity) : null,
                instructions: c.instructions || null,
                confidenceScore: c.confidenceScore,
                isConfirmed: false,
                brandName: c.brandName || null,
                genericName: c.genericName || null,
                strength: c.strength || null,
                verificationStatus: c.verificationStatus,
                reasons: c.reasons || [],
                verificationSource: c.verificationSource || null,
              },
            }),
          ),
        );
      }
      
      this.metricsService.recordRun({
        success: ocrSuccess,
        recoveryTriggered: true,
        isEmpty: finalCandidates.length === 0,
        confidence: overallConfidence,
      });

      this.observabilityService.recordEvent({
        success: ocrSuccess,
        isEmpty: finalCandidates.length === 0,
        recoveryTriggered: true,
        latency: Date.now() - startTime,
        prefixMatched: finalCandidates.some(c => c.brandName && c.rawName && c.brandName.toLowerCase().replace(/\s+/g, '').startsWith(c.rawName.toLowerCase().replace(/\s+/g, '')) && c.rawName.length < c.brandName.length),
        accuracy: overallConfidence,
      });
      
      this.logger.log(`[ASYNC RECOVERY] Async recovery completed successfully for prescription: ${prescriptionId}`);
    } catch (error) {
      this.logger.error(`[ASYNC RECOVERY] Async recovery failed for prescription ${prescriptionId}: ${error.message}`);
    }
  }
}
