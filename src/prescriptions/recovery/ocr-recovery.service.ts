import { Injectable, Logger } from '@nestjs/common';
import { CoreAIService } from '../../ai/core-ai.service';
import { OcrService } from '../../ocr/ocr.service';
import { CandidateGeneratorService } from '../candidate-generator.service';
import { HandwritingNormalizerService } from '../handwriting-normalizer.service';
import sharp from 'sharp';
import * as fs from 'fs';
import * as path from 'path';

export interface RecoveryOutputItem {
  raw: string;
  suggestions: string[];
}

@Injectable()
export class OcrRecoveryService {
  private readonly logger = new Logger(OcrRecoveryService.name);

  constructor(
    private coreAiService: CoreAIService,
    private ocrService: OcrService,
    private generatorService: CandidateGeneratorService,
    private normalizerService: HandwritingNormalizerService,
  ) {}

  async runRecoveryPipeline(
    originalImage: Buffer,
    rxCrop: Buffer,
    rawOcrText: string,
    userId: string,
    mimeType: string,
  ): Promise<RecoveryOutputItem[]> {
    this.logger.log('Starting v2 OCR Recovery Pipeline...');

    // 1. Generate enhanced crop variants locally using sharp
    let grayscaleSharpen: Buffer;
    let binarizedThreshold: Buffer;

    try {
      grayscaleSharpen = await sharp(rxCrop)
        .greyscale()
        .sharpen({ sigma: 1.5, m1: 1.0, m2: 2.0 })
        .toBuffer();

      binarizedThreshold = await sharp(rxCrop)
        .greyscale()
        .threshold(140)
        .toBuffer();
    } catch (err) {
      this.logger.warn(
        `Failed to generate sharp crop variants in recovery: ${err.message}. Defaulting to original crop.`,
      );
      grayscaleSharpen = rxCrop;
      binarizedThreshold = rxCrop;
    }

    // Run a single structured Gemini Recovery Pass
    const rawMedicines = await this.runSingleRecoveryPass(rxCrop, mimeType);

    // Consolidate raw tokens extracted from the pass + the original raw OCR
    const rawTokensSet = new Set<string>();

    for (const item of rawMedicines) {
      if (item && item.trim().length >= 3) {
        rawTokensSet.add(item.trim());
      }
    }

    // Also parse primary raw OCR text for potential missed tokens
    if (rawOcrText) {
      const words = rawOcrText
        .split(/[^a-zA-Z0-9]/)
        .map((w) => w.trim())
        .filter((w) => w.length >= 3);
      for (const w of words) {
        // Only add if it looks like a medicine name token (alphabetic start)
        if (/^[a-zA-Z]/.test(w)) {
          rawTokensSet.add(w);
        }
      }
    }

    const rawTokens = Array.from(rawTokensSet);
    this.logger.log(
      `Raw candidates identified for lookup: ${JSON.stringify(rawTokens)}`,
    );

    const resultItems: RecoveryOutputItem[] = [];

    // Pass C: Lookup each raw token in database and static knowledge via CandidateGenerator
    for (const raw of rawTokens) {
      const normalized = this.normalizerService.normalizeText(raw);
      const candidates = await this.generatorService.generateCandidates(
        raw,
        normalized,
        userId,
      );

      // Map suggestions array
      const suggestions = candidates.map((c) => c.candidate);

      resultItems.push({
        raw,
        suggestions,
      });
    }

    // Return top 5 only
    return resultItems.slice(0, 5);
  }

  private async runTesseractOnCrop(cropBuffer: Buffer): Promise<string> {
    const tempFileName = `temp_recovery_crop_${Date.now()}.png`;
    const tempPath = path.join(process.cwd(), 'uploads', tempFileName);
    try {
      const uploadsDir = path.join(process.cwd(), 'uploads');
      if (!fs.existsSync(uploadsDir)) {
        fs.mkdirSync(uploadsDir, { recursive: true });
      }
      fs.writeFileSync(tempPath, cropBuffer);
      const ocrResult = await this.ocrService.extractText(tempPath, {
        documentType: 'prescription',
      });
      return ocrResult.rawText || '';
    } catch (error) {
      this.logger.error(`Tesseract recovery crop OCR failed: ${error.message}`);
      return '';
    } finally {
      if (fs.existsSync(tempPath)) {
        fs.unlinkSync(tempPath);
      }
    }
  }

  private async runSingleRecoveryPass(
    cropBuffer: Buffer,
    mimeType: string,
  ): Promise<string[]> {
    const rawText = await this.runTesseractOnCrop(cropBuffer);
    if (!rawText.trim()) {
      return [];
    }

    const prompt = `
You are an intelligent handwriting recovery agent and pharmacy transcriber.
We ran local OCR on a prescription crop and got the following raw text:
"${rawText}"

TASK:
Analyze this raw text and identify any probable medicine names.
If the spelling is distorted, messy, or abbreviated, guess the most likely standard medicine names.

Return a JSON object:
{
  "rawMedicines": ["TELMI", "AMOXICILLIN"]
}
`;

    try {
      const result = await this.coreAiService.generateJSON<{
        rawMedicines: string[];
      }>(
        prompt,
        'You are an intelligent handwriting recovery agent. Temperature is set to 0.2. Suggest matching standard medicines.',
      );
      return result?.rawMedicines || [];
    } catch (err) {
      this.logger.error(`Single recovery pass failed: ${err.message}`);
      return [];
    }
  }
}
