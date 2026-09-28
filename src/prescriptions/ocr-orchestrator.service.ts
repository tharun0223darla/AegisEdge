import { Injectable, Logger } from '@nestjs/common';
import { OcrService, OcrResult, OcrLine } from '../ocr/ocr.service';
import * as fs from 'fs';
import * as path from 'path';
import sharp from 'sharp';
import { CandidateGeneratorService } from './candidate-generator.service';
import { createWorker } from 'tesseract.js';
import { OcrEvidence } from './interfaces/ocr-evidence.interface';
import { ensureOcrEvidenceId, normalizeBbox } from './ocr-evidence.util';

export interface OcrEnsembleResult {
  rawText: string;
  ocrSource: string;
  ocrConfidence: number;
  lines?: OcrLine[];
  selectedVariant: string;
  ocrVariantResults: any[];
  variantResults: any[];
  evidence?: OcrEvidence[];
}

@Injectable()
export class OcrOrchestratorService {
  private readonly logger = new Logger(OcrOrchestratorService.name);

  constructor(private ocrService: OcrService) {}

  /**
   * Orchestrates the OCR pipeline running sequentially exactly 5 variants.
   * Variant timeout: 2500ms. Global timeout: 12000ms. Early stop: confidence >= 80%.
   */
  async runEnsembleOcr(
    rxCrop: Buffer,
    mimeType: string,
    variant: string = 'ORIGINAL',
  ): Promise<OcrEnsembleResult> {
    this.logger.log(
      `Starting raw multi-variant OCR extraction pass on RX crop...`,
    );
    const startTime = Date.now();

    // 1. Save original.png in development and check debug dir cleanup
    const isDev = process.env.NODE_ENV === 'development';
    const isDebug = process.env.OCR_DEBUG === 'true';
    const debugDir = path.join(process.cwd(), 'uploads', 'debug');

    if (isDev && isDebug) {
      try {
        if (!fs.existsSync(debugDir)) {
          fs.mkdirSync(debugDir, { recursive: true });
        }
        fs.writeFileSync(path.join(debugDir, 'original.png'), rxCrop);

        // Auto clean files older than 24 hours
        const files = fs.readdirSync(debugDir);
        const now = Date.now();
        for (const file of files) {
          const filePath = path.join(debugDir, file);
          const stats = fs.statSync(filePath);
          if (now - stats.mtimeMs > 24 * 60 * 60 * 1000) {
            fs.unlinkSync(filePath);
            this.logger.log(`Cleaned up debug file older than 24h: ${file}`);
          }
        }
      } catch (err) {
        this.logger.warn(
          `Failed to process debug images directory: ${err.message}`,
        );
      }
    }

    const ocrVariantResults: any[] = [];
    const ocrEvidence: OcrEvidence[] = [];
    let bestResult: any = null;
    let bestScore = -1;

    // Define 5 variants
    const variants = [
      {
        name: 'variant1',
        getBuffer: async () => rxCrop,
      },
      {
        name: 'variant2',
        getBuffer: async () => {
          const metadata = await sharp(rxCrop).metadata();
          const width = metadata.width ? metadata.width * 2 : undefined;
          return sharp(rxCrop)
            .resize({ width })
            .greyscale()
            .normalize()
            .toBuffer();
        },
      },
      {
        name: 'variant3',
        getBuffer: async () => {
          const metadata = await sharp(rxCrop).metadata();
          const width = metadata.width ? metadata.width * 2 : undefined;
          return sharp(rxCrop)
            .resize({ width })
            .sharpen()
            .threshold(145)
            .toBuffer();
        },
      },
      {
        name: 'variant4',
        getBuffer: async () => {
          const metadata = await sharp(rxCrop).metadata();
          const width = metadata.width ? metadata.width * 2 : undefined;
          return sharp(rxCrop).resize({ width }).median(2).sharpen().toBuffer();
        },
      },
      {
        name: 'variant5',
        getBuffer: async () => {
          return sharp(rxCrop)
            .greyscale()
            .normalize()
            .threshold(128)
            .sharpen()
            .toBuffer();
        },
      },
    ];

    const knownDrugs = new Set(
      CandidateGeneratorService.ALIAS_KNOWLEDGE.map((d) => d.toLowerCase()),
    );

    // Instantiate worker once to reuse sequentially across variants
    let worker: any = null;
    try {
      worker = await createWorker('eng', 1, {
        logger: () => {},
      });
    } catch (workerErr) {
      this.logger.error(
        `Failed to instantiate shared Tesseract worker: ${workerErr.message}`,
      );
    }

    try {
      for (const v of variants) {
        // Performance Guard: Halt loop if global timeout 30000ms exceeded
        const elapsedTotal = Date.now() - startTime;
        if (elapsedTotal >= 30000) {
          this.logger.warn(
            `Global variant OCR timeout hit (${elapsedTotal}ms >= 30000ms). Stopping sequential run.`,
          );
          break;
        }

        let variantBuffer: Buffer;
        try {
          variantBuffer = await v.getBuffer();
          if (isDev && isDebug) {
            fs.writeFileSync(
              path.join(debugDir, `${v.name}.png`),
              variantBuffer,
            );
          }
        } catch (err) {
          this.logger.error(
            `Failed to generate variant image for ${v.name}: ${err.message}`,
          );
          continue;
        }

        if (!worker) {
          this.logger.error(
            `No active Tesseract worker available for ${v.name}. Skipping.`,
          );
          continue;
        }

        const variantStart = Date.now();
        let ocrResult: OcrResult;
        try {
          const variantTimeoutMs = Number(
            process.env.OCR_VARIANT_TIMEOUT_MS || 8000,
          );
          ocrResult = await this.runOcrWithTimeout(
            variantBuffer,
            variantTimeoutMs,
            worker,
          );
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          this.logger.warn(`OCR failed or timed out for ${v.name}: ${message}`);
          // A timed-out Tesseract job is explicitly terminated by
          // runOcrWithTimeout. Recreate the worker before the next variant.
          if (message.includes('timed out')) {
            try {
              worker = await createWorker('eng', 1, { logger: () => {} });
            } catch (recreateError) {
              this.logger.error(
                `Unable to recreate Tesseract worker after timeout`,
              );
              worker = null;
            }
          }
          continue;
        }

        const processingMs = Date.now() - variantStart;
        const variantMetadata = await sharp(variantBuffer).metadata();
        const sourceWidth = variantMetadata.width || 0;
        const sourceHeight = variantMetadata.height || 0;
        const rawText = ocrResult.rawText || '';
        const confidence = ocrResult.confidence || 0;
        const lines = ocrResult.lines || [];
        const lineCount = lines.length;

        // Map and accumulate Tesseract evidence
        const variantEvidence: OcrEvidence[] = lines.map((line, idx) => {
          const bbox = this.getFlatBbox(line.bbox);
          return ensureOcrEvidenceId({
            text: line.text,
            confidence: Math.round((line.confidence || 0) * 100),
            lineNumber: idx + 1,
            bbox,
            normalizedBbox: normalizeBbox(bbox, sourceWidth, sourceHeight),
            pageIndex: 0,
            engine: 'tesseract',
            variant: v.name,
            sourceImage: `${v.name}.png`,
            sourceWidth,
            sourceHeight,
          });
        });
        ocrEvidence.push(...variantEvidence);

        // Scoring calculation
        const textQuality = Math.min(rawText.length, 200) / 200;
        const lineCoverage = Math.min(lineCount, 10) / 10;

        const tokens = rawText
          .split(/\s+/)
          .map((t) => t.toLowerCase().replace(/[^a-z0-9]/g, ''))
          .filter((t) => t.length >= 3);
        const matchingTokens = tokens.filter((t) => knownDrugs.has(t));
        const dictionarySignal =
          tokens.length > 0 ? matchingTokens.length / tokens.length : 0.0;

        const score =
          0.7 * (confidence / 100) + 0.2 * textQuality + 0.1 * lineCoverage;

        const variantRes = {
          variant: v.name,
          confidence,
          rawText,
          lineCount,
          processingMs,
          score,
          lines,
          chars: rawText.length,
          tokens: tokens.length,
          processingTime: processingMs,
        };
        ocrVariantResults.push(variantRes);

        this.logger.log(
          `Variant ${v.name} completed in ${processingMs}ms: score=${score.toFixed(3)}, confidence=${confidence}%, tokens=${tokens.length}, dictionarySignal=${dictionarySignal.toFixed(2)}`,
        );

        if (score > bestScore) {
          bestScore = score;
          bestResult = variantRes;
        }

        // Conditional escalation: a clear, sufficiently long prescription with
        // medication context does not benefit from four more expensive passes.
        const hasMedicationContext =
          /\b(?:tab(?:let)?|cap(?:sule)?|syrup|inj(?:ection)?|\d+(?:\.\d+)?\s*(?:mg|mcg|g|ml|iu|units?)|od|bd|tid|qid)\b/i.test(
            rawText,
          );
        if (confidence >= 82 && rawText.length >= 60 && hasMedicationContext) {
          this.logger.log(
            `High-quality OCR reached on ${v.name}; stopping variant escalation.`,
          );
          break;
        }
      }
    } finally {
      if (worker) {
        try {
          await worker.terminate();
          this.logger.log(`Shared Tesseract worker terminated cleanly.`);
        } catch (termErr) {
          this.logger.warn(
            `Failed to terminate shared Tesseract worker: ${termErr.message}`,
          );
        }
      }
    }

    if (!bestResult) {
      this.logger.error(
        'All OCR variants failed or timed out. Returning original with 0 confidence.',
      );
      return {
        rawText: '',
        ocrSource: 'TESSERACT_MULTIVARIANT_FAILED',
        ocrConfidence: 0,
        lines: [],
        selectedVariant: 'variant1',
        ocrVariantResults,
        variantResults: ocrVariantResults,
        evidence: this.processFinalEvidence(ocrEvidence),
      };
    }

    // Controlled PaddleOCR Fallback
    const bestVariantChars = bestResult.rawText.length;
    const bestVariantConfidence = bestResult.confidence;

    const alphaNumericChars = (bestResult.rawText.match(/[a-z0-9]/gi) || [])
      .length;
    const alphaNumericRatio =
      bestVariantChars > 0 ? alphaNumericChars / bestVariantChars : 0;
    const hasMedicationCue =
      /\b(?:tab(?:let)?|cap(?:sule)?|syrup|inj(?:ection)?|\d+(?:\.\d+)?\s*(?:mg|mcg|g|ml|iu|units?)|od|bd|tid|qid)\b/i.test(
        bestResult.rawText,
      );
    if (
      bestVariantChars < 15 ||
      bestVariantConfidence < 30 ||
      alphaNumericRatio < 0.55 ||
      (!hasMedicationCue && bestVariantConfidence < 55)
    ) {
      this.logger.log(
        `Tesseract best variant had low quality (chars: ${bestVariantChars}, confidence: ${bestVariantConfidence}%). Triggering PaddleOCR fallback.`,
      );
      const bestVariantObj = variants.find(
        (v) => v.name === bestResult.variant,
      );
      if (bestVariantObj) {
        let tempPath = '';
        try {
          const bestBuffer = await bestVariantObj.getBuffer();
          const tempFileName = `temp_paddle_${Date.now()}_${Math.random().toString(36).substring(2, 7)}.png`;
          tempPath = path.join(process.cwd(), 'uploads', tempFileName);

          const uploadsDir = path.join(process.cwd(), 'uploads');
          if (!fs.existsSync(uploadsDir)) {
            fs.mkdirSync(uploadsDir, { recursive: true });
          }
          fs.writeFileSync(tempPath, bestBuffer);

          const paddleStart = Date.now();
          const paddleResult = await this.ocrService.runPaddleOcr(tempPath, {
            documentType: 'prescription',
          });
          const paddleMs = Date.now() - paddleStart;

          if (paddleResult && paddleResult.success) {
            // Map and accumulate PaddleOCR evidence
            const pLinesObj = paddleResult.lines || [];
            const paddleMetadata = await sharp(bestBuffer).metadata();
            const paddleWidth = paddleMetadata.width || 0;
            const paddleHeight = paddleMetadata.height || 0;
            const paddleEvidence: OcrEvidence[] = pLinesObj.map((line, idx) => {
              const bbox = this.getFlatBbox(line.bbox);
              return ensureOcrEvidenceId({
                text: line.text,
                confidence: Math.round((line.confidence || 0) * 100),
                lineNumber: idx + 1,
                bbox,
                normalizedBbox: normalizeBbox(bbox, paddleWidth, paddleHeight),
                pageIndex: 0,
                engine: 'paddleocr',
                variant: 'paddleocr',
                sourceImage: 'paddleocr.png',
                sourceWidth: paddleWidth,
                sourceHeight: paddleHeight,
              });
            });
            ocrEvidence.push(...paddleEvidence);

            const tTokens = bestResult.tokens;
            const tLines = bestResult.lineCount;
            const tUtility =
              0.6 * bestResult.confidence + 0.25 * tTokens + 0.15 * tLines;

            const pTokens = paddleResult.rawText
              .split(/\s+/)
              .map((t) => t.toLowerCase().replace(/[^a-z0-9]/g, ''))
              .filter((t) => t.length >= 3).length;
            const pLines = (paddleResult.lines || []).length;
            const pUtility =
              0.6 * paddleResult.confidence + 0.25 * pTokens + 0.15 * pLines;

            this.logger.log(
              `PaddleOCR utility: ${pUtility.toFixed(3)} (confidence: ${paddleResult.confidence}, tokens: ${pTokens}, lines: ${pLines}) vs Tesseract utility: ${tUtility.toFixed(3)} (confidence: ${bestResult.confidence}, tokens: ${tTokens}, lines: ${tLines})`,
            );

            if (pUtility > tUtility) {
              this.logger.log(`PaddleOCR selected as superior OCR source.`);

              const paddleVariantRes = {
                variant: 'paddleocr',
                confidence: paddleResult.confidence,
                rawText: paddleResult.rawText,
                lineCount: pLines,
                processingMs: paddleMs,
                score: pUtility,
                lines: paddleResult.lines,
                chars: paddleResult.rawText.length,
                tokens: pTokens,
                processingTime: paddleMs,
              };
              ocrVariantResults.push(paddleVariantRes);

              return {
                rawText: paddleResult.rawText,
                ocrSource: 'PADDLEOCR',
                ocrConfidence: paddleResult.confidence,
                lines: paddleResult.lines,
                selectedVariant: 'paddleocr',
                ocrVariantResults,
                variantResults: ocrVariantResults,
                evidence: this.processFinalEvidence(ocrEvidence),
              };
            } else {
              this.logger.log(
                `Tesseract utility is higher or equal. Keeping Tesseract.`,
              );
            }
          } else {
            this.logger.warn(
              `PaddleOCR fallback service run failed or returned unsuccessful result.`,
            );
          }
        } catch (paddleErr) {
          this.logger.error(
            `Error during PaddleOCR fallback execution: ${paddleErr.message}`,
          );
        } finally {
          if (tempPath && fs.existsSync(tempPath)) {
            try {
              fs.unlinkSync(tempPath);
            } catch (unlinkErr) {
              this.logger.warn(
                `Failed to delete Paddle temp file: ${unlinkErr.message}`,
              );
            }
          }
        }
      }
    }

    this.logger.log(
      `Multi-variant selection complete. Selected best variant: ${bestResult.variant} with score ${bestResult.score.toFixed(3)}`,
    );

    return {
      rawText: bestResult.rawText,
      ocrSource: 'TESSERACT_MULTIVARIANT',
      ocrConfidence: bestResult.confidence,
      lines: bestResult.lines,
      selectedVariant: bestResult.variant,
      ocrVariantResults,
      variantResults: ocrVariantResults,
      evidence: this.processFinalEvidence(ocrEvidence),
    };
  }

