import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { MedicineVerificationService } from './medicine-verification.service';
import { ConfidenceService } from './confidence.service';
import {
  VerificationStatus,
  ResolutionState,
  VerificationExecutionStatus,
} from '@prisma/client';
import { HandwritingNormalizerService } from './handwriting-normalizer.service';
import { CandidateGeneratorService } from './candidate-generator.service';
import {
  ProcessCandidatesDto,
  OcrEvidence,
  CandidateMention,
  CandidateCluster,
  CandidateEvidenceRef,
} from './interfaces';
import { createHash } from 'crypto';
import { ensureOcrEvidenceId, normalizeOcrText } from './ocr-evidence.util';

export interface VerificationBudgetSummary {
  maximumCalls: number;
  attemptedCalls: number;
  completedCalls: number;
  failedCalls: number;
  timedOutCalls: number;
  skippedDueToLimit: number;
  exhausted: boolean;
}

export interface IntelligentValidationResult {
  medicineName: string;
  brandName: string | null;
  genericName: string | null;
  strength: string | null;
  dosage: string | null;
  frequency: string | null;
  timesOfDay: string[];
  durationDays: number | null;
  quantity: number | null;
  instructions: string | null;
  confidenceScore: number; // 0.0 to 1.0
  verificationStatus: VerificationStatus;
  reasons: string[];
  verificationSource?: string | null;
  composition?: string | null;
  rawName?: string;
  candidateState: 'KNOWN' | 'UNKNOWN' | 'LOW_CONFIDENCE' | 'REJECTED';
  ocrConfidence: number;
  entityConfidence: number;
  validationConfidence: number;

  // Release 3 Corrective Audit additions
  resolutionState: ResolutionState;
  verificationExecutionStatus: VerificationExecutionStatus;
  verificationSkippedReason?: string | null;
  verificationPriority?: number;
  originalCandidateMentionId?: string | null;
  runIsPartial?: boolean;
  verificationBudgetSummary?: VerificationBudgetSummary;
}

@Injectable()
export class MedicineIntelligenceService {
  private readonly logger = new Logger(MedicineIntelligenceService.name);
  private readonly aiCallsTracker = new Map<string, number>();

  constructor(
    private prisma: PrismaService,
    private verificationService: MedicineVerificationService,
    private confidenceService: ConfidenceService,
    private normalizerService: HandwritingNormalizerService,
    private generatorService: CandidateGeneratorService,
  ) {}

  private calculateJaccardSimilarity(a: string, b: string): number {
    const setA = new Set(
      a
        .toLowerCase()
        .split(/[^a-z0-9]/)
        .filter(Boolean),
    );
    const setB = new Set(
      b
        .toLowerCase()
        .split(/[^a-z0-9]/)
        .filter(Boolean),
    );
    if (setA.size === 0 || setB.size === 0) return 0;
    const intersection = new Set([...setA].filter((x) => setB.has(x)));
    const union = new Set([...setA, ...setB]);
    return Math.round((intersection.size / union.size) * 100);
  }

