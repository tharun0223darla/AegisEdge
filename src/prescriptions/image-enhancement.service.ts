import { Injectable, Logger } from '@nestjs/common';
import sharp from 'sharp';
import { createWorker } from 'tesseract.js';
import { MedicalTokenService } from './medical-token.service';

export interface EnhancementResult {
  bestImage: Buffer;
  selectedVariant: 'ORIGINAL' | 'GRAYSCALE_SHARPEN' | 'ADAPTIVE_THRESHOLD';
  qualityScore: number;
}

@Injectable()
export class ImageEnhancementService {
  private readonly logger = new Logger(ImageEnhancementService.name);

  constructor(private tokenService: MedicalTokenService) {}

  /**
   * Generates 3 variants of the prescription image, scores them using local lightweight Tesseract OCR,
   * and returns the highest quality image variant.
   */
  async selectBestVariant(imageBuffer: Buffer): Promise<EnhancementResult> {
    this.logger.log('Generating image enhancement variants...');

    try {
      // 1. Generate Variant A (Original)
      const variantA = imageBuffer;

      // 2. Generate Variant B (Grayscale + Sharpen)
      const variantB = await sharp(imageBuffer)
        .greyscale()
        .sharpen({ sigma: 1.5, m1: 1.0, m2: 2.0 })
        .toBuffer();

      // 3. Generate Variant C (Adaptive/Binarized Threshold)
      const variantC = await sharp(imageBuffer)
        .greyscale()
        .threshold(140) // Standard mid-level binarization threshold
        .toBuffer();

      this.logger.log('Scoring variants with lightweight OCR...');

      const [scoreA, scoreB, scoreC] = await Promise.all([
        this.scoreVariant(variantA),
        this.scoreVariant(variantB),
        this.scoreVariant(variantC),
      ]);

      this.logger.log(`Scores - A (Original): ${scoreA}, B (Grayscale+Sharpen): ${scoreB}, C (Threshold): ${scoreC}`);

      let bestImage = variantA;
      let selectedVariant: 'ORIGINAL' | 'GRAYSCALE_SHARPEN' | 'ADAPTIVE_THRESHOLD' = 'ORIGINAL';
      let qualityScore = scoreA;

      if (scoreB > qualityScore) {
        bestImage = variantB;
        selectedVariant = 'GRAYSCALE_SHARPEN';
        qualityScore = scoreB;
      }

      if (scoreC > qualityScore) {
        bestImage = variantC;
        selectedVariant = 'ADAPTIVE_THRESHOLD';
        qualityScore = scoreC;
      }

      this.logger.log(`Selected variant: ${selectedVariant} with quality score: ${qualityScore}`);
      
      return {
        bestImage,
        selectedVariant,
        qualityScore,
      };
    } catch (error) {
      this.logger.error(`Failed during image enhancement pipeline: ${error.message}. Defaulting to Original.`);
      return {
        bestImage: imageBuffer,
        selectedVariant: 'ORIGINAL',
        qualityScore: 50,
      };
    }
  }

  private async scoreVariant(buffer: Buffer): Promise<number> {
    // Run a fast, lightweight Tesseract pass on the buffer
    const worker = await createWorker('eng', 1, {
      logger: () => {}, // Suppress console noise
    });

    try {
      const { data } = await worker.recognize(buffer);
      const confidence = data.confidence || 0;
      const text = data.text || '';
      
      // Calculate token density score using MedicalTokenService
      const words = text.split(/\s+/).filter(Boolean);
      let medicalTokenHits = 0;
      
      for (const word of words) {
        const scoreResult = this.tokenService.scoreToken(word);
        if (scoreResult.isMedicine || scoreResult.isDosage || scoreResult.isFrequencyOrInstruction) {
          medicalTokenHits++;
        }
      }

      // Final Quality Score formula: 70% OCR Confidence + 30% medical token relevance
      const tokenBonus = Math.min(medicalTokenHits * 10, 30); // Cap bonus at 30 points
      const score = Math.round((confidence * 0.7) + tokenBonus);
      
      return score;
    } catch (error) {
      this.logger.warn(`Failed to score variant: ${error.message}`);
      return 0;
    } finally {
      await worker.terminate();
    }
  }

