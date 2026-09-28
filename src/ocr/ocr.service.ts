import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { createWorker } from 'tesseract.js';
import { createReadStream, existsSync, readFileSync } from 'fs';
import FormData from 'form-data';

// A single recognised line from the PaddleOCR sidecar.
export interface OcrLine {
  text: string;
  confidence: number; // 0-1
  bbox?: number[][];
  variant?: string;
  page?: number;
}

export type OcrSource = 'ML_KIT' | 'SERVER_OCR' | 'NO_RESULT';
export type OcrDocumentType = 'generic' | 'package' | 'bill' | 'prescription';

export interface OcrQuality {
  accepted: boolean;
  score: number;
  reason?: string | null;
  reasons?: string[];
  textLength: number;
  alphanumericRatio: number;
  medicationSignal: boolean;
}

export interface OcrOptions {
  documentType?: OcrDocumentType;
}

export interface OcrDiagnostics {
  textLength: number;
  blockCount: number;
  lineCount: number;
  elementCount: number;
  processingMs: number;
}

export interface OcrResult {
  success: boolean;
  rawText: string;
  confidence: number; // 0–100 average confidence
  wordsCount: number;
  engine?: 'paddleocr' | 'tesseract' | 'google-vision' | 'mlkit';
  lines?: OcrLine[]; // present when the PaddleOCR sidecar is used
  source?: OcrSource;
  fallbackReason?: string;
  diagnostics?: OcrDiagnostics;
  quality?: OcrQuality;
  selectedVariant?: string;
  modelVersion?: string;
  error?: string;
}

interface GoogleVisionResponse {
  responses?: Array<{
    error?: { message?: string };
    fullTextAnnotation?: { text?: string };
  }>;
}

interface PaddleOcrResponse {
  success?: boolean;
  rawText?: string;
  avgConfidence?: number;
  wordsCount?: number;
  lines?: OcrLine[];
  fallbackReason?: string | null;
  quality?: OcrQuality;
  selectedVariant?: string;
  modelVersion?: string;
  processingMs?: number;
}

// ─────────────────────────────────────────────────────────
// OCR Service — Phase 2
//
// Uses Tesseract.js (free, local, no API key required).
// Phase 3 can swap in Google Vision API by replacing
// the _runTesseract method — interface stays the same.
//
// SAFETY RULE:
//   This service extracts RAW TEXT ONLY.
//   It does NOT interpret, diagnose, or prescribe.
//   Extracted text is stored as-is and shown to the patient
//   for human confirmation before any medicine records
//   are created.
// ─────────────────────────────────────────────────────────

@Injectable()
export class OcrService {
  private readonly logger = new Logger(OcrService.name);

  // Optional Python sidecar (OpenCV preprocessing + PaddleOCR).
  // When unset, OCR uses the in-process Tesseract engine directly.
  private readonly ocrServiceUrl = process.env.OCR_SERVICE_URL?.trim();
  private readonly packageOcrProvider =
    process.env.PACKAGE_OCR_PROVIDER?.trim().toLowerCase();
  private readonly googleVisionApiKey =
    process.env.GOOGLE_VISION_API_KEY?.trim();
  private readonly ocrServiceToken = process.env.OCR_SERVICE_TOKEN?.trim();
  private readonly sidecarTimeoutMs = this.readPositiveInt(
    process.env.OCR_HTTP_TIMEOUT_MS,
    135000,
  );
  private readonly allowTesseractFallback =
    process.env.OCR_ALLOW_TESSERACT_FALLBACK?.trim().toLowerCase() === 'true' ||
    (process.env.OCR_ALLOW_TESSERACT_FALLBACK === undefined &&
      process.env.NODE_ENV !== 'production');

  constructor(private readonly http: HttpService) {}

