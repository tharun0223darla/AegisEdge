import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { access, mkdir, readFile } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';
import { OcrService } from '../ocr/ocr.service';
import { CandidateGenerationService } from './candidate-generation.service';
import {
  CandidateCluster,
  CandidateGenerationResult,
  CandidateMention,
} from './interfaces/candidate-generation.interface';
import { OcrEvidence } from './interfaces/ocr-evidence.interface';
import { ensureOcrEvidenceId } from './ocr-evidence.util';
import {
  PrescriptionRowEvidence,
  matchDosageFormAnchor,
  reconstructPrescriptionRows,
} from './prescription-layout.util';

export interface PrescriptionVisionRunInput {
  userId: string;
  prescriptionId: string;
  imagePath: string;
  onProgress?: (
    update: PrescriptionVisionProgressUpdate,
  ) => void | Promise<void>;
}

export interface PrescriptionVisionProgressUpdate {
  stage: string;
  progress: number;
  detail?: string;
}

interface PipelineProgressState {
  currentProgress: number;
  currentStage: string;
  totalRows: number | null;
  processedRows: number;
  fallbackRows: number | null;
  fallbackProcessedRows: number;
}

export interface PrescriptionVisionRow {
  row: number;
  column: number;
  ocr_anchor_text: string | null;
  ocr_confidence: number | null;
  medicine: {
    line_number: number | null;
    dosage_form: string | null;
    medicine_raw: string | null;
    formulation_suffix: string | null;
    strength: string | null;
    quantity: string | null;
    schedule_raw: string | null;
    morning: boolean | null;
    afternoon: boolean | null;
    evening: boolean | null;
    exact_time: string | null;
    food_timing: string | null;
  };
  field_status: Record<string, 'candidate' | 'uncertain' | 'absent'>;
  readable_candidate: boolean;
  review_required: true;
  uncertain_fields: string[];
  evidence: {
    name_image: string | null;
    context_image: string | null;
  };
}

export interface PrescriptionVisionPayload {
  status: 'human_review_required';
  auto_confirmed_count: 0;
  row_count: number;
  rows: PrescriptionVisionRow[];
  pipeline?: {
    outputDirectory: string;
    stdout: string;
  };
}

@Injectable()
export class PrescriptionVisionService {
  private readonly logger = new Logger(PrescriptionVisionService.name);

  private readonly pythonExecutable =
    process.env.PRESCRIPTION_VISION_PYTHON ||
    resolve(process.cwd(), 'ocr-service', '.venv', 'Scripts', 'python.exe');

  private readonly pipelineScript =
    process.env.PRESCRIPTION_VISION_SCRIPT ||
    resolve(process.cwd(), 'ocr-service', 'prescription_vision_pipeline.py');

  private readonly outputRoot =
    process.env.PRESCRIPTION_VISION_OUTPUT_DIR ||
    resolve(process.cwd(), 'uploads', 'vision-results');

  private readonly timeoutMs = Number(
    process.env.PRESCRIPTION_VISION_TIMEOUT_MS || 3_600_000,
  );

  private readonly mode = (
    process.env.PRESCRIPTION_VISION_MODE || 'auto'
  ).toLowerCase();

  constructor(
    private readonly ocrService: OcrService,
    private readonly candidateGeneration: CandidateGenerationService,
  ) {}

