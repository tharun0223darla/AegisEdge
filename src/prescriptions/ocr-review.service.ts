import { Injectable, Logger } from '@nestjs/common';
import { CoreAIService } from '../ai/core-ai.service';

export interface OcrReviewResult {
  status: 'VALID' | 'INVALID' | 'UNSURE';
  reason: string;
}

@Injectable()
export class OcrReviewService {
  private readonly logger = new Logger(OcrReviewService.name);

  constructor(private coreAiService: CoreAIService) {}

  /**
   * Evaluates whether a candidate medication is clinically plausible or represents noise.
   */
  async reviewPrescription(
    medicineName: string,
    dosage?: string | null,
    instructions?: string | null,
  ): Promise<OcrReviewResult> {
    this.logger.log(`OCR Critic Review requested for: "${medicineName}"`);
    try {
      const prompt = `
You are a senior physician and pharmacy reviewer.
Analyze the following extracted medication item:
- Name: "${medicineName}"
- Dosage: "${dosage || 'Not specified'}"
- Instructions: "${instructions || 'Not specified'}"

Determine:
1. Would a doctor realistically prescribe this? (Is this a real medication, active pharmaceutical ingredient, or closeness misspelling of one?)
2. If it is garbage text, noise, or template labels (e.g. "aa SexiA Date", "Sex: Male", "Reg No: 1234"), classify it as "INVALID".
3. If it is a real medicine (e.g. "Amoxicillin 500", "Pregamax M", "Dolo 650", "Rabeprazole"), classify it as "VALID".
4. If you are not completely sure due to severe ambiguity, classify it as "UNSURE".

Response format MUST be JSON:
{
  "status": "VALID", // must be "VALID", "INVALID", or "UNSURE"
  "reason": "Explain in one sentence."
}
`;

      const result = await this.coreAiService.generateJSON<OcrReviewResult>(
        prompt,
        'You are a strict pharmaceutical verification expert auditing OCR-extracted prescriptions for clinician credibility. Reject obvious garbage text, template variables, or patient demographics as INVALID.',
      );

      this.logger.log(`OCR Critic Review for "${medicineName}": ${JSON.stringify(result)}`);
      return result;
    } catch (error) {
      this.logger.error(`OCR Critic Review failed for "${medicineName}": ${error.message}`);
      return {
        status: 'UNSURE',
        reason: `Critic review failed: ${error.message}`,
      };
    }
  }
}