  // ── Extract text from a local file path ──────────────────
  // Strategy: PaddleOCR sidecar first (if configured), Tesseract fallback.
  async extractText(
    filePath: string,
    options: OcrOptions = {},
  ): Promise<OcrResult> {
    // Guard: file must exist
    if (!existsSync(filePath)) {
      this.logger.error(`OCR failed — file not found: ${filePath}`);
      return {
        success: false,
        rawText: '',
        confidence: 0,
        wordsCount: 0,
        error: 'File not found on server',
      };
    }

    // 1. Try the PaddleOCR sidecar when configured.
    if (this.ocrServiceUrl) {
      const paddle = await this.runPaddleOcr(filePath, options);
      if (paddle) {
        return paddle;
      }
      this.logger.warn(
        'PaddleOCR sidecar was unavailable at the transport layer.',
      );
    }

    if (!this.allowTesseractFallback) {
      return this.noResult(
        this.ocrServiceUrl
          ? 'server_ocr_unavailable'
          : 'server_ocr_not_configured',
      );
    }

    // 2. Development/explicit fallback: in-process Tesseract.
    try {
      const tesseract = await this._runTesseract(filePath);
      return this.applyLocalQualityGate(tesseract, options.documentType);
    } catch (error) {
      // CRITICAL: OCR failure must NEVER crash the server or the upload flow
      const message = (error as Error).message ?? 'Unknown OCR error';
      this.logger.error(`Tesseract OCR failed for "${filePath}": ${message}`);
      return {
        success: false,
        rawText: '',
        confidence: 0,
        wordsCount: 0,
        error: `OCR processing failed: ${message}`,
      };
    }
  }

  async extractPackagePhotoText(filePath: string): Promise<OcrResult> {
    if (
      this.packageOcrProvider === 'google-vision' &&
      this.googleVisionApiKey
    ) {
      const cloud = await this.runGoogleVisionOcr(filePath);
      if (cloud && cloud.success && cloud.rawText.length > 0) {
        return cloud;
      }
      this.logger.warn(
        'Google Vision package OCR failed or returned no text; falling back to local OCR.',
      );
    }

    return this.extractText(filePath, { documentType: 'package' });
  }

  private async runGoogleVisionOcr(
    filePath: string,
  ): Promise<OcrResult | null> {
    if (!existsSync(filePath)) {
      this.logger.error(
        `Google Vision OCR failed - file not found: ${filePath}`,
      );
      return null;
    }

    try {
      const content = readFileSync(filePath).toString('base64');
      const url = `https://vision.googleapis.com/v1/images:annotate?key=${encodeURIComponent(
        this.googleVisionApiKey ?? '',
      )}`;
      const { data } = await firstValueFrom(
        this.http.post<GoogleVisionResponse>(
          url,
          {
            requests: [
              {
                image: { content },
                features: [{ type: 'TEXT_DETECTION' }],
              },
            ],
          },
          {
            timeout: 20000,
            maxBodyLength: Infinity,
            maxContentLength: Infinity,
          },
        ),
      );
      const response = data?.responses?.[0];
      const errorMessage = response?.error?.message;
      if (errorMessage) {
        this.logger.warn(
          `Google Vision OCR returned an error: ${errorMessage}`,
        );
        return null;
      }

      const rawText = String(response?.fullTextAnnotation?.text ?? '').trim();
      if (!rawText) {
        return null;
      }

      return {
        success: true,
        rawText,
        confidence: 85,
        wordsCount: rawText.split(/\s+/).filter(Boolean).length,
        engine: 'google-vision',
        source: 'SERVER_OCR',
        lines: this.synthesizeLinesFromText(rawText, 85),
      };
    } catch (error) {
      const message = (error as Error).message ?? 'unknown error';
      this.logger.warn(`Google Vision OCR call failed: ${message}`);
      return null;
    }
  }