  async run(
    input: PrescriptionVisionRunInput,
  ): Promise<PrescriptionVisionPayload> {
    if (!input.prescriptionId?.trim()) {
      throw new BadRequestException('Prescription ID is required.');
    }

    const absoluteImagePath = isAbsolute(input.imagePath)
      ? input.imagePath
      : resolve(process.cwd(), input.imagePath);

    await this.assertFileExists(
      absoluteImagePath,
      'Prescription image was not found.',
    );

    const localPipelineAvailable =
      (await this.fileExists(this.pythonExecutable)) &&
      (await this.fileExists(this.pipelineScript));
    if (
      this.mode === 'sidecar' ||
      (this.mode === 'auto' && !localPipelineAvailable)
    ) {
      return this.runPortableReviewPipeline(input, absoluteImagePath);
    }
    if (!localPipelineAvailable) {
      throw new InternalServerErrorException(
        'Local prescription vision pipeline is unavailable.',
      );
    }

    const outputDirectory = join(this.outputRoot, input.prescriptionId);

    await mkdir(this.outputRoot, { recursive: true });

    this.logger.log(
      `Starting local prescription vision pipeline for ${input.prescriptionId}`,
    );

    const processResult = await this.executePipeline(
      absoluteImagePath,
      outputDirectory,
      input.onProgress,
    );

    const payloadPath = join(outputDirectory, 'safe-review-payload.json');

    let payload: PrescriptionVisionPayload;

    try {
      const contents = await readFile(payloadPath, 'utf8');
      payload = JSON.parse(contents) as PrescriptionVisionPayload;
    } catch (error) {
      this.logger.error(
        `Could not read pipeline payload for ${input.prescriptionId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );

      throw new InternalServerErrorException(
        'Prescription extraction finished without a valid review payload.',
      );
    }

    this.validatePayload(payload);

    this.logger.log(
      `Prescription vision pipeline completed for ${input.prescriptionId}: ` +
        `${payload.row_count} row(s), all requiring human review`,
    );

    return {
      ...payload,
      rows: payload.rows.map((row) => ({
        ...row,
        review_required: true,
      })),
      pipeline: {
        outputDirectory,
        stdout: processResult.stdout,
      },
    };
  }

  private async assertFileExists(path: string, message: string): Promise<void> {
    try {
      await access(path);
    } catch {
      throw new InternalServerErrorException(message);
    }
  }

  private executePipeline(
    imagePath: string,
    outputDirectory: string,
    onProgress?: (
      update: PrescriptionVisionProgressUpdate,
    ) => void | Promise<void>,
  ): Promise<{ stdout: string; stderr: string }> {
    return new Promise((resolvePromise, rejectPromise) => {
      const child = spawn(
        this.pythonExecutable,
        [
          '-u',
          this.pipelineScript,
          '--image',
          imagePath,
          '--output',
          outputDirectory,
        ],
        {
          cwd: process.cwd(),
          windowsHide: true,
          shell: false,
          env: {
            ...process.env,
            PYTHONUTF8: '1',
            PYTHONIOENCODING: 'utf-8',
            PYTHONUNBUFFERED: '1',
            PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK: 'True',
          },
        },
      );

      let stdout = '';
      let stderr = '';
      let settled = false;
      let stdoutLineBuffer = '';
      const reportProgress = this.createPipelineProgressReporter(onProgress);

      const timeout = setTimeout(() => {
        if (settled) {
          return;
        }

        settled = true;
        child.kill();

        rejectPromise(
          new InternalServerErrorException(
            'Prescription extraction timed out. Human review is required.',
          ),
        );
      }, this.timeoutMs);

      child.stdout.setEncoding('utf8');
      child.stderr.setEncoding('utf8');

      child.stdout.on('data', (chunk: string) => {
        stdout += chunk;
        stdoutLineBuffer += chunk;

        const lines = stdoutLineBuffer.split(/\r?\n/);
        stdoutLineBuffer = lines.pop() ?? '';

        for (const line of lines) {
          reportProgress(line);
        }

        if (stdout.length > 2_000_000) {
          stdout = stdout.slice(-2_000_000);
        }
      });

      child.stderr.on('data', (chunk: string) => {
        stderr += chunk;

        if (stderr.length > 2_000_000) {
          stderr = stderr.slice(-2_000_000);
        }
      });

      child.on('error', (error) => {
        if (settled) {
          return;
        }

        settled = true;
        clearTimeout(timeout);

        this.logger.error(
          `Could not start prescription vision pipeline: ${error.message}`,
        );

        rejectPromise(
          new InternalServerErrorException(
            'Could not start the prescription extraction service.',
          ),
        );
      });

      child.on('close', (exitCode) => {
        if (settled) {
          return;
        }

        settled = true;
        clearTimeout(timeout);

        if (exitCode !== 0) {
          this.logger.error(
            `Prescription vision pipeline exited with code ${exitCode}. ` +
              `stderr: ${stderr.slice(-4000)}`,
          );

          rejectPromise(
            new InternalServerErrorException(
              'Prescription extraction failed. No medicine was confirmed.',
            ),
          );
          return;
        }

        resolvePromise({ stdout, stderr });
      });
    });
  }

  private validatePayload(payload: PrescriptionVisionPayload): void {
    if (
      !payload ||
      payload.status !== 'human_review_required' ||
      payload.auto_confirmed_count !== 0 ||
      !Array.isArray(payload.rows)
    ) {
      throw new InternalServerErrorException(
        'Prescription extraction returned an unsafe or malformed payload.',
      );
    }

    if (payload.row_count !== payload.rows.length) {
      throw new InternalServerErrorException(
        'Prescription extraction row count is inconsistent.',
      );
    }

    for (const row of payload.rows) {
      if (row.review_required !== true) {
        throw new InternalServerErrorException(
          'Prescription extraction attempted to bypass human review.',
        );
      }
    }
  }

  private async fileExists(path: string): Promise<boolean> {
    try {
      await access(path);
      return true;
    } catch {
      return false;
    }
  }

  private async runPortableReviewPipeline(
    input: PrescriptionVisionRunInput,
    imagePath: string,
  ): Promise<PrescriptionVisionPayload> {
    await input.onProgress?.({
      stage: 'reading_prescription',
      progress: 25,
      detail: 'Reading prescription with the portable OCR service.',
    });

    const ocr = await this.ocrService.extractText(imagePath, {
      documentType: 'prescription',
    });
    if (!ocr.success || !ocr.rawText || !ocr.lines?.length) {
      this.logger.warn(
        `Portable prescription OCR returned no safe text for ${input.prescriptionId}: ` +
          `${ocr.fallbackReason ?? 'no_result'}`,
      );
      return this.emptyReviewPayload(
        `server-ocr:no-result:${ocr.fallbackReason ?? 'unknown'}`,
      );
    }

    await input.onProgress?.({
      stage: 'generating_candidates',
      progress: 65,
      detail: 'Comparing OCR evidence with the medicine database.',
    });

    const rawEvidence = ocr.lines.map((line, index) => {
      const bbox = this.flattenBbox(line.bbox);
      return ensureOcrEvidenceId({
        text: line.text,
        confidence: Math.round(line.confidence * 100),
        lineNumber: index + 1,
        bbox,
        engine: 'paddleocr',
        variant: ocr.selectedVariant ?? 'server',
        sourceImage: 'uploaded-prescription',
      } satisfies OcrEvidence);
    });
    const reconstructedRows = reconstructPrescriptionRows(rawEvidence);
    const anchoredEvidence = reconstructedRows.map((row) => row.evidence);
    const fallbackEvidence =
      anchoredEvidence.length === 0
        ? rawEvidence.filter((item) => this.isFallbackEvidenceEligible(item))
        : [];
    const evidence =
      anchoredEvidence.length > 0 ? anchoredEvidence : fallbackEvidence;
    if (evidence.length === 0) {
      this.logger.warn(
        `Portable prescription OCR found text but no eligible medicine rows for ${input.prescriptionId}.`,
      );
      return this.emptyReviewPayload(
        `server-ocr:no-medicine-rows:${ocr.modelVersion ?? 'unknown'}`,
      );
    }

    this.logger.log(
      `Portable prescription layout retained ${anchoredEvidence.length} anchored ` +
        `and ${fallbackEvidence.length} fallback row(s) ` +
        `from ${rawEvidence.length} OCR line(s) for ${input.prescriptionId}.`,
    );
    const extractionRunId = `portable-${randomUUID()}`;
    const context = await this.candidateGeneration.createRunContext(
      input.userId,
      input.prescriptionId,
      extractionRunId,
    );
    const generated = await this.candidateGeneration.generateAllCandidates(
      evidence,
      context,
      ocr.selectedVariant ?? 'server',
    );
    const rows = (
      reconstructedRows.length > 0
        ? reconstructedRows.map((row, index) =>
            this.toPortableReviewRow(row, generated, index),
          )
        : fallbackEvidence.map((item, index) =>
            this.toDatabaseBackedFallbackRow(item, generated, index),
          )
    )
      .filter((row): row is PrescriptionVisionRow => row !== null)
      .map((row, index) => ({ ...row, row: index + 1 }));

    const payload: PrescriptionVisionPayload = {
      status: 'human_review_required',
      auto_confirmed_count: 0,
      row_count: rows.length,
      rows,
      pipeline: {
        outputDirectory: '',
        stdout: `server-ocr:${ocr.modelVersion ?? ocr.engine ?? 'unknown'}`,
      },
    };
    this.validatePayload(payload);
    return payload;
  }

  private toPortableReviewRow(
    rowEvidence: PrescriptionRowEvidence,
    generated: CandidateGenerationResult,
    index: number,
  ): PrescriptionVisionRow | null {
    const evidenceId = rowEvidence.evidence.id!;
    const cluster = this.selectBestClusterForEvidence(generated, evidenceId);
    if (!cluster || this.isRejectedMedicineName(cluster.primaryName)) {
      return this.toOcrOnlyAnchoredReviewRow(rowEvidence, index);
    }

    const mentions = cluster.mentionIds
      .map((id) => generated.mentions.find((mention) => mention.id === id))
      .filter((mention): mention is CandidateMention => !!mention);
    const support = this.strongestCandidateSupport(mentions);
    const medicineName = this.preferredCandidateName(
      mentions,
      cluster.primaryName,
    );
    const confidence = this.toPercent(cluster.maxEvidenceScore);
    const schedule = this.extractScheduleDetails(
      rowEvidence.evidence.text,
      cluster,
    );
    const medicineCertain =
      (support.method === 'exact' || support.method === 'alias') &&
      confidence >= 70;
    const readableCandidate =
      (support.method === 'exact' ||
        support.method === 'alias' ||
        (support.method === 'fuzzy' && support.similarity >= 0.78)) &&
      confidence >= 55;

    return {
      row: index + 1,
      column: 1,
      ocr_anchor_text: rowEvidence.evidence.text,
      ocr_confidence: confidence,
      medicine: {
        line_number: rowEvidence.evidence.lineNumber ?? null,
        dosage_form: rowEvidence.dosageForm,
        medicine_raw: medicineName || null,
        formulation_suffix: null,
        strength: cluster.dosage ?? null,
        quantity:
          cluster.quantity === null || cluster.quantity === undefined
            ? null
            : String(cluster.quantity),
        schedule_raw: schedule.raw,
        morning: schedule.morning,
        afternoon: schedule.afternoon,
        evening: schedule.evening,
        exact_time: null,
        food_timing: schedule.foodTiming,
      },
      field_status: {
        medicine_raw: medicineCertain ? 'candidate' : 'uncertain',
        strength: cluster.dosage ? 'candidate' : 'absent',
        schedule_raw: schedule.raw ? 'uncertain' : 'absent',
      },
      readable_candidate: readableCandidate,
      review_required: true,
      uncertain_fields: [
        ...(!medicineCertain ? ['medicine_raw'] : []),
        ...(schedule.raw ? ['schedule_raw'] : []),
      ],
      evidence: {
        name_image: null,
        context_image: null,
      },
    };
  }

  private toOcrOnlyAnchoredReviewRow(
    rowEvidence: PrescriptionRowEvidence,
    index: number,
  ): PrescriptionVisionRow | null {
    const medicineName = this.extractAnchoredMedicineText(rowEvidence);
    if (!medicineName || this.isRejectedMedicineName(medicineName)) {
      return null;
    }
    const schedule = this.extractScheduleDetails(rowEvidence.evidence.text);

    return {
      row: index + 1,
      column: 1,
      ocr_anchor_text: rowEvidence.evidence.text,
      ocr_confidence: this.toPercent(rowEvidence.evidence.confidence),
      medicine: {
        line_number: rowEvidence.evidence.lineNumber ?? null,
        dosage_form: rowEvidence.dosageForm,
        medicine_raw: medicineName,
        formulation_suffix: null,
        strength: null,
        quantity: null,
        schedule_raw: schedule.raw,
        morning: schedule.morning,
        afternoon: schedule.afternoon,
        evening: schedule.evening,
        exact_time: null,
        food_timing: schedule.foodTiming,
      },
      field_status: {
        medicine_raw: 'uncertain',
        strength: 'absent',
        schedule_raw: schedule.raw ? 'uncertain' : 'absent',
      },
      readable_candidate: false,
      review_required: true,
      uncertain_fields: [
        'medicine_raw',
        ...(schedule.raw ? ['schedule_raw'] : []),
      ],
      evidence: { name_image: null, context_image: null },
    };
  }

  private toDatabaseBackedFallbackRow(
    evidence: OcrEvidence,
    generated: CandidateGenerationResult,
    index: number,
  ): PrescriptionVisionRow | null {
    const cluster = this.selectBestClusterForEvidence(generated, evidence.id!);
    if (!cluster || this.isRejectedMedicineName(cluster.primaryName)) {
      return null;
    }
    const mentions = cluster.mentionIds
      .map((id) => generated.mentions.find((mention) => mention.id === id))
      .filter((mention): mention is CandidateMention => !!mention);
    const support = this.strongestCandidateSupport(mentions);
    const stronglyDatabaseBacked =
      support.method === 'exact' ||
      support.method === 'alias' ||
      (support.method === 'fuzzy' && support.similarity >= 0.82);
    if (!stronglyDatabaseBacked) return null;

    const medicineName = this.preferredCandidateName(
      mentions,
      cluster.primaryName,
    );
    const confidence = this.toPercent(cluster.maxEvidenceScore);
    const schedule = this.extractScheduleDetails(evidence.text, cluster);
    const medicineCertain =
      (support.method === 'exact' || support.method === 'alias') &&
      confidence >= 70;

    return {
      row: index + 1,
      column: 1,
      ocr_anchor_text: evidence.text,
      ocr_confidence: confidence,
      medicine: {
        line_number: evidence.lineNumber ?? null,
        dosage_form: null,
        medicine_raw: medicineName,
        formulation_suffix: null,
        strength: cluster.dosage ?? null,
        quantity:
          cluster.quantity === null || cluster.quantity === undefined
            ? null
            : String(cluster.quantity),
        schedule_raw: schedule.raw,
        morning: schedule.morning,
        afternoon: schedule.afternoon,
        evening: schedule.evening,
        exact_time: null,
        food_timing: schedule.foodTiming,
      },
      field_status: {
        medicine_raw: medicineCertain ? 'candidate' : 'uncertain',
        strength: cluster.dosage ? 'candidate' : 'absent',
        schedule_raw: schedule.raw ? 'uncertain' : 'absent',
      },
      readable_candidate:
        confidence >= 55 &&
        (support.method === 'exact' ||
          support.method === 'alias' ||
          (support.method === 'fuzzy' && support.similarity >= 0.9)),
      review_required: true,
      uncertain_fields: [
        ...(!medicineCertain ? ['medicine_raw'] : []),
        ...(schedule.raw ? ['schedule_raw'] : []),
      ],
      evidence: { name_image: null, context_image: null },
    };
  }

  private extractAnchoredMedicineText(
    rowEvidence: PrescriptionRowEvidence,
  ): string | null {
    const match =
      matchDosageFormAnchor(rowEvidence.anchorText) ??
      matchDosageFormAnchor(rowEvidence.evidence.text);
    if (!match) return null;
    const medicineText = match.normalizedText
      .replace(/^\S+\s+/u, '')
      .replace(/\s+\d+(?:\.\d+)?\s*(?:mcg|ug|mg|g|ml|iu|units?)\b.*$/iu, '')
      .replace(/\s+\d+(?:\s*[-+]\s*\d+){1,3}.*$/u, '')
      .trim();
    return /[\p{L}]{3}/u.test(medicineText) ? medicineText : null;
  }

  private isFallbackEvidenceEligible(evidence: OcrEvidence): boolean {
    const text = evidence.text.trim();
    const letters = text.replace(/[^\p{L}]/gu, '');
    if (letters.length < 4 || this.toPercent(evidence.confidence) < 25) {
      return false;
    }
    return !/\b(?:patient|doctor|physician|hospital|address|advice|diagnosis|signature|date|age|sex|gender|phone|lic(?:ence)?|registration|exercise|physiotherapy|blood pressure|pulse|temperature)\b/i.test(
      text,
    );
  }

  private selectBestClusterForEvidence(
    generated: CandidateGenerationResult,
    evidenceId: string,
  ): CandidateCluster | null {
    const mentionsById = new Map(
      generated.mentions.map((mention) => [mention.id, mention]),
    );
    const candidates = generated.clusters.filter(
      (cluster) =>
        cluster.evidenceIds.includes(evidenceId) &&
        !this.isRejectedMedicineName(cluster.primaryName),
    );
    return (
      candidates
        .map((cluster) => ({
          cluster,
          score: this.scoreCluster(
            cluster,
            cluster.mentionIds
              .map((id) => mentionsById.get(id))
              .filter((mention): mention is CandidateMention => !!mention),
          ),
        }))
        .sort(
          (left, right) =>
            right.score - left.score ||
            right.cluster.primaryName.length - left.cluster.primaryName.length,
        )[0]?.cluster ?? null
    );
  }

  private scoreCluster(
    cluster: CandidateCluster,
    mentions: CandidateMention[],
  ): number {
    const support = this.strongestCandidateSupport(mentions);
    const methodScore: Record<string, number> = {
      alias: 520,
      exact: 500,
      llm: 440,
      fuzzy: 380,
      prefix: 320,
      regex: 240,
      unknown: 0,
    };
    return (
      (methodScore[support.method] ?? 0) +
      support.similarity * 100 +
      this.toPercent(cluster.maxEvidenceScore) +
      Math.min(cluster.primaryName.length, 30)
    );
  }

  private strongestCandidateSupport(mentions: CandidateMention[]): {
    method: string;
    similarity: number;
  } {
    const rank: Record<string, number> = {
      alias: 6,
      exact: 5,
      llm: 4,
      fuzzy: 3,
      prefix: 2,
      regex: 1,
      unknown: 0,
    };
    return (
      mentions
        .map((mention) => ({
          method:
            mention.sourceGenerator === 'llm'
              ? 'llm'
              : mention.sourceGenerator === 'regex'
                ? 'regex'
                : mention.matchDetails?.method || 'unknown',
          similarity: Number(mention.matchDetails?.similarity ?? 0),
        }))
        .sort(
          (left, right) =>
            (rank[right.method] ?? 0) - (rank[left.method] ?? 0) ||
            right.similarity - left.similarity,
        )[0] ?? { method: 'unknown', similarity: 0 }
    );
  }

  private preferredCandidateName(
    mentions: CandidateMention[],
    fallback: string,
  ): string {
    const supported = mentions
      .map((mention) => ({
        name: mention.canonicalName?.trim(),
        method:
          mention.sourceGenerator === 'llm'
            ? 'llm'
            : mention.sourceGenerator === 'regex'
              ? 'regex'
              : mention.matchDetails?.method || 'unknown',
        similarity: Number(mention.matchDetails?.similarity ?? 0),
      }))
      .filter(
        (candidate) =>
          !!candidate.name &&
          (candidate.method === 'exact' ||
            candidate.method === 'alias' ||
            (candidate.method === 'fuzzy' && candidate.similarity >= 0.78)),
      )
      .sort((left, right) => {
        const rank: Record<string, number> = { alias: 3, exact: 2, fuzzy: 1 };
        return (
          (rank[right.method] ?? 0) - (rank[left.method] ?? 0) ||
          right.similarity - left.similarity
        );
      });
    return supported[0]?.name || fallback;
  }

  private extractScheduleDetails(
    text: string,
    cluster?: Pick<CandidateCluster, 'frequency' | 'instructions'>,
  ): {
    raw: string | null;
    morning: boolean | null;
    afternoon: boolean | null;
    evening: boolean | null;
    foodTiming: string | null;
  } {
    const dosePattern =
      /(?:^|\s)(\d+)\s*[-+]\s*(\d+)\s*[-+]\s*(\d+)(?:\s|$)/.exec(text);
    const foodMatch =
      /\b(before|after|with)\s+(food|meal|breakfast|lunch|dinner)s?\b/i.exec(
        text,
      );
    const wordFrequency =
      /\b(?:od|bd|bid|tds|tid|qid|sos|prn|hs|daily|weekly|twice(?:\s+daily)?|thrice(?:\s+daily)?)\b/i.exec(
        text,
      )?.[0] ?? null;
    const duration =
      /\b(?:for|x)\s*\d+\s*(?:days?|weeks?|months?)\b/i.exec(text)?.[0] ?? null;
    const raw = [
      dosePattern?.[0]?.trim(),
      wordFrequency,
      foodMatch?.[0],
      duration,
      cluster?.frequency === 'CUSTOM' && dosePattern
        ? null
        : cluster?.frequency,
      cluster?.instructions,
    ]
      .filter(Boolean)
      .filter((value, position, values) => values.indexOf(value) === position)
      .join(' | ');
    const foodTiming = foodMatch
      ? `${foodMatch[1].toUpperCase()}_${foodMatch[2]
          .replace(/s$/i, '')
          .toUpperCase()}`
      : null;
    return {
      raw: raw || null,
      morning: dosePattern ? Number(dosePattern[1]) > 0 : null,
      afternoon: dosePattern ? Number(dosePattern[2]) > 0 : null,
      evening: dosePattern ? Number(dosePattern[3]) > 0 : null,
      foodTiming,
    };
  }

  private isRejectedMedicineName(value: string): boolean {
    const normalized = value.toLocaleLowerCase().replace(/[^a-z0-9]/g, '');
    return new Set([
      'tab',
      'tablet',
      'cap',
      'capsule',
      'syp',
      'syrup',
      'inj',
      'injection',
      'after',
      'before',
      'food',
      'meal',
      'advice',
      'pain',
      'knee',
      'kneecap',
      'exercise',
      'physiotherapy',
    ]).has(normalized);
  }

  private toPercent(value: number): number {
    return Math.max(
      0,
      Math.min(100, value <= 1 ? Math.round(value * 100) : Math.round(value)),
    );
  }

  private emptyReviewPayload(stdout: string): PrescriptionVisionPayload {
    return {
      status: 'human_review_required',
      auto_confirmed_count: 0,
      row_count: 0,
      rows: [],
      pipeline: { outputDirectory: '', stdout },
    };
  }

  private flattenBbox(bbox?: number[][]): number[] {
    if (!bbox?.length) return [];
    const xs = bbox.map((point) => point[0]);
    const ys = bbox.map((point) => point[1]);
    return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
  }

  private createPipelineProgressReporter(
    onProgress?: (
      update: PrescriptionVisionProgressUpdate,
    ) => void | Promise<void>,
  ): (line: string) => void {
    const state: PipelineProgressState = {
      currentProgress: 10,
      currentStage: 'Starting vision pipeline',
      totalRows: null,
      processedRows: 0,
      fallbackRows: null,
      fallbackProcessedRows: 0,
    };

    return (line: string) => {
      const update = this.progressUpdateFromLine(line, state);

      if (!update || !onProgress) {
        return;
      }

      Promise.resolve(onProgress(update)).catch((error) => {
        this.logger.warn(
          `Could not persist vision progress update: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      });
    };
  }

  private progressUpdateFromLine(
    line: string,
    state: PipelineProgressState,
  ): PrescriptionVisionProgressUpdate | null {
    const text = line.trim();

    if (!text) {
      return null;
    }

    if (text.includes('STEP 1/3')) {
      return this.advanceProgress(state, 12, 'Detecting medicine rows', text);
    }

    if (text.includes('Loading local PaddleOCR models')) {
      return this.advanceProgress(state, 16, 'Loading OCR models', text);
    }

    if (text.includes('Reading prescription')) {
      return this.advanceProgress(
        state,
        24,
        'Reading prescription image',
        text,
      );
    }

    if (text.includes('FINAL MEDICINE NAME-CROP DETECTION COMPLETE')) {
      return this.advanceProgress(state, 34, 'Medicine rows detected', text);
    }

    const detectedRowsMatch = text.match(/Detected rows:\s*(\d+)/i);

    if (detectedRowsMatch) {
      state.totalRows = Number(detectedRowsMatch[1]);

      return this.advanceProgress(
        state,
        38,
        'Preparing medicine row crops',
        text,
      );
    }

    if (text.includes('STEP 2/3')) {
      return this.advanceProgress(state, 42, 'Reading medicine names', text);
    }

    const qwenRowsMatch = text.match(
      /Running row-level Qwen extraction for\s*(\d+)\s*row/i,
    );

    if (qwenRowsMatch) {
      state.totalRows = Number(qwenRowsMatch[1]);
      state.processedRows = 0;

      return this.advanceProgress(state, 45, 'Reading medicine names', text);
    }

    const batchMatch = text.match(
      /Processed and cached batch\s+\d+\s+with\s+(\d+)\s+row/i,
    );

    if (batchMatch) {
      state.processedRows += Number(batchMatch[1]);

      return this.advanceProgress(
        state,
        this.rowReadingProgress(state, 45, 84),
        'Reading medicine names',
        text,
      );
    }

    const fallbackMatch = text.match(
      /Running single-row fallback for\s*(\d+)\s*row/i,
    );

    if (fallbackMatch) {
      state.fallbackRows = Number(fallbackMatch[1]);
      state.fallbackProcessedRows = 0;

      return this.advanceProgress(state, 86, 'Retrying unclear rows', text);
    }

    if (text.match(/Processed and cached row\s+\d+/i)) {
      state.fallbackProcessedRows += 1;

      return this.advanceProgress(
        state,
        this.fallbackProgress(state),
        'Retrying unclear rows',
        text,
      );
    }

    if (text.includes('Qwen extraction produced')) {
      return this.advanceProgress(state, 92, 'Medicine names read', text);
    }

    if (text.includes('STEP 3/3')) {
      return this.advanceProgress(
        state,
        95,
        'Building review candidates',
        text,
      );
    }

    if (text.includes('PRESCRIPTION VISION PIPELINE COMPLETE')) {
      return this.advanceProgress(state, 98, 'Finalizing review', text);
    }

    return null;
  }

  private rowReadingProgress(
    state: PipelineProgressState,
    start: number,
    end: number,
  ): number {
    if (!state.totalRows || state.totalRows <= 0) {
      return start;
    }

    const ratio = Math.min(1, state.processedRows / state.totalRows);

    return start + (end - start) * ratio;
  }

  private fallbackProgress(state: PipelineProgressState): number {
    if (!state.fallbackRows || state.fallbackRows <= 0) {
      return 88;
    }

    const ratio = Math.min(1, state.fallbackProcessedRows / state.fallbackRows);

    return 86 + 5 * ratio;
  }

  private advanceProgress(
    state: PipelineProgressState,
    progress: number,
    stage: string,
    detail: string,
  ): PrescriptionVisionProgressUpdate | null {
    const nextProgress = Math.min(
      99,
      Math.max(state.currentProgress, Math.round(progress)),
    );

    if (
      nextProgress === state.currentProgress &&
      stage === state.currentStage
    ) {
      return null;
    }

    state.currentProgress = nextProgress;
    state.currentStage = stage;

    return {
      progress: nextProgress,
      stage,
      detail,
    };
  }
}
