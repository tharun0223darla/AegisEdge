import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'crypto';
import { RegexCandidateGenerator } from './regex-candidate-generator.service';
import { DictionaryCandidateGenerator } from './dictionary-candidate-generator.service';
import { LlmCandidateAdapter } from './llm-candidate-adapter.service';
import { CandidateClusteringService } from './candidate-clustering.service';
import {
  ExtractionService,
  StructuredMedicine,
} from '../extraction/extraction.service';
import { OcrEvidence } from './interfaces/ocr-evidence.interface';
import {
  CandidateGenerationContext,
  CandidateGenerationResult,
  CandidateMention,
  GeneratorExecution,
} from './interfaces/candidate-generation.interface';
import { ensureOcrEvidenceId, normalizeOcrText } from './ocr-evidence.util';

@Injectable()
export class CandidateGenerationService {
  private readonly logger = new Logger(CandidateGenerationService.name);

  constructor(
    private readonly regexGenerator: RegexCandidateGenerator,
    private readonly dictionaryGenerator: DictionaryCandidateGenerator,
    private readonly llmAdapter: LlmCandidateAdapter,
    private readonly clusteringService: CandidateClusteringService,
    private readonly extractionService: ExtractionService,
  ) {}

  async createRunContext(
    userId: string,
    documentId: string,
    extractionRunId: string,
  ): Promise<CandidateGenerationContext> {
    const dictionaryMetadata =
      await this.dictionaryGenerator.loadDictionaryMetadata(userId);
    return {
      extractionRunId,
      documentId,
      userId,
      dictionaryMetadata,
      llmLineCache: new Map<string, StructuredMedicine[]>(),
    };
  }

  async generateAllCandidates(
    rawEvidence: OcrEvidence[],
    context: CandidateGenerationContext,
    variantName = 'ORIGINAL',
  ): Promise<CandidateGenerationResult> {
    const runStartedAt = Date.now();
    const evidence = rawEvidence.map(ensureOcrEvidenceId);
    const executions: GeneratorExecution[] = [];
    let isPartial = false;
    const partialReasons: string[] = [];

    const runGeneratorIsolated = async (
      name: 'llm' | 'regex' | 'dictionary',
      timeoutMs: number,
      fn: () => Promise<CandidateMention[]>,
    ): Promise<CandidateMention[]> => {
      const startedAt = new Date().toISOString();
      const started = performance.now();
      let timeoutId: NodeJS.Timeout | undefined;
      let output: CandidateMention[] = [];
      let status: 'success' | 'partial' | 'failed' = 'success';
      let errorCode: string | undefined;
      let errorReason: string | undefined;

      try {
        const timeout = new Promise<never>((_, reject) => {
          timeoutId = setTimeout(
            () => reject(new Error(`${name.toUpperCase()}_TIMEOUT`)),
            timeoutMs,
          );
        });
        output = await Promise.race([fn(), timeout]);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        status = 'failed';
        errorCode = message.includes('TIMEOUT') ? 'TIMEOUT' : 'GENERATOR_ERROR';
        errorReason = this.safeError(message);
        isPartial = true;
        partialReasons.push(`${name}:${errorCode}`);
        this.logger.warn(`Candidate generator ${name} failed (${errorCode})`);
      } finally {
        if (timeoutId) clearTimeout(timeoutId);
        executions.push({
          generatorName: name,
          status,
          startTimestamp: startedAt,
          completionTimestamp: new Date().toISOString(),
          duration: Math.round(performance.now() - started),
          inputEvidenceCount: evidence.length,
          outputMentionCount: output.length,
          errorCode,
          errorReason,
        });
      }
      return output;
    };

    const llmTimeoutMs = this.readPositiveInt(
      'CANDIDATE_LLM_TIMEOUT_MS',
      30000,
    );
    const deterministicTimeoutMs = this.readPositiveInt(
      'CANDIDATE_DETERMINISTIC_TIMEOUT_MS',
      5000,
    );

    const [llmMentions, regexMentions, dictionaryMentions] = await Promise.all([
      runGeneratorIsolated('llm', llmTimeoutMs, () =>
        this.generateLlmMentions(evidence, context, variantName),
      ),
      runGeneratorIsolated('regex', deterministicTimeoutMs, () =>
        Promise.resolve(this.regexGenerator.generateCandidates(evidence)),
      ),
      runGeneratorIsolated('dictionary', deterministicTimeoutMs, () => {
        if (!context.dictionaryMetadata) {
          throw new Error('DICTIONARY_METADATA_MISSING');
        }
        return Promise.resolve(
          this.dictionaryGenerator.generateCandidates(
            evidence,
            context.dictionaryMetadata,
          ),
        );
      }),
    ]);

    // No generated mention is discarded here. Clusters only reference mentions.
    const mentions = [...llmMentions, ...regexMentions, ...dictionaryMentions];
    const clusters = this.clusteringService.cluster(mentions);

    this.logger.log(
      `Candidate generation ${context.extractionRunId}: ${mentions.length} mentions, ` +
        `${clusters.length} clusters, ${Date.now() - runStartedAt}ms`,
    );

    return {
      schemaVersion: '1.1.0-release3-hardened',
      extractionRunId: context.extractionRunId,
      documentId: context.documentId,
      mentions,
      clusters,
      executions,
      isPartial,
      partialReason: partialReasons.length
        ? partialReasons.join(';')
        : undefined,
    };
  }