  // ── PaddleOCR sidecar runner (HTTP) ───────────────────────
  // Returns null on any transport/engine failure so the caller can fall back.
  async runPaddleOcr(
    filePath: string,
    options: OcrOptions = {},
  ): Promise<OcrResult | null> {
    const configuredUrl = this.ocrServiceUrl?.trim();

    if (!configuredUrl) {
      this.logger.warn(
        'PaddleOCR sidecar URL is not configured; skipping PaddleOCR fallback safely.',
      );
      return null;
    }

    const url = `${configuredUrl.replace(/\/+$/, '')}/ocr`;

    try {
      const form = new FormData();
      form.append('file', createReadStream(filePath));
      form.append('documentType', options.documentType ?? 'generic');

      const headers: Record<string, string> = {
        ...form.getHeaders(),
      };
      if (this.ocrServiceToken) {
        headers['X-OCR-Service-Token'] = this.ocrServiceToken;
      }

      const { data } = await firstValueFrom(
        this.http.post<PaddleOcrResponse>(url, form, {
          headers,
          timeout: this.sidecarTimeoutMs,
          maxBodyLength: Infinity,
          maxContentLength: Infinity,
        }),
      );

      const rawText = (data?.rawText ?? '').trim();
      const lines: OcrLine[] = Array.isArray(data?.lines) ? data.lines : [];
      const confidence = Math.round(data?.avgConfidence ?? 0);
      const wordsCount =
        data?.wordsCount ??
        rawText.split(/\s+/).filter((w: string) => w.length > 0).length;
      const success = data?.success === true && rawText.length > 0;
      const fallbackReason = success
        ? undefined
        : String(data?.fallbackReason || data?.quality?.reason || 'no_text');

      this.logger.log(
        `PaddleOCR sidecar complete source=${success ? 'SERVER_OCR' : 'NO_RESULT'} ` +
          `documentType=${options.documentType ?? 'generic'} confidence=${confidence}% ` +
          `lines=${lines.length} fallbackReason=${fallbackReason ?? 'none'}`,
      );

      return {
        success,
        rawText,
        confidence,
        wordsCount,
        engine: 'paddleocr',
        lines,
        source: success ? 'SERVER_OCR' : 'NO_RESULT',
        fallbackReason,
        quality: data?.quality,
        selectedVariant: data?.selectedVariant,
        modelVersion: data?.modelVersion,
        diagnostics: {
          textLength: rawText.length,
          blockCount: 0,
          lineCount: lines.length,
          elementCount: wordsCount,
          processingMs: Number(data?.processingMs || 0),
        },
      };
    } catch (error) {
      const message = (error as Error).message ?? 'unknown error';
      this.logger.warn(`PaddleOCR sidecar call failed (${url}): ${message}`);
      return null;
    }
  }

  // ── Internal Tesseract runner ─────────────────────────────
  private async _runTesseract(filePath: string): Promise<OcrResult> {
    this.logger.log(`Starting OCR for: ${filePath}`);
    const startTime = Date.now();

    // Create a fresh worker per job (simpler for Phase 2, no worker pool needed)
    // Phase 5 / BullMQ integration will move this into a queue worker
    const worker = await createWorker('eng', 1, {
      // Suppress Tesseract's own verbose console output
      logger: () => {},
    });

    try {
      const { data } = await worker.recognize(filePath);

      const elapsed = Date.now() - startTime;
      const rawText = (data.text ?? '').trim();
      const confidence = Math.round(data.confidence ?? 0);
      const wordsCount = rawText
        .split(/\s+/)
        .filter((w) => w.length > 0).length;

      let lines: OcrLine[] = ((data as any).lines || []).map((line: any) => {
        const bbox = line.bbox
          ? [
              [line.bbox.x0, line.bbox.y0],
              [line.bbox.x1, line.bbox.y0],
              [line.bbox.x1, line.bbox.y1],
              [line.bbox.x0, line.bbox.y1],
            ]
          : undefined;
        return {
          text: (line.text || '').trim(),
          confidence: (line.confidence ?? 0) / 100,
          bbox,
        };
      });

      // Fallback: synthesize lines from raw text when Tesseract v5 returns no structured lines
      if (lines.length === 0 && rawText.length > 0) {
        lines = this.synthesizeLinesFromText(rawText, confidence);
      }

      this.logger.log(
        `OCR complete in ${elapsed}ms — confidence: ${confidence}%, words: ${wordsCount}, lines: ${lines.length}`,
      );

      return {
        success: true,
        rawText,
        confidence,
        wordsCount,
        engine: 'tesseract',
        lines,
      };
    } finally {
      await worker.terminate();
    }
  }

