import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { CandidateGeneratorService } from './candidate-generator.service';
import { OcrCacheService } from './ocr-cache.service';
import { HandwritingNormalizerService } from './handwriting-normalizer.service';

@Injectable()
export class LearningService {
  private readonly logger = new Logger(LearningService.name);

  constructor(
    private prisma: PrismaService,
    private generator: CandidateGeneratorService,
    private cache: OcrCacheService,
    private normalizer: HandwritingNormalizerService,
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async runNightlyLearningJob(): Promise<void> {
    this.logger.log('Starting Nightly Human Feedback Learning Job...');
    try {
      // 1. Aggregate corrections
      const corrections = await this.prisma.medicineCorrection.findMany({
        where: { count: { gte: 1 } },
      });

      this.logger.log(`Aggregated ${corrections.length} correction entries for training.`);

      let masterUpdatesCount = 0;
      let cacheWarmedCount = 0;

      for (const corr of corrections) {
        // Check if raw name already exists in MedicineMaster
        const exists = await this.prisma.medicineMaster.findFirst({
          where: { brandName: { equals: corr.rawExtractedName, mode: 'insensitive' } },
        });

        if (!exists) {
          // Find the standard generic composition info from the correctedName
          const standard = await this.prisma.medicineMaster.findFirst({
            where: { brandName: { equals: corr.correctedName, mode: 'insensitive' } },
          });
          const dedupeKey = this.dedupeKey(
            corr.rawExtractedName,
            standard?.strength,
            standard?.manufacturer,
          );
          const duplicateKey = await this.prisma.medicineMaster.findUnique({
            where: { dedupeKey },
            select: { id: true },
          });

          if (duplicateKey) {
            continue;
          }

          // Create new MedicineMaster entry to build the alias mapping permanently
          await this.prisma.medicineMaster.create({
            data: {
              brandName: corr.rawExtractedName,
              normalizedName: this.normalizeKey(corr.rawExtractedName).replace(/-/g, ''),
              genericName: standard?.genericName || corr.correctedName,
              composition: standard?.composition || standard?.genericName || null,
              category: standard?.category || 'General',
              strength: standard?.strength || null,
              saltProfileId: standard?.saltProfileId || null,
              dedupeKey,
              source: 'USER',
              isVerified: false,
            },
          });
          masterUpdatesCount++;
        }

        // 2. Warm Cache for the rawExtractedName
        const normalized = this.normalizer.normalizeText(corr.rawExtractedName);
        const candidates = await this.generator.generateCandidates(corr.rawExtractedName, normalized, corr.userId);

        if (candidates.length > 0) {
          const mockHash = this.cache.generateHash(Buffer.from(corr.rawExtractedName));
          this.cache.set(mockHash, {
            rawText: corr.rawExtractedName,
            ocrSource: 'OCR_RECOVERY_LEARNED',
            ocrConfidence: 95,
            candidates: candidates.map(c => ({
              medicineName: c.candidate,
              dosage: c.strength || null,
              confidence: c.similarity,
            })),
          });
          cacheWarmedCount++;
        }
      }

      this.logger.log(`Nightly Learning Job completed successfully: updated ${masterUpdatesCount} MedicineMaster entries, warmed ${cacheWarmedCount} cache entries.`);
    } catch (error) {
      this.logger.error(`Nightly Learning Job failed: ${error.message}`);
    }
  }

  private dedupeKey(brandName: string, strength?: string | null, manufacturer?: string | null) {
    return this.normalizeKey([brandName, strength, manufacturer].filter(Boolean).join('|'));
  }

  private normalizeKey(value: string) {
    return value
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
  }
}