  async enhanceImage(imageBuffer: Buffer, variant: string): Promise<Buffer> {
    switch (variant) {
      case 'ORIGINAL':
        return imageBuffer;
      case 'SHARPEN':
        return await sharp(imageBuffer)
          .sharpen()
          .toBuffer();
      case 'GRAYSCALE':
        return await sharp(imageBuffer)
          .greyscale()
          .toBuffer();
      case 'DENOISE':
        return await sharp(imageBuffer)
          .median(3)
          .toBuffer();
      case 'THRESHOLD':
        return await sharp(imageBuffer)
          .greyscale()
          .threshold(140)
          .toBuffer();
      case 'UPSCALE':
        try {
          const metadata = await sharp(imageBuffer).metadata();
          const width = metadata.width ? metadata.width * 2 : 2000;
          return await sharp(imageBuffer)
            .resize({ width })
            .toBuffer();
        } catch {
          return await sharp(imageBuffer)
            .resize({ width: 2000 })
            .toBuffer();
        }
      default:
        return imageBuffer;
    }
  }

  async runVariantEscalation(
    imageBuffer: Buffer,
    ocrRunner: (buffer: Buffer, variant: string) => Promise<{
      candidateCount: number;
      confidence: number;
      rawText: string;
      candidates: any[];
      selectedVariant?: string;
      evidence?: any[];
    }>,
    startTime: number,
  ) {
    const variants = ['ORIGINAL'] as const; // Temporarily force ORIGINAL only for reality validation
    const variantAttempts: string[] = [];
    let selectedVariant: string = 'ORIGINAL';
    let lastResult: any = null;
    let bestImage = imageBuffer;

    for (let i = 0; i < variants.length; i++) {
      const variant = variants[i];
      
      // Enforce maxPipelineTime = 18s budget check
      if (Date.now() - startTime > 18000) {
        this.logger.warn(`Variant escalation exceeded 18s pipeline budget. Aborting sequential retries.`);
        break;
      }

      variantAttempts.push(variant);
      this.logger.log(`Escalation: Attempting variant ${variant} (${i + 1}/${variants.length})`);

      let enhanced: Buffer;
      try {
          enhanced = await this.enhanceImage(imageBuffer, variant);
      } catch (err) {
        this.logger.error(`Failed to enhance image with variant ${variant}: ${err.message}. Using original image buffer.`);
        enhanced = imageBuffer;
      }

      const result = await ocrRunner(enhanced, variant);
      lastResult = result;
      selectedVariant = variant;
      bestImage = enhanced;

      if (variant === 'ORIGINAL') {
        // Escalate if candidateCount === 0 OR confidence < 35 OR candidateCount < 2 (which simplifies to candidateCount < 2 || confidence < 35)
        const shouldEscalate = result.candidateCount < 2 || result.confidence < 35;
        if (!shouldEscalate) {
          this.logger.log(`ORIGINAL variant satisfied quality gate. Stopping variant escalation.`);
          break;
        }
        this.logger.log(`ORIGINAL variant failed quality gate (candidateCount=${result.candidateCount}, confidence=${result.confidence}). Starting escalation retry...`);
      } else {
        // For subsequent variants, stop at first non-empty candidate list
        if (result.candidateCount > 0) {
          this.logger.log(`Variant ${variant} returned non-empty results (candidateCount=${result.candidateCount}). Stopping escalation.`);
          break;
        }
      }
    }

    return {
      bestImage,
      selectedVariant,
      variantAttempts,
      ocrResult: lastResult,
    };
  }
}