  async extractTextWithWorker(
    filePath: string,
    worker: any,
  ): Promise<OcrResult> {
    if (!existsSync(filePath)) {
      this.logger.error(`OCR failed — file not found: ${filePath}`);
      return {
        success: false,
        rawText: '',
        confidence: 0,
        wordsCount: 0,
        error: 'File not found on server',
      };
    }

    try {
      const startTime = Date.now();
      const { data } = await worker.recognize(filePath);

      const elapsed = Date.now() - startTime;
      const rawText = (data.text ?? '').trim();
      const confidence = Math.round(data.confidence ?? 0);
      const wordsCount = rawText
        .split(/\s+/)
        .filter((w) => w.length > 0).length;

      let lines: OcrLine[] = ((data as any).lines || []).map((line: any) => {
        const bbox = line.bbox
          ? [
              [line.bbox.x0, line.bbox.y0],
              [line.bbox.x1, line.bbox.y0],
              [line.bbox.x1, line.bbox.y1],
              [line.bbox.x0, line.bbox.y1],
            ]
          : undefined;
        return {
          text: (line.text || '').trim(),
          confidence: (line.confidence ?? 0) / 100,
          bbox,
        };
      });

      // Fallback: synthesize lines from raw text when Tesseract v5 returns no structured lines
      if (lines.length === 0 && rawText.length > 0) {
        lines = this.synthesizeLinesFromText(rawText, confidence);
      }

      this.logger.log(
        `OCR reused worker complete in ${elapsed}ms — confidence: ${confidence}%, words: ${wordsCount}, lines: ${lines.length}`,
      );

      return {
        success: true,
        rawText,
        confidence,
        wordsCount,
        engine: 'tesseract',
        lines,
      };
    } catch (error) {
      const message = (error as Error).message ?? 'Unknown OCR error';
      this.logger.error(
        `Reused worker OCR failed for "${filePath}": ${message}`,
      );
      return {
        success: false,
        rawText: '',
        confidence: 0,
        wordsCount: 0,
        error: `OCR processing failed: ${message}`,
      };
    }
  }

  // ── Synthesize OcrLine objects from raw text ──────────────
  // Fallback for Tesseract.js v5+ which does not return structured line data.
  private synthesizeLinesFromText(
    rawText: string,
    overallConfidence: number,
  ): OcrLine[] {
    return rawText
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .map((line) => ({
        text: line,
        confidence: overallConfidence / 100,
        bbox: undefined,
      }));
  }

  private applyLocalQualityGate(
    result: OcrResult,
    documentType: OcrDocumentType = 'generic',
  ): OcrResult {
    const text = result.rawText.trim();
    const alphanumeric = (text.match(/[a-z0-9]/gi) || []).length;
    const alphanumericRatio = alphanumeric / Math.max(1, text.length);
    // Blister foil reflection can lower Tesseract confidence to ~25-35% even when legible
    const minimumConfidence =
      documentType === 'prescription' ? 25 : documentType === 'package' ? 22 : 42;
    const minimumLength = documentType === 'package' ? 3 : 14;
    const accepted =
      text.length >= minimumLength &&
      result.confidence >= minimumConfidence &&
      alphanumericRatio >= 0.35;
    if (accepted) {
      return { ...result, source: 'SERVER_OCR' };
    }

    const reason =
      text.length < minimumLength
        ? 'insufficient_text'
        : result.confidence < minimumConfidence
          ? 'low_average_confidence'
          : 'low_alphanumeric_ratio';
    return this.noResult(reason, result.engine);
  }

  private noResult(
    fallbackReason: string,
    engine?: OcrResult['engine'],
  ): OcrResult {
    return {
      success: false,
      rawText: '',
      confidence: 0,
      wordsCount: 0,
      engine,
      source: 'NO_RESULT',
      fallbackReason,
      diagnostics: {
        textLength: 0,
        blockCount: 0,
        lineCount: 0,
        elementCount: 0,
        processingMs: 0,
      },
    };
  }