  private async runOcrWithTimeout(
    buffer: Buffer,
    timeoutMs: number,
    worker: any,
  ): Promise<OcrResult> {
    const tempFileName = `temp_variant_${Date.now()}_${Math.random().toString(36).substring(2, 7)}.png`;
    const tempPath = path.join(process.cwd(), 'uploads', tempFileName);

    // Ensure uploads directory exists
    const uploadsDir = path.join(process.cwd(), 'uploads');
    if (!fs.existsSync(uploadsDir)) {
      fs.mkdirSync(uploadsDir, { recursive: true });
    }

    fs.writeFileSync(tempPath, buffer);

    let timeoutId: NodeJS.Timeout | undefined;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(async () => {
        try {
          await worker.terminate();
        } catch {
          // Worker may already be unavailable; the timeout still fails closed.
        }
        reject(
          new Error(`OCR variant execution timed out after ${timeoutMs}ms`),
        );
      }, timeoutMs);
    });

    const ocrPromise = this.ocrService.extractTextWithWorker(tempPath, worker);

    try {
      return await Promise.race([ocrPromise, timeoutPromise]);
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
      // On timeout the worker has been terminated, so the recognition job can
      // no longer read this file. On success recognition has already completed.
      if (fs.existsSync(tempPath)) {
        fs.unlinkSync(tempPath);
      }
    }
  }

  private getFlatBbox(bbox?: number[][]): number[] {
    if (!bbox || bbox.length === 0) return [];
    if (typeof bbox[0] === 'number') return bbox as any;
    const xs = bbox.map((pt) => pt[0]);
    const ys = bbox.map((pt) => pt[1]);
    return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
  }

  private processFinalEvidence(evidence: OcrEvidence[]): OcrEvidence[] {
    // Preserve all raw engine/variant observations. We only remove byte-for-byte
    // duplicate records and never cap evidence at this storage boundary.
    const seen = new Set<string>();
    const unique: OcrEvidence[] = [];
    for (const raw of evidence) {
      const ev = ensureOcrEvidenceId(raw);
      if (!seen.has(ev.id!)) {
        seen.add(ev.id!);
        unique.push(ev);
      }
    }
    return unique;
  }
}
