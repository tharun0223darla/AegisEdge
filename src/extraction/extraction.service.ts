import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { DrugNormalizer } from './drug-normalizer';
import {
  ALLOWED_DOSAGE_UNITS,
  LlmExtractionSchema,
  type LlmMedicine,
} from './extraction.schema';

// Final structured medicine after LLM extraction + reconciliation +
// validation + normalization. confidenceScore is a composite per-medicine
// value (per-field confidence is exposed in `fieldConfidence`).
export interface StructuredMedicine {
  medicineName: string;
  brandName?: string;
  dosage?: string;
  frequency?: string;
  durationDays?: number;
  quantity?: number;
  instructions?: string;
  confidenceScore: number; // 0–1
  needsReview: boolean;
  sourceText?: string;
  fieldConfidence: Record<string, number>;
}

export interface ExtractionResult {
  available: boolean; // false => caller should use regex fallback
  medicines: StructuredMedicine[];
  model?: string;
  error?: string;
}

const SYSTEM_PROMPT = `You are a medical prescription text parser. You extract ONLY medicines that are explicitly present in the provided OCR text.

STRICT RULES:
- NEVER invent or guess a medicine name. If the text does not clearly contain a drug, return an empty list.
- If a field is not present in the text, set it to null. Do not infer it.
- "frequency" MUST be one of: DAILY, TWICE_DAILY, THREE_TIMES_DAILY, FOUR_TIMES_DAILY, WEEKLY, AS_NEEDED, CUSTOM, or null.
- "sourceText" MUST be the exact substring from the input that this medicine was taken from.
- Output STRICT JSON only, matching this shape:
{"medicines":[{"name":string|null,"brandName":string|null,"strength":{"value":number|string|null,"unit":string|null}|null,"frequency":string|null,"durationDays":number|null,"quantity":number|null,"instructions":string|null,"confidence":number,"sourceText":string|null}]}`;

@Injectable()
export class ExtractionService {
  private readonly logger = new Logger(ExtractionService.name);
  private readonly ollamaUrl = process.env.OLLAMA_URL?.trim();
  private readonly model = process.env.OLLAMA_MODEL?.trim() || 'mistral:7b-instruct';

  constructor(
    private readonly http: HttpService,
    private readonly normalizer: DrugNormalizer,
  ) {}

  get isEnabled(): boolean {
    return !!this.ollamaUrl;
  }

  // Extract structured medicines from OCR text via local Ollama.
  // ocrLineConfidence: optional 0–1 average OCR confidence used to cap
  // per-field confidence. Returns available:false on any failure so the
  // caller falls back to the regex heuristic.
  async extract(
    rawText: string,
    ocrLineConfidence = 0.6,
  ): Promise<ExtractionResult> {
    if (!this.isEnabled) {
      return { available: false, medicines: [] };
    }
    if (!rawText || rawText.trim().length === 0) {
      return { available: true, medicines: [], model: this.model };
    }

    let parsedJson: unknown;
    try {
      parsedJson = await this.callOllama(rawText);
    } catch (err) {
      this.logger.warn(
        `Ollama call failed; falling back to regex: ${(err as Error).message}`,
      );
      return { available: false, medicines: [], error: (err as Error).message };
    }

    // Validate against Zod. On invalid JSON, signal fallback.
    const validated = LlmExtractionSchema.safeParse(parsedJson);
    if (!validated.success) {
      this.logger.warn('Ollama returned JSON that failed schema validation');
      return { available: false, medicines: [], error: 'invalid_llm_json' };
    }

    const ocrLower = rawText.toLowerCase();
    const medicines: StructuredMedicine[] = [];

    for (const med of validated.data.medicines) {
      const structured = this.reconcileAndNormalize(
        med,
        ocrLower,
        ocrLineConfidence,
      );
      if (structured) medicines.push(structured);
    }

    this.logger.log(
      `Extraction complete — ${medicines.length} medicine(s) from ${validated.data.medicines.length} candidate(s)`,
    );
    return { available: true, medicines, model: this.model };
  }

  async extractLineByLine(
    rawText: string,
    ocrLineConfidence = 0.6,
  ): Promise<ExtractionResult> {
    if (!this.isEnabled) {
      return { available: false, medicines: [] };
    }
    if (!rawText || rawText.trim().length === 0) {
      return { available: true, medicines: [], model: this.model };
    }

    const lines = rawText.split('\n')
      .map(line => line.trim())
      .filter(line => {
        if (line.length < 3) return false;
        return /[a-zA-Z0-9]/.test(line);
      });

    if (lines.length === 0) {
      return { available: true, medicines: [], model: this.model };
    }

    this.logger.log(`Running line-by-line extraction for ${lines.length} lines.`);

    const allMedicines: StructuredMedicine[] = [];
    let lastError: string | undefined = undefined;

    for (const line of lines) {
      try {
        const lineResult = await this.extract(line, ocrLineConfidence);
        if (lineResult.available && lineResult.medicines) {
          allMedicines.push(...lineResult.medicines);
        } else if (lineResult.error) {
          lastError = lineResult.error;
        }
      } catch (err) {
        this.logger.warn(`Failed to extract line "${line}": ${err.message}`);
        lastError = err.message;
      }
    }

    // De-duplicate final medicines list by medicineName (case-insensitive)
    const seen = new Set<string>();
    const uniqueMedicines: StructuredMedicine[] = [];
    for (const med of allMedicines) {
      const lowerName = med.medicineName.toLowerCase();
      if (!seen.has(lowerName)) {
        seen.add(lowerName);
        uniqueMedicines.push(med);
      }
    }

    this.logger.log(`Line-by-line extraction complete: extracted ${uniqueMedicines.length} unique medicines.`);
    return {
      available: true,
      medicines: uniqueMedicines,
      model: this.model,
      error: lastError,
    };
  }