  private validateEvidenceRef(
    ref: CandidateEvidenceRef,
    evidenceList: OcrEvidence[],
    candidateName: string,
  ): {
    status: 'VALID' | 'PARTIAL' | 'INVALID';
    textOverlapScore: number;
    reasons: string[];
  } {
    if (!evidenceList || evidenceList.length === 0) {
      return {
        status: 'INVALID',
        textOverlapScore: 0,
        reasons: ['Current-document OCR evidence is unavailable'],
      };
    }

    // Evidence references are identity based. A line number alone is not unique
    // across engines or preprocessing variants and must never validate a claim.
    const evidenceWithIds = evidenceList.map(ensureOcrEvidenceId);
    const ev = evidenceWithIds.find((e) => e.id === ref.evidenceId);

    if (!ev) {
      return {
        status: 'INVALID',
        textOverlapScore: 0,
        reasons: [`Evidence ID not found: ${ref.evidenceId}`],
      };
    }

    const evidenceText = ev.text || '';
    const normCandidate = normalizeOcrText(candidateName);
    const normEvidence = normalizeOcrText(evidenceText);

    if (ref.engine && ref.engine !== ev.engine) {
      return {
        status: 'INVALID',
        textOverlapScore: 0,
        reasons: ['Evidence engine provenance mismatch'],
      };
    }
    if (ref.variant && ref.variant !== ev.variant) {
      return {
        status: 'INVALID',
        textOverlapScore: 0,
        reasons: ['Evidence variant provenance mismatch'],
      };
    }
    if (ref.pageIndex !== undefined && ref.pageIndex !== (ev.pageIndex ?? 0)) {
      return {
        status: 'INVALID',
        textOverlapScore: 0,
        reasons: ['Evidence page provenance mismatch'],
      };
    }

    if (ref.charStart !== undefined && ref.charEnd !== undefined) {
      if (
        ref.charStart < 0 ||
        ref.charStart > ref.charEnd ||
        ref.charEnd > evidenceText.length
      ) {
        return {
          status: 'INVALID',
          textOverlapScore: 0,
          reasons: ['Character spans out of bounds'],
        };
      }
    }

    if (ref.pageIndex !== undefined && ref.pageIndex < 0) {
      return {
        status: 'INVALID',
        textOverlapScore: 0,
        reasons: ['Invalid page index'],
      };
    }
    if (ref.bbox) {
      const bboxValues = Array.isArray(ref.bbox)
        ? ref.bbox
        : Object.values(
            ref.bbox as unknown as Record<string, number>,
          );

      if (
        bboxValues.length !== 4 ||
        bboxValues.some((value) => !Number.isFinite(Number(value)))
      ) {
        return {
          status: 'INVALID',
          textOverlapScore: 0,
          reasons: ['Invalid bbox dimensions'],
        };
      }
    }

    let score = 0;
    if (
      normEvidence.includes(normCandidate) ||
      normCandidate.includes(normEvidence)
    ) {
      score = 100;
    } else {
      const editSim = this.getSimilarityScore(normCandidate, normEvidence);
      const tokenSim = this.calculateJaccardSimilarity(
        normCandidate,
        normEvidence,
      );
      score = Math.max(editSim, tokenSim);
    }

    let status: 'VALID' | 'PARTIAL' | 'INVALID' = 'INVALID';
    const reasons: string[] = [];

    if (score >= 80) {
      status = 'VALID';
    } else if (score >= 40) {
      status = 'PARTIAL';
      reasons.push(`Partial evidence match (score: ${score}%)`);
    } else {
      status = 'INVALID';
      reasons.push(`Low text overlap score: ${score}%`);
    }

    return { status, textOverlapScore: score, reasons };
  }

  private generateFingerprint(
    documentContentHash: string,
    cl: CandidateCluster,
    mentions: CandidateMention[],
  ): string {
    const primaryMention =
      mentions.find((m) => cl.mentionIds.includes(m.id)) || (cl as any);
    const pageNumber = primaryMention.evidenceRef?.pageIndex ?? 0;
    const normalizedBbox = (primaryMention.evidenceRef?.bbox || [])
      .map(Math.round)
      .join(',');
    const evidenceText = primaryMention.evidenceRef?.text || '';
    const evidenceTextHash = createHash('sha256')
      .update(evidenceText)
      .digest('hex');
    const charStart = primaryMention.evidenceRef?.charStart ?? 0;
    const charEnd = primaryMention.evidenceRef?.charEnd ?? 0;
    const normalizedName = cl.normalizedName;
    const normalizedStrength = (cl.dosage || '').toLowerCase().trim();
    const normalizedFrequency = (cl.frequency || '').toLowerCase().trim();
    const normalizedTiming = [...(cl.timesOfDay || [])].sort().join(',');

    const raw = `${documentContentHash}|${pageNumber}|${normalizedBbox}|${evidenceTextHash}|${charStart}|${charEnd}|${normalizedName}|${normalizedStrength}|${normalizedFrequency}|${normalizedTiming}`;
    return createHash('sha256').update(raw).digest('hex');
  }

