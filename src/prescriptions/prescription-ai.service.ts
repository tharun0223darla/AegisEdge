import { Injectable, Logger } from '@nestjs/common';
import { CoreAIService } from '../ai/core-ai.service';
import { OcrService } from '../ocr/ocr.service';
import * as fs from 'fs';
import * as path from 'path';

export interface ExtractedOcrCandidate {
  medicineName: string;
  dosage?: string | null;
  frequency?: string | null;
  timesOfDay?: string[];
  durationDays?: number | null;
  quantity?: number | null;
  instructions?: string | null;
  confidence: number; // 0.0 to 1.0
}

@Injectable()
export class PrescriptionAiService {
  private readonly logger = new Logger(PrescriptionAiService.name);

  constructor(
    private coreAiService: CoreAIService,
    private ocrService: OcrService,
  ) {}

  /**
   * Performs analysis on raw text extracted from the prescription image
   * using the local AI to extract medicine names and scheduling metadata.
   */
  async extractMedicinesFromImage(
    imageBuffer: Buffer,
    mimeType: string,
  ): Promise<ExtractedOcrCandidate[]> {
    this.logger.log(
      'Starting local OCR + AI analysis for prescription image...',
    );

    // Save buffer to a temp file to run OCR
    const tempFileName = `temp_ai_ocr_${Date.now()}.png`;
    const tempPath = path.join(process.cwd(), 'uploads', tempFileName);
    let rawText = '';

    try {
      const uploadsDir = path.join(process.cwd(), 'uploads');
      if (!fs.existsSync(uploadsDir)) {
        fs.mkdirSync(uploadsDir, { recursive: true });
      }
      fs.writeFileSync(tempPath, imageBuffer);
      const ocrResult = await this.ocrService.extractText(tempPath, {
        documentType: 'prescription',
      });
      rawText = ocrResult.rawText || '';
    } catch (err) {
      this.logger.error(
        `Failed to extract text for local AI extraction: ${err.message}`,
      );
    } finally {
      if (fs.existsSync(tempPath)) {
        fs.unlinkSync(tempPath);
      }
    }

    const prompt = `
You are a medical assistant performing exact extraction of medications from raw OCR text of a prescription.
TASK:
Analyze the OCR text and extract prescribed medicines.

STRICT RULES:
1. NEVER guess or infer medicine names based on medical context, symptoms, or partial letters.
2. PRESERVE ORIGINAL SPELLING EXACTLY. Do not correct spelling mistakes or character recognition errors.
3. Do not complete incomplete words. If a word is completely illegible, ignore it.
4. IGNORE and EXCLUDE all doctor details, hospital/clinic headers, patient info, vital signs, diagnoses, and medical histories.
5. Return an empty array for 'medicines' ONLY if no medication names are present in the text.

OCR TEXT:
"""
${rawText}
"""

Return JSON in this format:
{
  "medicines": [
    {
      "medicineName": "",
      "dosage": "",
      "frequency": "",
      "timesOfDay": [],
      "durationDays": null,
      "quantity": null,
      "instructions": "",
      "confidence": 0.0
    }
  ]
}

Frequency mapping rules:
- OD or QD -> "DAILY"
- BD or BID -> "TWICE_DAILY"
- TDS or TID -> "THREE_TIMES_DAILY"
- QID -> "FOUR_TIMES_DAILY"
- PRN or SOS -> "AS_NEEDED"
- If frequency is not clearly written, return null.

Generating timesOfDay rules:
- If frequency is "DAILY", timesOfDay must be: ["08:00"]
- If frequency is "TWICE_DAILY", timesOfDay must be: ["08:00", "20:00"]
- If frequency is "THREE_TIMES_DAILY", timesOfDay must be: ["08:00", "14:00", "20:00"]
- If frequency is "FOUR_TIMES_DAILY", timesOfDay must be: ["08:00", "12:00", "16:00", "20:00"]
- If frequency is "AS_NEEDED" or null, timesOfDay must be: []

Never hallucinate. Preserve spelling exactly. Accuracy is key.
`;

    try {
      const parsed = await this.coreAiService.generateJSON<{
        medicines: ExtractedOcrCandidate[];
      }>(
        prompt,
        'You are an exact medical transcription parser. Output exact spellings.',
      );

      if (parsed && Array.isArray(parsed.medicines)) {
        return parsed.medicines.map((m: any) => ({
          medicineName: m.medicineName || '',
          dosage: m.dosage || null,
          frequency: m.frequency || null,
          timesOfDay: m.timesOfDay || [],
          durationDays:
            m.durationDays !== undefined && m.durationDays !== null
              ? Number(m.durationDays)
              : null,
          quantity:
            m.quantity !== undefined && m.quantity !== null
              ? Number(m.quantity)
              : null,
          instructions: m.instructions || null,
          confidence: typeof m.confidence === 'number' ? m.confidence : 0.8,
        }));
      }

      return [];
    } catch (error) {
      this.logger.error(`Local AI OCR analysis failed: ${error.message}`);
      throw error;
    }
  }
}