  private readPositiveInt(raw: string | undefined, fallback: number): number {
    const parsed = Number.parseInt(raw || '', 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
  }

  // ── Parse medicine lines from raw OCR text ────────────────
  // Heuristic pre-parser — produces loose candidates for UI display.
  // SAFETY: This is a helper for display only.
  // Final confirmation is ALWAYS done by the human patient.
  extractMedicineCandidates(rawText: string): ExtractedMedicineCandidate[] {
    if (!rawText || rawText.trim().length === 0) return [];

    const candidates: ExtractedMedicineCandidate[] = [];
    const lines = rawText
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);

    // Common dosage patterns: 500mg, 10ml, 5mcg, 250 mg
    const dosagePattern = /\b(\d+(?:\.\d+)?)\s*(mg|ml|mcg|g|iu|units?)\b/i;

    // Common frequency keywords
    const frequencyKeywords: Record<string, string> = {
      'once daily': 'DAILY',
      od: 'DAILY',
      bd: 'TWICE_DAILY',
      'twice daily': 'TWICE_DAILY',
      bid: 'TWICE_DAILY',
      tds: 'THREE_TIMES_DAILY',
      tid: 'THREE_TIMES_DAILY',
      'three times': 'THREE_TIMES_DAILY',
      qid: 'FOUR_TIMES_DAILY',
      'four times': 'FOUR_TIMES_DAILY',
      weekly: 'WEEKLY',
      sos: 'AS_NEEDED',
      'as needed': 'AS_NEEDED',
      prn: 'AS_NEEDED',
    };

    // Duration pattern: "for 30 days", "x 14 days", "10 days"
    const durationPattern = /(?:for\s+|x\s*)?(\d+)\s*days?/i;

    // Quantity pattern: "#30", "Qty: 30", "30 tabs"
    const quantityPattern =
      /(?:#|qty[:\s]*)(\d+)|(\d+)\s*(?:tablets?|tabs?|capsules?|caps?|pills?)/i;

    for (const line of lines) {
      const lineLower = line.toLowerCase();

      // Skip very short or header-like lines
      if (line.length < 4) continue;
      if (
        /^(patient|name|date|doctor|rx|prescription|address|hospital)/i.test(
          line,
        )
      )
        continue;

      const dosageMatch = dosagePattern.exec(line);
      if (!dosageMatch && line.length < 8) continue;

      // Try to detect medicine name: usually first word(s) before dosage
      let medicineName = line;
      if (dosageMatch) {
        medicineName = line.substring(0, dosageMatch.index).trim();
      }
      medicineName = medicineName.replace(/[^a-zA-Z0-9\s-]/g, '').trim();
      if (!medicineName || medicineName.length < 2) continue;

      const dosage = dosageMatch
        ? `${dosageMatch[1]}${dosageMatch[2]}`
        : undefined;

      // Detect frequency
      let frequency: string | undefined;
      for (const [keyword, freq] of Object.entries(frequencyKeywords)) {
        if (lineLower.includes(keyword)) {
          frequency = freq;
          break;
        }
      }

      // Detect duration
      const durationMatch = durationPattern.exec(lineLower);
      const durationDays = durationMatch
        ? parseInt(durationMatch[1], 10)
        : undefined;

      // Detect quantity
      const quantityMatch = quantityPattern.exec(lineLower);
      const quantity = quantityMatch
        ? parseInt(quantityMatch[1] ?? quantityMatch[2], 10)
        : undefined;

      candidates.push({
        medicineName,
        dosage,
        frequency,
        durationDays,
        quantity,
        rawLine: line,
      });
    }

    return candidates;
  }
}

export interface ExtractedMedicineCandidate {
  medicineName: string;
  dosage?: string;
  frequency?: string;
  durationDays?: number;
  quantity?: number;
  rawLine: string; // original line for patient review
}