  async processCandidates(
    dto: ProcessCandidatesDto,
  ): Promise<IntelligentValidationResult[]> {
    const { userId, generationResult, layoutConfidence = 100 } = dto;
    const clusters = generationResult.clusters || [];
    this.logger.log(
      `Beginning Medicine Intelligence processing for ${clusters.length} candidate cluster(s).`,
    );

    const runId = generationResult?.extractionRunId || 'default';
    const evidenceList = (dto as any).evidence || [];
    const ocrTextCombined = evidenceList.map((e) => e.text).join('\n') || '';
    const documentContentHash = createHash('sha256')
      .update(ocrTextCombined)
      .digest('hex');

    // Retrieve budget parameters
    const maxCalls = Number(process.env.MEDICINE_VERIFICATION_MAX_CALLS || 5);
    const aiTimeoutMs = Number(
      process.env.MEDICINE_VERIFICATION_TIMEOUT_MS || 15000,
    );

    // Fetch user's custom medicines for checking
    const userMeds = await this.prisma.medicine.findMany({
      where: { userId },
    });

    const evidenceValidationStats = { VALID: 0, PARTIAL: 0, INVALID: 0 };
    const evidenceValidationSamples: Array<Record<string, unknown>> = [];

    // Step 1: Pre-process details for sorting
    const processedClusters = await Promise.all(
      clusters.map(async (c) => {
        const rawName = c.primaryName || '';
        let cleanName = rawName
          .replace(/^(tab.|cap.|syp.|inj.|tab|cap|syp|inj)\s+/i, '')
          .trim();

        const strengthMatch = cleanName.match(
          /\b(\d+(?:\s*(?:mg|ml|mcg|g|ug))?)\b$/i,
        );
        let extractedStrength: string | null = null;
        if (strengthMatch) {
          extractedStrength = strengthMatch[1];
          cleanName = cleanName
            .substring(0, strengthMatch.index)
            .trim()
            .replace(/[-_]$/, '')
            .trim();
        }

        const normalizedClean = this.normalizerService.normalizeText(cleanName);

        const correction = await this.prisma.medicineCorrection.findFirst({
          where: {
            userId,
            rawExtractedName: { equals: cleanName, mode: 'insensitive' },
          },
        });

        const resolvedName = correction ? correction.correctedName : cleanName;

        const masterMatch = await this.prisma.medicineMaster.findFirst({
          where: { brandName: { equals: resolvedName, mode: 'insensitive' } },
        });

        const userMedMatch = userMeds.find(
          (m) =>
            m.name.toLowerCase() === resolvedName.toLowerCase() ||
            (m.brandName &&
              m.brandName.toLowerCase() === resolvedName.toLowerCase()),
        );

        const hasDbMatch = !!(masterMatch || userMedMatch || correction);

        // Perform evidence validation
        let validEvidenceCount = 0;
        for (const mid of c.mentionIds) {
          const mention = generationResult.mentions.find((m) => m.id === mid);
          if (mention && mention.evidenceRef) {
            const evidenceName = mention.canonicalName || mention.rawText;
            const valRes = this.validateEvidenceRef(
              mention.evidenceRef,
              evidenceList,
              evidenceName,
            );

            evidenceValidationStats[valRes.status]++;

            if (
              valRes.status !== 'VALID' &&
              evidenceValidationSamples.length < 12
            ) {
              const matchedEvidence = evidenceList
                .map(ensureOcrEvidenceId)
                .find(
                  (item) =>
                    item.id === mention.evidenceRef?.evidenceId,
                );

              evidenceValidationSamples.push({
                candidate: evidenceName,
                status: valRes.status,
                reasons: valRes.reasons,
                referencedEvidenceId: mention.evidenceRef.evidenceId,
                evidenceFound: !!matchedEvidence,
                refEngine: mention.evidenceRef.engine,
                evidenceEngine: matchedEvidence?.engine,
                refVariant: mention.evidenceRef.variant,
                evidenceVariant: matchedEvidence?.variant,
                refPageIndex: mention.evidenceRef.pageIndex,
                evidencePageIndex: matchedEvidence?.pageIndex,
                charStart: mention.evidenceRef.charStart,
                charEnd: mention.evidenceRef.charEnd,
                evidenceTextLength: matchedEvidence?.text?.length,
                evidenceText: matchedEvidence?.text?.slice(0, 120),
              });
            }
            // PARTIAL remains review evidence; it is not strong enough to satisfy
            // the anti-hallucination gate for automatic verification.
            if (valRes.status === 'VALID') {
              validEvidenceCount++;
            }
          }
        }

        const uniqueGeneratorsCount = new Set(c.generators).size;
        const hasStrengthDosage = !!(
          c.dosage ||
          extractedStrength ||
          masterMatch?.strength ||
          userMedMatch?.strength
        );
        const fingerprint = this.generateFingerprint(
          documentContentHash,
          c,
          generationResult.mentions,
        );

        return {
          cluster: c,
          rawName,
          cleanName,
          normalizedClean,
          extractedStrength,
          resolvedName,
          correction,
          masterMatch,
          userMedMatch,
          hasDbMatch,
          validEvidenceCount,
          uniqueGeneratorsCount,
          hasStrengthDosage,
          fingerprint,
        };
      }),
    );

    this.logger.warn(
      `Evidence validation diagnostics: ${JSON.stringify({
        evidenceCount: evidenceList.length,
        stats: evidenceValidationStats,
        samples: evidenceValidationSamples,
      })}`,
    );

    // Step 2: Deterministic multi-key prioritization sorting
    processedClusters.sort((a, b) => {
      // 1. Validated evidence count (descending)
      if (b.validEvidenceCount !== a.validEvidenceCount) {
        return b.validEvidenceCount - a.validEvidenceCount;
      }
      // 2. Count of unique generators (descending)
      if (b.uniqueGeneratorsCount !== a.uniqueGeneratorsCount) {
        return b.uniqueGeneratorsCount - a.uniqueGeneratorsCount;
      }
      // 3. Strong dictionary/alias match (descending)
      const aDb = a.hasDbMatch ? 1 : 0;
      const bDb = b.hasDbMatch ? 1 : 0;
      if (bDb !== aDb) {
        return bDb - aDb;
      }
      // 4. OCR confidence score (descending)
      if (b.cluster.maxEvidenceScore !== a.cluster.maxEvidenceScore) {
        return b.cluster.maxEvidenceScore - a.cluster.maxEvidenceScore;
      }
      // 5. Presence of strength/dosage context (descending)
      const aSd = a.hasStrengthDosage ? 1 : 0;
      const bSd = b.hasStrengthDosage ? 1 : 0;
      if (bSd !== aSd) {
        return bSd - aSd;
      }
      // 6. Stable tie-breaker fingerprint (ascending alphabetical)
      return a.fingerprint.localeCompare(b.fingerprint);
    });

    const budgetTracker = {
      maximumCalls: maxCalls,
      attemptedCalls: 0,
      completedCalls: 0,
      failedCalls: 0,
      timedOutCalls: 0,
      skippedDueToLimit: 0,
      exhausted: false,
    };

    const results: IntelligentValidationResult[] = [];

    // Step 3: Run validation and AI verification sequentially
    for (let idx = 0; idx < processedClusters.length; idx++) {
      const pc = processedClusters[idx];
      const c = pc.cluster;
      const resolvedName = pc.resolvedName;
      const masterMatch = pc.masterMatch;
      const userMedMatch = pc.userMedMatch;
      const correction = pc.correction;

      let resolutionState: ResolutionState = 'REVIEW';
      let verificationExecutionStatus: VerificationExecutionStatus =
        'NOT_ATTEMPTED';
      let verificationSkippedReason: string | null = null;
      let verificationPriority = idx + 1;

      // Check low-information
      const lettersOnly = resolvedName.replace(/[^a-zA-Z]/g, '');
      const hasVowel = /[aeiouy]/i.test(resolvedName);
      const isLowInfoSignal = lettersOnly.length < 3 || !hasVowel;

      // Medical acronym exceptions bypass list
      const commonAcronyms = ['HCTZ', 'NPH', 'ORS', 'B12', 'D3', 'MTX'];
      const isKnownAcronym = commonAcronyms.includes(
        resolvedName.toUpperCase(),
      );

      // Strong support context check
      const hasCurrentDocumentEvidence = pc.validEvidenceCount > 0;
      const hasStrongSupport =
        hasCurrentDocumentEvidence &&
        (pc.hasDbMatch ||
          pc.hasStrengthDosage ||
          pc.uniqueGeneratorsCount > 1 ||
          isKnownAcronym);

      // User history alone cannot verify a medicine in the current document.
      const hasAuthoritativeDbMatch = !!(masterMatch || correction);
      const needsVerification = !hasAuthoritativeDbMatch;
      let verification = {
        valid: false,
        brand: resolvedName,
        generic: '',
        strength: '',
        category: '',
      };

      if (!hasCurrentDocumentEvidence) {
        verificationExecutionStatus = 'NOT_ATTEMPTED';
        resolutionState = 'REJECTED';
        verificationSkippedReason =
          'Rejected by evidence gate: no valid current-document OCR evidence';
      } else if (needsVerification) {
        if (isLowInfoSignal && !hasStrongSupport) {
          verificationExecutionStatus = 'SKIPPED_LOW_INFORMATION';
          resolutionState = 'REVIEW';
          verificationSkippedReason =
            'Skipped: Low information candidate without strong context support';
        } else if (budgetTracker.attemptedCalls >= maxCalls) {
          budgetTracker.skippedDueToLimit++;
          budgetTracker.exhausted = true;
          verificationExecutionStatus = 'SKIPPED_CALL_LIMIT';
          resolutionState = 'REVIEW';
          verificationSkippedReason =
            'Skipped: AI verification call budget exhausted';
        } else {
          // Attempt verification
          budgetTracker.attemptedCalls++;
          try {
            const apiCall = this.verificationService.verifyMedicine(
              resolvedName,
              {
                strength: c.dosage || pc.extractedStrength,
                frequency: c.frequency || null,
                userId,
                documentId: generationResult.documentId,
                evidenceHash: documentContentHash,
              },
            );

            let verificationTimeout: NodeJS.Timeout | undefined;
            const timeoutPromise = new Promise<null>((_, reject) => {
              verificationTimeout = setTimeout(
                () => reject(new Error('TIMEOUT')),
                aiTimeoutMs,
              );
            });

            let result: Awaited<typeof apiCall> | null;
            try {
              result = await Promise.race([apiCall, timeoutPromise]);
            } finally {
              if (verificationTimeout) clearTimeout(verificationTimeout);
            }

            if (result) {
              verification = result;
              budgetTracker.completedCalls++;
              verificationExecutionStatus = 'COMPLETED';
              resolutionState = verification.valid ? 'VERIFIED' : 'REJECTED';
            } else {
              throw new Error('Malformed AI response');
            }
          } catch (err) {
            resolutionState = 'REVIEW';
            if (err.message === 'TIMEOUT') {
              budgetTracker.timedOutCalls++;
              verificationExecutionStatus = 'TIMEOUT';
              verificationSkippedReason = 'AI verification timed out';
            } else {
              budgetTracker.failedCalls++;
              verificationExecutionStatus = 'FAILED';
              verificationSkippedReason = `AI verification failed: ${err.message}`;
            }
          }
        }
      } else {
        // Authoritative database/correction support is only sufficient when the
        // medicine is also grounded in valid evidence from this document.
        verificationExecutionStatus = 'NOT_ATTEMPTED';
        resolutionState = hasCurrentDocumentEvidence ? 'VERIFIED' : 'REJECTED';
      }

      // Determine fields
      let brandName = resolvedName;
      let genericName =
        masterMatch?.genericName ||
        userMedMatch?.genericName ||
        verification.generic ||
        null;
      let strength =
        c.dosage ||
        pc.extractedStrength ||
        masterMatch?.strength ||
        userMedMatch?.strength ||
        verification.strength ||
        null;
      let verificationSource = 'RAW_OCR';

      if (userMedMatch) {
        verificationSource = 'USER_MEDICINES';
      } else if (masterMatch) {
        verificationSource = 'MEDICINE_MASTER';
      } else if (correction) {
        verificationSource = 'USER_CORRECTION';
      } else if (
        verificationExecutionStatus === 'COMPLETED' &&
        verification.valid
      ) {
        verificationSource = 'AI_VERIFICATION';
      }

      // Calculate confidence scores
      const ocrConfidenceScore = Math.round(c.maxEvidenceScore * 100);
      const entityConfidenceScore = Math.round(c.maxEvidenceScore * 100);
      const aiVerificationScore =
        verificationExecutionStatus === 'COMPLETED' && verification.valid
          ? 100
          : 0;

      let dbMatchScore = pc.hasDbMatch ? 100 : 0;
      let historyScore = 0;
      if (userMedMatch) {
        historyScore = 100;
      } else if (masterMatch) {
        historyScore = 100;
      } else if (correction) {
        historyScore =
          correction.count >= 5 ? 100 : correction.count >= 3 ? 70 : 50;
      }

      const validationConfidenceScore = Math.max(
        dbMatchScore,
        aiVerificationScore,
        historyScore,
      );

      const confidenceResult = this.confidenceService.calculateConfidence({
        ocrConfidence: ocrConfidenceScore,
        entityConfidence: entityConfidenceScore,
        validationConfidence: validationConfidenceScore,
        rawName: c.primaryName,
        brandName,
        genericName,
        hasComposition: !!genericName,
        hasUserCorrection: !!correction,
        hasGeminiTesseractAgreement: false,
        hasRecoverySuccess: false,
        historyScore,
      });

      // Map legacy verificationStatus
      let legacyStatus: VerificationStatus = VerificationStatus.NEEDS_REVIEW;
      if (resolutionState === 'VERIFIED') {
        legacyStatus = VerificationStatus.VERIFIED;
      } else if (resolutionState === 'REJECTED') {
        legacyStatus = VerificationStatus.NEEDS_REVIEW; // mapped to review
      } else {
        legacyStatus =
          confidenceResult.status === 'VERIFY_REQUIRED'
            ? VerificationStatus.VERIFY_REQUIRED
            : VerificationStatus.NEEDS_REVIEW;
      }

      // Fetch possible matches (suggestions) for review
      let possibleMatches: string[] = [];
      let candidateState: 'KNOWN' | 'UNKNOWN' | 'LOW_CONFIDENCE' | 'REJECTED' =
        'UNKNOWN';

      if (resolutionState === 'REJECTED') {
        candidateState = 'REJECTED';
      } else if (resolutionState === 'VERIFIED') {
        candidateState = 'KNOWN';
      } else if (confidenceResult.score < 60) {
        candidateState = 'LOW_CONFIDENCE';
      }

      if (candidateState === 'UNKNOWN' || candidateState === 'LOW_CONFIDENCE') {
        try {
          const suggestions = await this.generatorService.generateCandidates(
            pc.cleanName,
            pc.normalizedClean,
            userId,
          );
          possibleMatches = suggestions.map((s) => s.candidate).slice(0, 3);
        } catch (err) {
          // ignore
        }
      }

      const reasonsList = [...confidenceResult.reasons];
      if (possibleMatches.length > 0) {
        reasonsList.push('AMBIGUOUS:' + possibleMatches.join(','));
        reasonsList.push('Multiple possible medicines detected');
      }

      results.push({
        medicineName: resolvedName,
        brandName: brandName || resolvedName,
        genericName: genericName || null,
        strength: strength || null,
        dosage: c.dosage || null,
        frequency: c.frequency || null,
        timesOfDay: c.timesOfDay || [],
        durationDays: c.durationDays !== undefined ? c.durationDays : null,
        quantity: c.quantity !== undefined ? c.quantity : null,
        instructions: c.instructions || null,
        confidenceScore: confidenceResult.score / 100,
        verificationStatus: legacyStatus,
        reasons: reasonsList,
        verificationSource,
        composition: masterMatch?.composition || null,
        rawName: c.primaryName,
        candidateState,
        ocrConfidence: ocrConfidenceScore,
        entityConfidence: entityConfidenceScore,
        validationConfidence: validationConfidenceScore,

        // Release 3 Corrective Audit additions
        resolutionState,
        verificationExecutionStatus,
        verificationSkippedReason,
        verificationPriority,
        originalCandidateMentionId: c.mentionIds[0] || null,
      });
    }

    // Set runIsPartial and budget summary metadata on all items
    const runIsPartial = results.some(
      (r) =>
        r.verificationExecutionStatus === 'SKIPPED_CALL_LIMIT' ||
        r.verificationExecutionStatus === 'TIMEOUT' ||
        r.verificationExecutionStatus === 'FAILED',
    );

    for (const r of results) {
      r.runIsPartial = runIsPartial;
      r.verificationBudgetSummary = { ...budgetTracker };
    }

    return results;
  }

  private getLevenshteinDistance(a: string, b: string): number {
    const tmp: number[][] = [];
    for (let i = 0; i <= a.length; i++) {
      tmp[i] = [i];
    }
    for (let j = 0; j <= b.length; j++) {
      tmp[0][j] = j;
    }
    for (let i = 1; i <= a.length; i++) {
      for (let j = 1; j <= b.length; j++) {
        tmp[i][j] = Math.min(
          tmp[i - 1][j] + 1,
          tmp[i][j - 1] + 1,
          tmp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
        );
      }
    }
    return tmp[a.length][b.length];
  }

  private getSimilarityScore(a: string, b: string): number {
    const distance = this.getLevenshteinDistance(
      a.toLowerCase(),
      b.toLowerCase(),
    );
    const maxLen = Math.max(a.length, b.length);
    if (maxLen === 0) return 100;
    return Math.round((1 - distance / maxLen) * 100);
  }
}