  // ── Ollama HTTP call (generate API, format:json) ────────────
  private async callOllama(rawText: string): Promise<unknown> {
    const url = `${this.ollamaUrl!.replace(/\/$/, '')}/api/generate`;
    const prompt = `${SYSTEM_PROMPT}\n\nOCR TEXT:\n"""\n${rawText}\n"""`;

    const { data } = await firstValueFrom(
      this.http.post(
        url,
        {
          model: this.model,
          prompt,
          stream: false,
          format: 'json',
          options: { temperature: 0 },
        },
        { timeout: 120000 },
      ),
    );

    // Ollama returns { response: "<json string>" }
    const responseText = data?.response ?? '';
    return JSON.parse(responseText);
  }

  // ── Reconciliation + validation + normalization for one medicine ──
  private reconcileAndNormalize(
    med: LlmMedicine,
    ocrLower: string,
    ocrLineConfidence: number,
  ): StructuredMedicine | null {
    const name = (med.name ?? '').trim();
    if (!name) return null;

    // 1. Anti-hallucination: the drug name (or its sourceText) must appear in
    //    the OCR text. Allow a fuzzy token match for OCR noise.
    const appears = this.appearsInOcr(name, med.sourceText, ocrLower);
    if (!appears.found) {
      this.logger.warn(
        `Dropping hallucinated medicine not found in OCR text: "${name}"`,
      );
      return null;
    }

    // 2. Offline normalization against the common-drugs list.
    const norm = this.normalizer.normalize(name);
    const medicineName = norm.matched ? norm.normalized : name;

    // 3. Dosage assembly + unit validation.
    const dosage = this.buildDosage(med);

    // 4. Per-field confidence = min(OCR conf, LLM field conf), downgraded
    //    when reconciliation or normalization is weak.
    const baseConf = Math.min(ocrLineConfidence, med.confidence ?? 0.5);
    const reconciliationFactor = appears.exact ? 1 : 0.8;
    const normalizationFactor = norm.matched ? 1 : 0.85;

    const nameConf = baseConf * reconciliationFactor * normalizationFactor;
    const fieldConfidence: Record<string, number> = {
      medicineName: round(nameConf),
      dosage: round(dosage ? baseConf : 0),
      frequency: round(med.frequency ? baseConf : 0),
      durationDays: round(med.durationDays ? baseConf : 0),
      quantity: round(med.quantity ? baseConf : 0),
    };

    const composite = round(
      mean(Object.values(fieldConfidence).filter((c) => c > 0)) || nameConf,
    );

    // Flag low-confidence or weakly-reconciled rows for mandatory review.
    const needsReview = composite < 0.6 || !appears.exact || !norm.matched;

    return {
      medicineName,
      brandName: med.brandName ?? undefined,
      dosage,
      frequency: med.frequency ?? undefined,
      durationDays: med.durationDays ?? undefined,
      quantity: med.quantity ?? undefined,
      instructions: med.instructions ?? undefined,
      confidenceScore: composite,
      needsReview,
      sourceText: med.sourceText ?? undefined,
      fieldConfidence,
    };
  }

  private appearsInOcr(
    name: string,
    sourceText: string | null | undefined,
    ocrLower: string,
  ): { found: boolean; exact: boolean } {
    const n = name.toLowerCase();
    if (ocrLower.includes(n)) return { found: true, exact: true };
    if (sourceText && ocrLower.includes(sourceText.toLowerCase().trim())) {
      return { found: true, exact: true };
    }
    // Fuzzy: any OCR token within edit-distance tolerance of the name.
    const tokens = ocrLower.split(/\s+/);
    for (const tok of tokens) {
      if (tok.length < 4) continue;
      if (this.closeEnough(n, tok)) return { found: true, exact: false };
    }
    return { found: false, exact: false };
  }

  private closeEnough(a: string, b: string): boolean {
    const maxLen = Math.max(a.length, b.length) || 1;
    let dist = 0;
    // Cheap bounded comparison: bail out early.
    if (Math.abs(a.length - b.length) > 2) return false;
    const len = Math.min(a.length, b.length);
    for (let i = 0; i < len; i++) if (a[i] !== b[i]) dist++;
    dist += Math.abs(a.length - b.length);
    return dist / maxLen <= 0.25;
  }

  private buildDosage(med: LlmMedicine): string | undefined {
    if (!med.strength || med.strength.value == null) return undefined;
    const value = String(med.strength.value).trim();
    const unit = (med.strength.unit ?? '').trim().toLowerCase();
    if (unit && !ALLOWED_DOSAGE_UNITS.includes(unit as never)) {
      // Implausible unit: keep the value, drop the bad unit.
      this.logger.warn(`Rejecting implausible dosage unit "${unit}"`);
      return value || undefined;
    }
    return unit ? `${value}${unit}` : value || undefined;
  }
}

function round(n: number): number {
  return Math.round(n * 1000) / 1000;
}
function mean(arr: number[]): number {
  return arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
}