  /**
   * Calls the LLM on a bounded number of ranked evidence chunks instead of once
   * per OCR line. This makes latency predictable while Regex and Dictionary
   * generators continue to cover every evidence item.
   */
  private async generateLlmMentions(
    evidence: OcrEvidence[],
    context: CandidateGenerationContext,
    variantName: string,
  ): Promise<CandidateMention[]> {
    if (!this.extractionService.isEnabled) return [];

    const maxLines = this.readPositiveInt('CANDIDATE_LLM_MAX_LINES', 48);
    const chunkSize = this.readPositiveInt('CANDIDATE_LLM_CHUNK_LINES', 12);
    const selected = this.selectEvidenceForLlm(evidence, maxLines);
    const medicines: StructuredMedicine[] = [];

    for (let offset = 0; offset < selected.length; offset += chunkSize) {
      const chunk = selected.slice(offset, offset + chunkSize);
      const chunkText = chunk
        .map((item) => item.text.trim())
        .filter(Boolean)
        .join('\n');
      if (!chunkText) continue;

      const cacheKey = createHash('sha256')
        .update(`${this.extractionService.constructor.name}|${chunkText}`)
        .digest('hex');
      const cached = context.llmLineCache?.get(cacheKey) as
        | StructuredMedicine[]
        | undefined;
      if (cached) {
        medicines.push(...cached);
        continue;
      }

      const avgConfidence =
        chunk.reduce((sum, item) => {
          const value =
            item.confidence > 1 ? item.confidence / 100 : item.confidence;
          return sum + Math.max(0, Math.min(1, value));
        }, 0) / Math.max(chunk.length, 1);

      const result = await this.extractionService.extract(
        chunkText,
        avgConfidence || 0.5,
      );
      const extracted = result.available ? result.medicines || [] : [];
      context.llmLineCache?.set(cacheKey, extracted);
      medicines.push(...extracted);
    }

    const unique = new Map<string, StructuredMedicine>();
    for (const medicine of medicines) {
      const key = [
        normalizeOcrText(medicine.medicineName),
        normalizeOcrText(medicine.sourceText || ''),
        normalizeOcrText(medicine.dosage || ''),
        medicine.frequency || '',
      ].join('|');
      if (!unique.has(key)) unique.set(key, medicine);
    }

    return this.llmAdapter.mapLlmToMentions(
      [...unique.values()],
      evidence,
      variantName,
    );
  }

  private selectEvidenceForLlm(
    evidence: OcrEvidence[],
    maxLines: number,
  ): OcrEvidence[] {
    const byText = new Map<string, OcrEvidence>();
    for (const item of evidence) {
      const normalized = normalizeOcrText(item.text);
      if (normalized.length < 3 || !/[a-z]/i.test(normalized)) continue;
      const current = byText.get(normalized);
      if (!current || item.confidence > current.confidence)
        byText.set(normalized, item);
    }

    const medicineCue =
      /\b(tab(?:let)?|cap(?:sule)?|syp|syrup|inj(?:ection)?|drops?|cream|ointment|inhaler|\d+(?:\.\d+)?\s*(?:mg|mcg|g|ml|iu|units?)|od|bd|tid|qid|sos|hs)\b/i;
    return [...byText.values()]
      .map((item) => ({
        item,
        score:
          (medicineCue.test(item.text) ? 1000 : 0) +
          Math.min(item.text.length, 160) +
          Math.max(0, Math.min(100, item.confidence)),
      }))
      .sort((a, b) => b.score - a.score || a.item.id!.localeCompare(b.item.id!))
      .slice(0, maxLines)
      .map((entry) => entry.item);
  }

  private readPositiveInt(name: string, fallback: number): number {
    const parsed = Number(process.env[name]);
    return Number.isFinite(parsed) && parsed > 0
      ? Math.floor(parsed)
      : fallback;
  }

  private safeError(message: string): string {
    // Do not leak OCR text or model prompts into generator execution metadata.
    return message.replace(/[\r\n]+/g, ' ').slice(0, 160);
  }
}
