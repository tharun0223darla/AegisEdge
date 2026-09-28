import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { AuditAction, type Prisma } from '@prisma/client';
import { createReadStream, existsSync } from 'fs';
import { basename, extname, join } from 'path';
import { PrismaService } from '../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { CreateMedicineDto, MedSource } from './dto/create-medicine.dto';
import { UpdateMedicineDto } from './dto/update-medicine.dto';
import { MedicineResponseSerializer } from './medicine-response.serializer';
import { ResolveMedicineReviewDto } from './dto/resolve-medicine-review.dto';
import { AdminClinicalDetailsDto } from './dto/admin-clinical-details.dto';
import {
  SaltCanonicalizer,
  normalizeBaseIngredient,
} from './import/salt-canonicalizer';
import { packageIdentityCompatibility } from './capture/package-identity-compatibility';
import { MedicineResolverService } from './capture/medicine-resolver.service';
import { MedicineEnrichmentQueueService } from './enrichment/medicine-enrichment-queue.service';
import { TrustedWebSourceAssistService } from './web-sources/trusted-web-source-assist.service';
import { hasTrustedClinicalSource as hasTrustedClinicalSourceRefList } from './enrichment/trusted-clinical-sources';
import { PatientExplanationService } from './patient-explanations/patient-explanation.service';
import type { MedicineCandidate } from './capture/medicine-candidate';
import type { PackageImageCandidate } from './capture/package-image-capture.service';
import type { CurrentUserPayload } from '../common/decorators/current-user.decorator';
import { StripVerificationService } from './capture/strip-verification.service';
import { CdscoVerifierService } from './capture/cdsco-verifier.service';
import type { VerifyMedicineStripDto } from './dto/verify-medicine-strip.dto';
import { MedicationSafetyService } from '../medication-safety/medication-safety.service';
import { OcrFuzzyMatcher } from './capture/ocr-fuzzy-matcher';
import { OcrAliasCacheService } from './capture/ocr-alias-cache.service';

const ADMIN_CLINICAL_SOURCE_PROVIDERS = {
  ADMIN: { sourceType: 'ADMIN', provider: 'ADMIN' },
  WEB_ASSISTED: {
    sourceType: 'WEB_ASSISTED',
    provider: 'Admin verified web-source assist',
  },
  NFI_IPC: {
    sourceType: 'NFI_IPC',
    provider: 'Indian Pharmacopoeia Commission',
  },
  CDSCO: {
    sourceType: 'CDSCO',
    provider: 'Central Drugs Standard Control Organization',
  },
  DailyMed: {
    sourceType: 'DailyMed',
    provider: 'DailyMed / National Library of Medicine',
  },
  openFDA: { sourceType: 'openFDA', provider: 'openFDA drug label API' },
  MedlinePlus: { sourceType: 'MedlinePlus', provider: 'MedlinePlus Connect' },
} as const;
type MasterMatchReason = 'brand' | 'composition';
type CompositionMatchTier = 'exact' | 'strong' | 'contains';

interface MasterSearchContext {
  queryIsMolecule: boolean;
  reasons?: Set<MasterMatchReason>;
}

interface StripVerificationMaster {
  brandName: string | null;
  genericName: string | null;
  composition: string | null;
  strength: string | null;
  saltProfile: { displayName: string } | null;
}

@Injectable()
export class MedicinesService {
  private readonly logger = new Logger(MedicinesService.name);
  private readonly serializer = new MedicineResponseSerializer();
  private readonly canonicalizer = new SaltCanonicalizer();
  private readonly ocrFuzzy = new OcrFuzzyMatcher();

  constructor(
    private prisma: PrismaService,
    private auditLogs: AuditLogsService,
    private resolver: MedicineResolverService,
    @Optional() private enrichmentQueue?: MedicineEnrichmentQueueService,
    @Optional() private patientExplanation?: PatientExplanationService,
    @Optional() private webSourceAssist?: TrustedWebSourceAssistService,
    @Optional() private stripVerification?: StripVerificationService,
    @Optional() private medicationSafety?: MedicationSafetyService,
    @Optional() private ocrAliasCache?: OcrAliasCacheService,
    @Optional() private cdscoVerifier?: CdscoVerifierService,
  ) {}
  private saltProfileInclude() {
    return {
      include: {
        patientExplanations: {
          orderBy: [
            { language: 'asc' as const },
            { updatedAt: 'desc' as const },
          ],
        },
      },
    };
  }

  async create(userId: string, dto: CreateMedicineDto) {
    const { stockQuantity, medicineMasterId, medicinePackageId, ...rest } = dto;
    const selection = await this.resolveMedicineSelection(
      medicineMasterId,
      medicinePackageId,
      rest.source === MedSource.PACKAGE_IMAGE
        ? {
            brandName: rest.brandName ?? rest.name,
            composition: rest.genericName,
          }
        : undefined,
    );
    const captureReviewKey = selection.medicineMasterId
      ? null
      : this.buildReviewNormalizedKey({
          type: 'UNKNOWN_MANUAL',
          rawName: rest.name,
          source: rest.source ?? 'MANUAL',
          strength: rest.strength,
          form: rest.form,
        });

    const medicine = await this.prisma.medicine.create({
      data: {
        userId,
        ...rest,
        medicineMasterId: selection.medicineMasterId,
        medicinePackageId: selection.medicinePackageId,
        captureReviewKey,
        remainingQuantity:
          stockQuantity !== undefined ? stockQuantity : dto.remainingQuantity,
        totalQuantity:
          stockQuantity !== undefined ? stockQuantity : dto.totalQuantity,
      },
      include: {
        medicineMaster: {
          include: {
            saltProfile: this.saltProfileInclude(),
            packages: {
              where: { isDemo: false },
              orderBy: { createdAt: 'asc' },
            },
          },
        },
        medicinePackage: true,
      },
    });

    await this.enqueueReviewIfNeeded(userId, medicine);

    await this.auditLogs.log({
      userId,
      action: 'CREATED',
      entityType: 'Medicine',
      entityId: medicine.id,
      newValues: {
        name: medicine.name,
        form: medicine.form,
        strength: medicine.strength,
        medicineMasterId: medicine.medicineMasterId,
        medicinePackageId: medicine.medicinePackageId,
      },
    });

    await this.refreshMedicationSafety(userId);

    return this.serializer.mapMedicine(medicine);
  }

  async searchMaster(
    query: string,
    limit = 8,
    options: { enqueueEnrichment?: boolean } = {},
  ) {
    const q = query.trim();

    if (q.length < 2) {
      return [];
    }

    const normalized = this.normalizeMedicineName(q);
    const take = Math.max(1, Math.min(limit, 20));

    const rowsById = new Map<string, any>();
    const reasonsById = new Map<string, Set<MasterMatchReason>>();
    const addRows = (rows: any[], defaultReason: MasterMatchReason) => {
      for (const row of rows) {
        rowsById.set(row.id, row);
        const reasons = reasonsById.get(row.id) ?? new Set<MasterMatchReason>();
        const reason =
          defaultReason === 'brand' &&
          this.hasCompositionMatch(row, q, normalized)
            ? 'composition'
            : defaultReason;
        reasons.add(reason);
        reasonsById.set(row.id, reasons);
      }
    };

    // 1. Check Learned OCR Alias Cache (O(1) Instant Hit)
    const learnedAlias = this.ocrAliasCache?.lookup(q);
    if (learnedAlias) {
      const aliasMaster = await this.prisma.medicineMaster.findUnique({
        where: { id: learnedAlias.masterId },
        include: {
          saltProfile: this.saltProfileInclude(),
          packages: {
            where: { isDemo: false },
            orderBy: { createdAt: 'asc' },
          },
        },
      });
      if (aliasMaster && !aliasMaster.isArchived) {
        addRows([aliasMaster], 'brand');
      }
    }

    const [saltRows, primaryRows] = await Promise.all([
      this.findRowsBySaltProfileQuery(q, normalized, take),
      this.prisma.medicineMaster.findMany({
        where: this.buildMasterSearchWhere(q, normalized),
        include: {
          saltProfile: this.saltProfileInclude(),
          packages: {
            where: { isDemo: false },
            orderBy: { createdAt: 'asc' },
          },
        },
        take: Math.max(80, take * 12),
      }),
    ]);
    addRows(saltRows, 'composition');

    const queryIsMolecule = this.isRecognizedMoleculeQuery(
      q,
      normalized,
      saltRows,
    );

    addRows(primaryRows, 'brand');

    if (!queryIsMolecule && rowsById.size < take) {
      const fallbackRows = await this.findFallbackMasterRows(
        q,
        normalized,
        take,
      );
      addRows(fallbackRows, 'brand');
    }

    const scored = Array.from(rowsById.values())
      .map((row) => {
        const reasons = reasonsById.get(row.id);
        const context: MasterSearchContext = { queryIsMolecule, reasons };
        const score = this.scoreMaster(row, q, normalized, context);

        return {
          ...this.serializer.mapMaster(row),
          score,
          matchReason: this.matchReasonForMaster(row, q, normalized, reasons),
        };
      })
      .filter((row) => row.score > 0)
      .sort(
        (a, b) =>
          b.score - a.score ||
          this.masterResultRank(b) - this.masterResultRank(a) ||
          String(a.brandName ?? '').localeCompare(String(b.brandName ?? '')),
      );

    const results = this.dedupeEquivalentMasterResults(scored).slice(0, take);
    if (options.enqueueEnrichment !== false) {
      this.enrichmentQueue?.enqueueSaltProfiles(
        results.map((row) => ({
          id: row.saltProfile?.id,
          enrichmentStatus: row.saltProfile?.enrichmentStatus,
        })),
        'master-search',
      );
    }

    return results;
  }

  async resolveCandidate(candidate: MedicineCandidate, limit = 8) {
    if (candidate.source === 'BARCODE' && candidate.barcode) {
      const barcodeResult = await this.findByBarcode(candidate.barcode);
      const matches =
        barcodeResult.found && barcodeResult.master
          ? [{ masterId: barcodeResult.master.id, score: 1 }]
          : [];

      return {
        candidate,
        outcome: this.resolver.classify({
          ...candidate,
          possibleMasterMatches: matches,
        }),
        matches,
      };
    }

    const query = candidate.rawName.trim();
    const matches = (await this.searchMaster(query, limit)).map(
      (match: any) => ({
        masterId: match.id,
        score: match.score ?? 0,
      }),
    );

    return {
      candidate,
      outcome: this.resolver.classify({
        ...candidate,
        possibleMasterMatches: matches,
      }),
      matches,
    };
  }

  buildCaptureReviewKey(data: {
    type?: string | null;
    source?: string | null;
    rawName?: string | null;
    gtin?: string | null;
    strength?: string | null;
    form?: string | null;
    medicineMasterId?: string | null;
    saltProfileId?: string | null;
  }) {
    return this.buildReviewNormalizedKey(data);
  }

  async queueCaptureReview(data: {
    type: string;
    submittedById?: string;
    medicineMasterId?: string | null;
    medicinePackageId?: string | null;
    saltProfileId?: string | null;
    normalizedKey?: string | null;
    source?: string | null;
    strength?: string | null;
    form?: string | null;
    rawName?: string | null;
    gtin?: string | null;
    userStripImageUrl?: string | null;
    billLine?: string | null;
    payload?: Record<string, unknown>;
    notes?: string | null;
  }) {
    await this.createReviewOnce(data);
  }

  async getMaster(id: string) {
    const master = await this.prisma.medicineMaster.findFirst({
      where: { id, isArchived: false },
      include: {
        saltProfile: this.saltProfileInclude(),
        packages: { where: { isDemo: false }, orderBy: { createdAt: 'asc' } },
      },
    });

    if (!master) {
      throw new NotFoundException('Medicine master entry not found');
    }

    const mapped = this.serializer.mapMaster(master);
    this.enrichmentQueue?.enqueueSaltProfiles(
      [
        {
          id: mapped?.saltProfile?.id,
          enrichmentStatus: mapped?.saltProfile?.enrichmentStatus,
        },
      ],
      'master-detail',
    );

    return mapped;
  }

  async findByBarcode(gtin: string) {
    const code = gtin.trim();

    if (code.length < 4) {
      throw new BadRequestException('Barcode is too short.');
    }

    const packages = await this.prisma.medicinePackage.findMany({
      where: {
        gtin: code,
        isDemo: false,
        isVerified: true,
        medicine: { isArchived: false },
      },
      include: {
        medicine: {
          include: {
            saltProfile: this.saltProfileInclude(),
            packages: {
              where: { isDemo: false },
              orderBy: { createdAt: 'asc' },
            },
          },
        },
      },
      orderBy: { createdAt: 'asc' },
    });
    const pack = packages[0];

    if (!pack) {
      return {
        found: false,
        gtin: code,
        message: 'Barcode is not verified in Medicine Master yet.',
      };
    }

    return {
      found: true,
      gtin: code,
      master: this.serializer.mapMaster(pack.medicine),
      package: this.serializer.mapPackage(pack),
      packages: packages
        .map((item: any) => ({
          package: this.serializer.mapPackage(item),
          master: this.serializer.mapMaster(item.medicine),
        }))
        .filter((item: any) => item.package && item.master),
    };
  }

  async reportUnknownBarcode(
    userId: string,
    gtin: string,
    options?: { userStripImageUrl?: string | null },
  ) {
    const code = gtin.trim();

    if (code.length < 4) {
      throw new BadRequestException('Barcode is too short.');
    }

    await this.createReviewOnce({
      type: 'UNKNOWN_BARCODE',
      submittedById: userId,
      source: 'BARCODE',
      gtin: code,
      userStripImageUrl: options?.userStripImageUrl,
      payload: {
        source: 'barcode_lookup_miss',
        userStripImageUrl: options?.userStripImageUrl,
      },
    });

    return {
      queued: true,
      gtin: code,
      message: 'Unknown barcode queued for admin verification.',
    };
  }

  buildPackageImageUrl(storedName: string) {
    const baseUrl = process.env.API_BASE_URL ?? 'http://localhost:3001';
    return `${baseUrl}/api/medicines/package-image/${encodeURIComponent(storedName)}`;
  }

  async verifyStripText(
    userId: string,
    medicineId: string,
    input: VerifyMedicineStripDto,
  ) {
    const medicine = await this.prisma.medicine.findUnique({
      where: { id: medicineId },
      include: {
        medicineMaster: { include: { saltProfile: true } },
      },
    });
    if (!medicine) throw new NotFoundException('Medicine not found');
    this.assertOwnership(medicine.userId, userId);
    const master =
      medicine.medicineMaster as unknown as StripVerificationMaster | null;
    const privateStrip = medicine as unknown as {
      userStripOcrText: string | null;
    };
    const referenceOcrText =
      typeof privateStrip.userStripOcrText === 'string'
        ? privateStrip.userStripOcrText
        : null;

    const verification = (
      this.stripVerification ?? new StripVerificationService()
    ).verify(
      {
        medicineName: medicine.name,
        brandName: medicine.brandName,
        masterBrandName: master?.brandName,
        genericName: medicine.genericName ?? master?.genericName,
        composition: master?.composition,
        saltDisplayName: master?.saltProfile?.displayName,
        strength: medicine.strength ?? master?.strength,
        referenceOcrText,
      },
      input,
    );

    await this.auditLogs.log({
      userId,
      action: AuditAction.MEDICATION_SAFETY_REVIEWED,
      entityType: 'Medicine',
      entityId: medicine.id,
      newValues: {
        status: verification.status,
        score: verification.score,
        ocrConfidence: verification.ocrConfidence,
        engine: verification.engine,
        hasStoredStrip: Boolean(medicine.userStripImageUrl),
        hasStoredOcrReference: Boolean(referenceOcrText),
      },
    });

    const cdsco = (this.cdscoVerifier ?? new CdscoVerifierService()).verify(
      input.ocrText,
    );

    return {
      medicineId: medicine.id,
      expectedMedicine:
        master?.brandName ?? medicine.brandName ?? medicine.name,
      hasStoredStrip: Boolean(medicine.userStripImageUrl),
      hasStoredOcrReference: Boolean(referenceOcrText),
      rawOcrText: input.ocrText,
      ...verification,
      cdsco,
      allowIngestion: cdsco.allowIngestion && verification.status === 'MATCH',
      safetyNotice:
        'This checks printed identity and CDSCO batch integrity. Always visually confirm the medicine and follow the prescription label.',
    };
  }

  async resolvePackageImageCandidate(
    candidate: PackageImageCandidate,
    imageUrl: string,
    limit = 6,
  ) {
    const brandEvidence = this.packageBrandEvidence(candidate);
    const matchesById = new Map<string, any>();
    const identityById = new Map<
      string,
      {
        match: any;
        evidence: (typeof brandEvidence)[number];
        rank: number;
      }
    >();
    const addMatches = (matches: any[]) => {
      for (const match of matches) {
        const existing = matchesById.get(match.id);
        if (!existing || (match.score ?? 0) > (existing.score ?? 0)) {
          matchesById.set(match.id, match);
        }
      }
    };

    const brandMatchGroups = await Promise.all(
      brandEvidence.map(async (evidence) => ({
        evidence,
        matches: await this.searchMaster(evidence.name, limit, {
          enqueueEnrichment: false,
        }),
      })),
    );

    for (const group of brandMatchGroups) {
      addMatches(group.matches);
      for (const match of group.matches) {
        if (
          !this.isBrandAlignedPackageMatch(group.evidence.name, match) ||
          !this.isStrengthCompatiblePackageMatch(
            candidate.extractedStrength,
            match,
          ) ||
          !this.isCompositionCompatiblePackageMatch(candidate, match)
        ) {
          continue;
        }

        const rank =
          Number(match.score ?? 0) * 0.72 +
          group.evidence.confidence * 0.18 +
          Math.min(group.evidence.parserScore, 1) * 0.1;
        const existing = identityById.get(match.id);
        if (!existing || rank > existing.rank) {
          identityById.set(match.id, {
            match,
            evidence: group.evidence,
            rank,
          });
        }
      }
    }

    const compositionMatches = candidate.composition?.ingredients?.length
      ? await this.searchMasterByCompositionIngredients(
          candidate.composition.ingredients,
          limit,
        )
      : [];
    addMatches(compositionMatches);

    const identityRecords = Array.from(identityById.values()).sort(
      (left, right) => right.rank - left.rank,
    );
    const identityIds = new Set(
      identityRecords.map((record) => record.match.id),
    );
    const suggestionMatches = Array.from(matchesById.values())
      .filter((match) => !identityIds.has(match.id))
      .sort((left, right) => (right.score ?? 0) - (left.score ?? 0))
      .slice(0, limit);
    const masterMatches = [
      ...identityRecords.map((record) => record.match),
      ...suggestionMatches,
    ].slice(0, limit);
    const selectedIdentity = identityRecords[0];
    const resolvedCandidate = selectedIdentity
      ? {
          ...candidate,
          rawName: selectedIdentity.evidence.name,
          ocrLine: selectedIdentity.evidence.ocrLine,
          ocrConfidence: Math.max(
            candidate.ocrConfidence,
            selectedIdentity.evidence.confidence,
          ),
          weak:
            candidate.weak &&
            !(
              selectedIdentity.evidence.confidence >= 0.5 &&
              Number(selectedIdentity.match.score ?? 0) >= 0.9
            ),
        }
      : candidate;
    const resolverOutcome = this.resolver.classify({
      rawName: resolvedCandidate.rawName,
      source: 'PACKAGE_IMAGE',
      imageUrl,
      extractedStrength: resolvedCandidate.extractedStrength,
      extractedPack: resolvedCandidate.extractedPack,
      confidence: resolvedCandidate.ocrConfidence,
      possibleMasterMatches: identityRecords.map((record) => ({
        masterId: record.match.id,
        score: record.match.score ?? 0,
      })),
    });

    const isStrongMatch =
      Boolean(selectedIdentity) &&
      (Number(selectedIdentity?.match?.score ?? 0) >= 0.9 ||
        resolverOutcome.kind === 'STRONG');

    if (isStrongMatch && selectedIdentity) {
      this.ocrAliasCache?.learn(
        selectedIdentity.evidence.name,
        selectedIdentity.match.id,
        selectedIdentity.match.brandName,
        selectedIdentity.match.strength,
      );
      if (selectedIdentity.evidence.ocrLine) {
        this.ocrAliasCache?.learn(
          selectedIdentity.evidence.ocrLine,
          selectedIdentity.match.id,
          selectedIdentity.match.brandName,
          selectedIdentity.match.strength,
        );
      }
    }

    const canonicalName = isStrongMatch
      ? String(selectedIdentity?.match?.brandName ?? resolvedCandidate.rawName)
      : resolvedCandidate.rawName;

    const canonicalStrength =
      isStrongMatch && selectedIdentity?.match?.strength
        ? String(selectedIdentity.match.strength)
        : resolvedCandidate.extractedStrength;

    const isAutoCorrected =
      isStrongMatch &&
      Boolean(selectedIdentity?.match?.brandName) &&
      this.normalizeMedicineName(String(selectedIdentity?.match?.brandName)) !==
        this.normalizeMedicineName(candidate.rawName);

    return {
      ...resolvedCandidate,
      rawName: canonicalName,
      displayName: canonicalName,
      extractedStrength: canonicalStrength,
      isAutoCorrected,
      originalOcrText: candidate.ocrLine || candidate.rawName,
      source: 'PACKAGE_IMAGE' as const,
      imageUrl,
      confidence: selectedIdentity?.match.score ?? 0,
      resolverOutcome,
      masterMatches,
    };
  }

  private packageBrandEvidence(candidate: PackageImageCandidate) {
    const evidence = candidate.brandCandidates?.length
      ? candidate.brandCandidates
      : [
          {
            name: candidate.rawName,
            ocrLine: candidate.ocrLine ?? candidate.rawName,
            confidence: candidate.ocrConfidence,
            parserScore: candidate.weak ? 0.35 : 0.7,
          },
        ];

    return Array.from(
      new Map(
        evidence
          .map((item) => ({ ...item, name: item.name.trim() }))
          .filter((item) => item.name.length >= 2)
          .map(
            (item) => [this.normalizeMedicineName(item.name), item] as const,
          ),
      ).values(),
    ).slice(0, 8);
  }

  private isCompositionCompatiblePackageMatch(
    candidate: PackageImageCandidate,
    match: any,
  ) {
    if (!candidate.composition || candidate.composition.confidence < 0.8) {
      return true;
    }

    return packageIdentityCompatibility(
      { composition: candidate.composition.displayName },
      match,
    ).compatible;
  }

  private isStrengthCompatiblePackageMatch(
    capturedStrength: string | undefined,
    match: any,
  ) {
    const captured = this.extractStrengthSignatures(capturedStrength ?? '');
    if (!captured.length) return true;

    const validCaptured = captured.filter(
      (s) => !/^0+(?:mg|mcg|g|gm|ml|iu|units?|%)$/i.test(s),
    );
    if (!validCaptured.length) return true;

    const master = this.extractStrengthSignatures(
      [
        match?.strength,
        match?.brandName,
        match?.composition,
        match?.genericName,
        match?.saltProfile?.displayName,
      ]
        .filter(Boolean)
        .join(' '),
    );
    if (!master.length) return true;

    return validCaptured.every((strength) => master.includes(strength));
  }

  private extractStrengthSignatures(value: string) {
    return Array.from(
      new Set(
        Array.from(
          value.matchAll(
            /\b(\d+(?:\.\d+)?)\s*(mg|mcg|ug|g|gm|ml|iu|units?|%)\b/gi,
          ),
        ).map(
          (match) =>
            `${Number(match[1])}${match[2].toLowerCase().replace('ug', 'mcg').replace('gm', 'g')}`,
        ),
      ),
    );
  }

  private isBrandAlignedPackageMatch(candidateName: string, match: any) {
    const candidate = this.normalizeMedicineName(candidateName);
    const brand = this.normalizeMedicineName(String(match?.brandName ?? ''));
    if (candidate.length < 3 || brand.length < 3) return false;
    if (candidate.includes(brand) || brand.includes(candidate)) return true;

    const candParts = this.parseMedicineSearchParts(candidateName, candidate);
    const brandParts = this.parseMedicineSearchParts(
      String(match?.brandName ?? ''),
      brand,
    );

    if (
      candParts.brandStem &&
      brandParts.brandStem &&
      (candParts.brandStem === brandParts.brandStem ||
        candParts.brandStem.includes(brandParts.brandStem) ||
        brandParts.brandStem.includes(candParts.brandStem))
    ) {
      return true;
    }

    if (
      candParts.homoglyph &&
      brandParts.homoglyph &&
      candParts.homoglyph === brandParts.homoglyph
    ) {
      return true;
    }

    const ocrMatch = this.ocrFuzzy.isOcrMatch(candidate, brand);
    if (ocrMatch.isMatch && ocrMatch.score >= 0.75) {
      return true;
    }

    if (candParts.brandStem && brandParts.brandStem) {
      const stemOcrMatch = this.ocrFuzzy.isOcrMatch(
        candParts.brandStem,
        brandParts.brandStem,
      );
      if (stemOcrMatch.isMatch && stemOcrMatch.score >= 0.75) {
        return true;
      }
    }

    const longestStem = Math.max(
      candParts.brandStem.length,
      brandParts.brandStem.length,
    );
    if (longestStem >= 4) {
      const stemDist = this.packageEditDistance(
        candParts.brandStem,
        brandParts.brandStem,
      );
      if (
        stemDist <= (longestStem >= 8 ? 2 : 1) &&
        1 - stemDist / longestStem >= 0.75
      ) {
        return true;
      }
    }

    const longest = Math.max(candidate.length, brand.length);
    const lengthDifference = Math.abs(candidate.length - brand.length);
    if (
      longest < 5 ||
      lengthDifference > Math.max(2, Math.ceil(longest * 0.2))
    ) {
      return false;
    }

    return 1 - this.packageEditDistance(candidate, brand) / longest >= 0.78;
  }

  private packageEditDistance(left: string, right: string) {
    const previous = Array.from(
      { length: right.length + 1 },
      (_, index) => index,
    );
    for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
      let diagonal = previous[0];
      previous[0] = leftIndex;
      for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
        const above = previous[rightIndex];
        previous[rightIndex] = Math.min(
          previous[rightIndex] + 1,
          previous[rightIndex - 1] + 1,
          diagonal + (left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1),
        );
        diagonal = above;
      }
    }
    return previous[right.length];
  }

  private async searchMasterByCompositionIngredients(
    ingredients: string[],
    limit: number,
  ) {
    const mode = 'insensitive' as const;
    const cleanIngredients = Array.from(
      new Set(
        ingredients
          .map((ingredient) => ingredient.trim())
          .filter((ingredient) => ingredient.length >= 3),
      ),
    );

    if (!cleanIngredients.length) {
      return [];
    }

    const rows = await this.prisma.medicineMaster.findMany({
      where: {
        isArchived: false,
        AND: cleanIngredients.map((ingredient) => {
          const base = normalizeBaseIngredient(ingredient);
          const stripped = ingredient
            .replace(
              /\s+(?:citrate|sodium|potassium|calcium|magnesium|maleate|hydrochloride|hcl|succinate|tartrate|mesylate|fumarate|gluconate|sulfate|phosphate|hydrate|dihydrate)\b/gi,
              '',
            )
            .trim();
          const terms = Array.from(
            new Set(
              [ingredient, base, stripped].filter(
                (term): term is string => Boolean(term) && term.length >= 3,
              ),
            ),
          );

          return {
            OR: terms.flatMap((term) => [
              { composition: { contains: term, mode } },
              { genericName: { contains: term, mode } },
              {
                saltProfile: {
                  is: {
                    OR: [
                      { displayName: { contains: term, mode } },
                      {
                        saltKey: {
                          contains: this.normalizeMedicineName(term),
                          mode,
                        },
                      },
                    ],
                  },
                },
              },
            ]),
          };
        }),
      },
      include: {
        saltProfile: this.saltProfileInclude(),
        packages: { where: { isDemo: false }, orderBy: { createdAt: 'asc' } },
      },
      take: Math.max(50, limit * 10),
    });

    return this.dedupeEquivalentMasterResults(
      rows
        .map((row) => ({
          ...this.serializer.mapMaster(row),
          score: this.scoreCompositionMaster(row, cleanIngredients),
          matchReason: 'composition',
        }))
        .filter((row) => row.score >= 0.65),
    ).slice(0, limit);
  }

  private scoreCompositionMaster(master: any, ingredients: string[]) {
    const searchText = this.normalizeMedicineName(
      [
        master.composition,
        master.genericName,
        master.saltProfile?.displayName,
        master.saltProfile?.saltKey,
      ]
        .filter(Boolean)
        .join(' '),
    );
    const matched = ingredients.filter((ingredient) => {
      const normalizedIngredient = this.normalizeMedicineName(ingredient);
      if (searchText.includes(normalizedIngredient)) return true;

      const tokens = ingredient
        .split(/\s+/)
        .map((token) => this.normalizeMedicineName(token))
        .filter((token) => token.length >= 3);

      return (
        tokens.length > 0 && tokens.every((token) => searchText.includes(token))
      );
    }).length;
    const ratio = matched / ingredients.length;
    const completeBonus = ratio === 1 ? 0.18 : 0;
    const verifiedBonus =
      master.saltProfile?.isVerified || master.isVerified ? 0.03 : 0;
    const discontinuedPenalty = master.isDiscontinued ? 0.12 : 0;

    return Math.max(
      0,
      Math.min(
        0.91,
        0.62 +
          ratio * 0.14 +
          completeBonus +
          verifiedBonus -
          discontinuedPenalty,
      ),
    );
  }

  async getPackageImageFile(user: CurrentUserPayload, storedName: string) {
    const safeName = basename(storedName);

    if (
      safeName !== storedName ||
      !/^[a-zA-Z0-9_.-]+$/.test(safeName) ||
      !['.jpg', '.jpeg', '.png'].includes(extname(safeName).toLowerCase())
    ) {
      throw new BadRequestException('Invalid package image name.');
    }

    const hasAccess = await this.canAccessPackageImage(user, safeName);
    if (!hasAccess) {
      throw new ForbiddenException(
        'You do not have access to this package image.',
      );
    }

    const absolutePath = join(
      process.cwd(),
      'uploads',
      'package-images',
      safeName,
    );
    if (!existsSync(absolutePath)) {
      throw new NotFoundException('Package image not found.');
    }

    return {
      stream: createReadStream(absolutePath),
      mimeType: this.mimeTypeForImage(safeName),
      fileName: safeName,
    };
  }

  async findAll(userId: string, page = 1, limit = 20, activeOnly = false) {
    const skip = (page - 1) * limit;
    const where = { userId, ...(activeOnly ? { isActive: true } : {}) };

    const [total, medicines] = await Promise.all([
      this.prisma.medicine.count({ where }),
      this.prisma.medicine.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          medicineMaster: {
            include: {
              saltProfile: this.saltProfileInclude(),
              packages: {
                where: { isDemo: false },
                orderBy: { createdAt: 'asc' },
              },
            },
          },
          medicinePackage: true,
          _count: { select: { schedules: true, doseLogs: true } },
        },
      }),
    ]);

    return {
      data: medicines.map((medicine) => this.serializer.mapMedicine(medicine)),
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }

  async findOne(userId: string, id: string) {
    const medicine = await this.prisma.medicine.findUnique({
      where: { id },
      include: {
        medicineMaster: {
          include: {
            saltProfile: this.saltProfileInclude(),
            packages: {
              where: { isDemo: false },
              orderBy: { createdAt: 'asc' },
            },
          },
        },
        medicinePackage: true,
        schedules: { where: { isActive: true } },
        _count: { select: { doseLogs: true } },
      },
    });

    if (!medicine) {
      throw new NotFoundException('Medicine not found');
    }

    this.assertOwnership(medicine.userId, userId);

    const mapped = this.serializer.mapMedicine(medicine);
    this.enrichmentQueue?.enqueueSaltProfiles(
      [
        {
          id: mapped?.master?.saltProfile?.id,
          enrichmentStatus: mapped?.master?.saltProfile?.enrichmentStatus,
        },
      ],
      'medicine-detail',
    );

    return mapped;
  }

  async requestMasterClinicalDetails(
    userId: string,
    masterId: string,
    medicinePackageId?: string | null,
  ) {
    const master = await this.prisma.medicineMaster.findFirst({
      where: { id: masterId, isArchived: false },
      include: {
        saltProfile: this.saltProfileInclude(),
        packages: { where: { isDemo: false }, orderBy: { createdAt: 'asc' } },
      },
    });

    if (!master) {
      throw new NotFoundException('Medicine master entry not found');
    }

    const profile = master.saltProfile;
    if (!profile) {
      throw new BadRequestException(
        'This medicine master is not linked to a salt profile yet.',
      );
    }

    let packageId = medicinePackageId || null;
    if (packageId) {
      const pack = master.packages.find((item) => item.id === packageId);
      if (!pack) {
        throw new BadRequestException(
          'Selected package does not belong to this medicine master.',
        );
      }
    } else {
      packageId = master.packages[0]?.id ?? null;
    }

    const mappedProfile = this.serializer.mapSaltProfile(profile);
    const missingFields = this.missingClinicalDetailFields(mappedProfile);

    if (missingFields.length === 0) {
      return {
        queued: false,
        alreadyAvailable: true,
        message:
          'Trusted clinical details are already available for this medicine.',
      };
    }

    const review = await this.createReviewOnce({
      type: 'MISSING_CLINICAL_DETAILS',
      submittedById: userId,
      medicineMasterId: master.id,
      medicinePackageId: packageId,
      saltProfileId: profile.id,
      normalizedKey: `missing-clinical:${profile.id}`,
      rawName: profile.displayName,
      payload: {
        saltProfileId: profile.id,
        saltKey: profile.saltKey,
        displayName: profile.displayName,
        enrichmentStatus: mappedProfile?.enrichmentStatus ?? 'NEEDS_SOURCE',
        missingFields,
        requestedFromMasterId: master.id,
        requestedFromBrandName: master.brandName,
        medicinePackageId: packageId,
      },
      notes:
        'Patient requested missing clinical details from Medicine Master preview.',
    });

    return {
      queued: true,
      alreadyAvailable: false,
      reviewId: review.id,
      demandCount: review.demandCount,
      missingFields,
      message: 'Clinical detail request queued for trusted review.',
    };
  }
  async requestClinicalDetails(userId: string, id: string) {
    const medicine = await this.prisma.medicine.findUnique({
      where: { id },
      include: {
        medicineMaster: {
          include: {
            saltProfile: this.saltProfileInclude(),
            packages: {
              where: { isDemo: false },
              orderBy: { createdAt: 'asc' },
            },
          },
        },
        medicinePackage: true,
      },
    });

    if (!medicine) {
      throw new NotFoundException('Medicine not found');
    }

    this.assertOwnership(medicine.userId, userId);

    const mapped = this.serializer.mapMedicine(medicine);
    const profile = medicine.medicineMaster?.saltProfile;

    if (!medicine.medicineMasterId || !profile) {
      throw new BadRequestException(
        'This medicine must be linked to Medicine Master before clinical details can be requested.',
      );
    }

    const missingFields = this.missingClinicalDetailFields(mapped.enrichment);

    if (missingFields.length === 0) {
      return {
        queued: false,
        alreadyAvailable: true,
        message:
          'Trusted clinical details are already available for this medicine.',
      };
    }

    const review = await this.createReviewOnce({
      type: 'MISSING_CLINICAL_DETAILS',
      submittedById: userId,
      medicineMasterId: medicine.medicineMasterId,
      medicinePackageId: medicine.medicinePackageId,
      saltProfileId: profile.id,
      normalizedKey: `missing-clinical:${profile.id}`,
      rawName: profile.displayName,
      payload: {
        saltProfileId: profile.id,
        saltKey: profile.saltKey,
        displayName: profile.displayName,
        enrichmentStatus: mapped.enrichment?.enrichmentStatus ?? 'NEEDS_SOURCE',
        missingFields,
        requestedFromMedicineId: medicine.id,
        requestedFromMedicineName: medicine.name,
        medicineMasterId: medicine.medicineMasterId,
      },
      notes: 'Patient requested missing clinical details.',
    });

    return {
      queued: true,
      alreadyAvailable: false,
      reviewId: review.id,
      demandCount: review.demandCount,
      missingFields,
      message: 'Clinical detail request queued for trusted review.',
    };
  }
  async update(userId: string, id: string, dto: UpdateMedicineDto) {
    const existing = await this.findOne(userId, id);
    const { stockQuantity, medicineMasterId, medicinePackageId, ...rest } = dto;
    const selection = await this.resolveMedicineSelection(
      medicineMasterId,
      medicinePackageId,
    );

    const data: any = { ...rest };

    if (selection.medicineMasterId !== undefined) {
      data.medicineMasterId = selection.medicineMasterId || null;
    }

    if (selection.medicinePackageId !== undefined) {
      data.medicinePackageId = selection.medicinePackageId || null;
    }

    if (stockQuantity !== undefined) {
      data.remainingQuantity = stockQuantity;
      data.totalQuantity = stockQuantity;
    }

    const updated = await this.prisma.medicine.update({
      where: { id },
      data,
      include: {
        medicineMaster: {
          include: {
            saltProfile: this.saltProfileInclude(),
            packages: {
              where: { isDemo: false },
              orderBy: { createdAt: 'asc' },
            },
          },
        },
        medicinePackage: true,
      },
    });

    await this.auditLogs.log({
      userId,
      action: 'UPDATED',
      entityType: 'Medicine',
      entityId: id,
      oldValues: {
        name: existing.name,
        strength: existing.strength,
        isActive: existing.isActive,
        medicineMasterId: existing.medicineMasterId,
        medicinePackageId: existing.medicinePackageId,
      },
      newValues: { ...dto },
    });

    await this.enqueueReviewIfNeeded(userId, updated);
    await this.refreshMedicationSafety(userId);

    return this.serializer.mapMedicine(updated);
  }

  async deactivate(userId: string, id: string, permanent = false) {
    const existing = await this.findOne(userId, id);

    if (permanent) {
      // Clean up schedules and cascade delete the medicine permanently
      await this.prisma.medicineSchedule.deleteMany({
        where: { medicineId: id, userId },
      });

      await this.prisma.medicine.delete({
        where: { id },
      });

      await this.auditLogs.log({
        userId,
        action: 'DELETED',
        entityType: 'Medicine',
        entityId: id,
        newValues: { name: existing.name },
      });

      await this.refreshMedicationSafety(userId);

      return {
        id,
        name: existing.name,
        isActive: false,
        deleted: true,
        success: true,
        message: 'Medicine permanently deleted',
      };
    }

    // Soft delete / deactivation: also deactivate schedules so no phantom alarms sound
    await this.prisma.medicineSchedule.updateMany({
      where: { medicineId: id, userId },
      data: { isActive: false },
    });

    const updated = await this.prisma.medicine.update({
      where: { id },
      data: { isActive: false },
      include: {
        medicineMaster: {
          include: {
            saltProfile: this.saltProfileInclude(),
            packages: {
              where: { isDemo: false },
              orderBy: { createdAt: 'asc' },
            },
          },
        },
        medicinePackage: true,
      },
    });

    await this.auditLogs.log({
      userId,
      action: 'UPDATED',
      entityType: 'Medicine',
      entityId: id,
      newValues: { isActive: false },
    });

    await this.refreshMedicationSafety(userId);

    return this.serializer.mapMedicine(updated);
  }

  async decrementQuantity(medicineId: string, amount: number) {
    await this.prisma.$executeRaw`
      UPDATE medicines
      SET "remainingQuantity" = GREATEST(0, "remainingQuantity" - ${amount}),
          "updatedAt" = NOW()
      WHERE id = ${medicineId}
        AND "remainingQuantity" IS NOT NULL
    `;
  }

  async listReviews(status = 'OPEN', page = 1, limit = 20, type?: string) {
    const take = Math.max(1, Math.min(limit, 100));
    const skip = (Math.max(1, page) - 1) * take;
    const where = {
      ...(status ? { status: status as any } : {}),
      ...(type ? { type: type as any } : {}),
    };

    const [total, rows] = await Promise.all([
      this.prisma.medicineDataReview.count({ where }),
      this.prisma.medicineDataReview.findMany({
        where,
        skip,
        take,
        orderBy: [{ demandCount: 'desc' }, { createdAt: 'desc' }],
        include: {
          submittedBy: { select: { id: true, email: true, role: true } },
          reviewedBy: { select: { id: true, email: true, role: true } },
          medicinePackage: true,
          saltProfile: true,
          medicineMaster: {
            include: {
              saltProfile: this.saltProfileInclude(),
              packages: {
                where: { isDemo: false },
                orderBy: { createdAt: 'asc' },
              },
            },
          },
        },
      }),
    ]);

    return {
      data: rows.map((row) => this.mapReview(row)),
      meta: { total, page, limit: take, totalPages: Math.ceil(total / take) },
    };
  }

  async resolveReview(
    adminId: string,
    id: string,
    dto: ResolveMedicineReviewDto,
  ) {
    const review = await this.prisma.medicineDataReview.findUnique({
      where: { id },
      select: {
        id: true,
        status: true,
        normalizedKey: true,
        rawName: true,
        strength: true,
        source: true,
      },
    });

    if (!review) {
      throw new NotFoundException('Medicine review item not found.');
    }

    if (review.status !== 'OPEN') {
      throw new BadRequestException('Only open review items can be resolved.');
    }

    let medicineMasterId = dto.medicineMasterId;
    let medicinePackageId = dto.medicinePackageId;

    if (dto.package) {
      if (dto.package.gtin?.startsWith('0000-TEST-')) {
        throw new BadRequestException(
          'Test GTINs cannot be saved as verified packages.',
        );
      }

      await this.assertMasterExists(dto.package.medicineMasterId);

      const created = await this.prisma.medicinePackage.create({
        data: {
          medicineId: dto.package.medicineMasterId,
          gtin: dto.package.gtin,
          barcodeType: dto.package.barcodeType,
          packSize: dto.package.packSize,
          stripImageUrl: dto.package.stripImageUrl,
          pillImageUrl: dto.package.pillImageUrl,
          isVerified: true,
          source: 'ADMIN',
          verifiedAt: new Date(),
        },
      });

      medicineMasterId = created.medicineId;
      medicinePackageId = created.id;
    }

    if (medicinePackageId) {
      const pack = await this.prisma.medicinePackage.findFirst({
        where: {
          id: medicinePackageId,
          medicine: { isArchived: false },
        },
        select: { id: true, medicineId: true, isDemo: true },
      });

      if (!pack || pack.isDemo) {
        throw new BadRequestException('Selected package was not found.');
      }

      if (medicineMasterId && medicineMasterId !== pack.medicineId) {
        throw new BadRequestException(
          'Selected package does not belong to the selected medicine.',
        );
      }

      medicineMasterId = pack.medicineId;

      if (dto.status === 'VERIFIED') {
        await this.prisma.medicinePackage.update({
          where: { id: pack.id },
          data: { isVerified: true, source: 'ADMIN', verifiedAt: new Date() },
        });
      }
    }

    if (medicineMasterId) {
      await this.assertMasterExists(medicineMasterId);

      if (dto.status === 'VERIFIED') {
        await this.prisma.medicineMaster.update({
          where: { id: medicineMasterId },
          data: { isVerified: true, source: 'ADMIN' },
        });
      }
    }

    const status =
      dto.status ?? (medicineMasterId || medicinePackageId ? 'LINKED' : null);

    if (!status) {
      throw new BadRequestException(
        'Provide a status, medicine master, package, or new package to resolve the review.',
      );
    }

    const updated = await this.prisma.medicineDataReview.update({
      where: { id },
      data: {
        status: status as any,
        reviewedById: adminId,
        medicineMasterId,
        medicinePackageId,
        adminNotes: dto.adminNotes,
        reviewedAt: new Date(),
      },
      include: {
        submittedBy: { select: { id: true, email: true, role: true } },
        reviewedBy: { select: { id: true, email: true, role: true } },
        medicinePackage: true,
        saltProfile: true,
        medicineMaster: {
          include: {
            saltProfile: this.saltProfileInclude(),
            packages: {
              where: { isDemo: false },
              orderBy: { createdAt: 'asc' },
            },
          },
        },
      },
    });

    if (medicineMasterId && (status === 'LINKED' || status === 'VERIFIED')) {
      await this.repointUnknownMedicinesForReview(
        review,
        medicineMasterId,
        medicinePackageId,
      );
    }

    return this.mapReview(updated);
  }

  async assistReviewWebSources(
    adminId: string,
    id: string,
    options?: { refresh?: boolean },
  ) {
    const review = await this.prisma.medicineDataReview.findUnique({
      where: { id },
      include: {
        saltProfile: true,
        medicineMaster: true,
      },
    });

    if (!review) {
      throw new NotFoundException('Medicine review item not found.');
    }

    if (review.type !== 'MISSING_CLINICAL_DETAILS') {
      throw new BadRequestException(
        'Web source assist is only available for clinical detail requests.',
      );
    }

    if (!review.saltProfile) {
      throw new BadRequestException(
        'This request is not linked to a salt profile.',
      );
    }

    if (!this.webSourceAssist) {
      throw new BadRequestException(
        'Trusted web source assist is not configured.',
      );
    }

    const result = await this.webSourceAssist.assist(
      {
        reviewId: review.id,
        saltProfile: {
          id: review.saltProfile.id,
          saltKey: review.saltProfile.saltKey,
          displayName: review.saltProfile.displayName,
          ingredients: review.saltProfile.ingredients,
        },
        rawName: review.rawName,
        composition: review.medicineMaster?.composition,
      },
      options,
    );

    const payload = this.jsonRecord(review.payload);
    await this.prisma.medicineDataReview.update({
      where: { id: review.id },
      data: {
        payload: {
          ...payload,
          webAssistLastRun: {
            provider: result.provider,
            configured: result.configured,
            query: result.query,
            generatedAt: result.generatedAt,
            message: result.message,
            sourceCount: result.sources.length,
            sources: result.sources.slice(0, 8).map((source) => ({
              title: source.title,
              url: source.url,
              tier: source.tier,
              host: source.host,
              usableForClinicalFields: source.usableForClinicalFields,
            })),
            draftedFields: Object.entries(result.draft)
              .filter(
                ([key, value]) =>
                  key !== 'sourceNote' &&
                  key !== 'unsafeDoseFields' &&
                  (Array.isArray(value) ? value.length : Boolean(value)),
              )
              .map(([key]) => key),
            warnings: result.warnings,
          },
        } as any,
      },
    });

    await this.auditLogs.log({
      userId: adminId,
      action: 'UPDATED',
      entityType: 'MedicineDataReview',
      entityId: review.id,
      newValues: {
        webSourceAssist: {
          provider: result.provider,
          query: result.query,
          sourceCount: result.sources.length,
          draftedFieldCount: Object.keys(result.draft).length,
          configured: result.configured,
        },
      },
    });

    return result;
  }
  async updateReviewClinicalDetails(
    adminId: string,
    id: string,
    dto: AdminClinicalDetailsDto,
  ) {
    const review = await this.prisma.medicineDataReview.findUnique({
      where: { id },
      include: {
        submittedBy: { select: { id: true, email: true, role: true } },
        reviewedBy: { select: { id: true, email: true, role: true } },
        medicinePackage: true,
        saltProfile: this.saltProfileInclude(),
        medicineMaster: {
          include: {
            saltProfile: this.saltProfileInclude(),
            packages: {
              where: { isDemo: false },
              orderBy: { createdAt: 'asc' },
            },
          },
        },
      },
    });

    if (!review) {
      throw new NotFoundException('Medicine review item not found.');
    }

    if (review.type !== 'MISSING_CLINICAL_DETAILS') {
      throw new BadRequestException(
        'Clinical details can only be added to missing clinical detail requests.',
      );
    }

    if (review.status !== 'OPEN') {
      throw new BadRequestException(
        'Only open clinical detail requests can be updated.',
      );
    }

    if (!review.saltProfile) {
      throw new BadRequestException(
        'This request is not linked to a salt profile.',
      );
    }

    const sourceTitle = dto.sourceTitle?.trim();
    if (!sourceTitle) {
      throw new BadRequestException(
        'A source title is required before saving trusted clinical details.',
      );
    }

    const cleaned = this.cleanAdminClinicalDetails(dto);
    if (!cleaned.fields.length) {
      throw new BadRequestException(
        'Add at least one clinical detail field before saving.',
      );
    }

    const clinicalSource = this.adminClinicalSourceConfig(dto.sourceType);
    const sourceRefs = this.jsonRecord(review.saltProfile.sourceRefs);
    for (const field of cleaned.fields) {
      sourceRefs[field] = this.mergeAdminClinicalSourceRef(
        sourceRefs[field],
        this.adminClinicalSourceRef(field, dto, adminId),
      );
    }

    const enrichmentStatus = this.clinicalEnrichmentStatus(sourceRefs);

    await this.prisma.saltProfile.update({
      where: { id: review.saltProfile.id },
      data: {
        ...cleaned.data,
        sourceRefs: sourceRefs as any,
        enrichmentStatus: enrichmentStatus as any,
        source: 'ADMIN',
        version: { increment: 1 },
        lastEnrichmentSuccessAt:
          enrichmentStatus === 'NEEDS_SOURCE' ? undefined : new Date(),
        lastEnrichmentError: null,
      },
    });

    await this.patientExplanation?.generateForSaltProfile(
      review.saltProfile.id,
      {
        language: 'en',
        dryRun: false,
      },
    );

    const updated = await this.prisma.medicineDataReview.update({
      where: { id: review.id },
      data: {
        status: 'VERIFIED',
        reviewedById: adminId,
        adminNotes:
          dto.adminNotes?.trim() ||
          `Clinical details updated from ${clinicalSource.provider}: ${sourceTitle}`,
        reviewedAt: new Date(),
        payload: {
          ...this.jsonRecord(review.payload),
          resolvedFields: cleaned.fields,
          sourceTitle,
          sourceType: clinicalSource.sourceType,
          sourceProvider: clinicalSource.provider,
          sourceUrl: dto.sourceUrl?.trim() || undefined,
          sourceNote: dto.sourceNote?.trim() || undefined,
        } as any,
      },
      include: {
        submittedBy: { select: { id: true, email: true, role: true } },
        reviewedBy: { select: { id: true, email: true, role: true } },
        medicinePackage: true,
        saltProfile: this.saltProfileInclude(),
        medicineMaster: {
          include: {
            saltProfile: this.saltProfileInclude(),
            packages: {
              where: { isDemo: false },
              orderBy: { createdAt: 'asc' },
            },
          },
        },
      },
    });

    return this.mapReview(updated);
  }
  private mapReview(row: any) {
    return {
      id: row.id,
      type: row.type,
      status: row.status,
      normalizedKey: row.normalizedKey,
      source: row.source,
      strength: row.strength,
      form: row.form,
      rawName: row.rawName,
      gtin: row.gtin,
      userStripImageUrl: row.userStripImageUrl,
      billLine: row.billLine,
      demandCount: row.demandCount,
      payload: row.payload,
      notes: row.notes,
      adminNotes: row.adminNotes,
      submittedBy: row.submittedBy,
      reviewedBy: row.reviewedBy,
      reviewedAt: row.reviewedAt,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      medicineMaster: this.serializer.mapMaster(row.medicineMaster),
      medicinePackage: this.serializer.mapPackage(row.medicinePackage),
      saltProfile: this.serializer.mapSaltProfile(row.saltProfile),
    };
  }

  private missingClinicalDetailFields(enrichment: any) {
    const missing: string[] = [];
    const patientExplanation =
      enrichment?.patientExplanation ??
      enrichment?.patientExplanations?.find?.(
        (item: any) =>
          item?.whyPrescribed ||
          item?.howToTake ||
          item?.warnings ||
          item?.storage ||
          item?.sideEffects?.length,
      );

    if (!patientExplanation?.whyPrescribed && !enrichment?.uses) {
      missing.push('Why it may be prescribed');
    }

    if (!patientExplanation?.howToTake && !enrichment?.howToTake) {
      missing.push('How to take');
    }

    if (!patientExplanation?.warnings && !enrichment?.warnings) {
      missing.push('Warnings');
    }

    if (!patientExplanation?.storage && !enrichment?.storage) {
      missing.push('Storage');
    }

    const sideEffects = patientExplanation?.sideEffects?.length
      ? patientExplanation.sideEffects
      : (enrichment?.sideEffects ?? []);

    if (!sideEffects.length) {
      missing.push('Possible side effects');
    }

    return missing;
  }
  private cleanAdminClinicalDetails(dto: AdminClinicalDetailsDto) {
    const data: Record<string, unknown> = {};
    const fields: string[] = [];
    const textFields = ['uses', 'howToTake', 'warnings', 'storage'] as const;

    for (const field of textFields) {
      const value = dto[field]?.trim();
      if (!value) continue;
      data[field] = value;
      fields.push(field);
    }

    const sideEffects = Array.isArray(dto.sideEffects)
      ? dto.sideEffects
          .map((effect) => effect.trim())
          .filter(Boolean)
          .slice(0, 30)
      : [];

    if (sideEffects.length) {
      data.sideEffects = sideEffects;
      fields.push('sideEffects');
    }

    return { data, fields };
  }

  private adminClinicalSourceRef(
    field: string,
    dto: AdminClinicalDetailsDto,
    adminId: string,
  ) {
    const source = this.adminClinicalSourceConfig(dto.sourceType);
    const sourceUrl = dto.sourceUrl?.trim() || '';
    const sourceNote = dto.sourceNote?.trim();

    return {
      sourceType: source.sourceType,
      provider: source.provider,
      field,
      sourceField: field,
      title: dto.sourceTitle.trim(),
      url: sourceUrl,
      fetchedAt: new Date().toISOString(),
      adminUserId: adminId,
      verifiedByAdmin: true,
      ...(sourceNote ? { note: sourceNote } : {}),
    };
  }

  private adminClinicalSourceConfig(sourceType?: string) {
    return (
      ADMIN_CLINICAL_SOURCE_PROVIDERS[
        (sourceType || 'ADMIN') as keyof typeof ADMIN_CLINICAL_SOURCE_PROVIDERS
      ] ?? ADMIN_CLINICAL_SOURCE_PROVIDERS.ADMIN
    );
  }

  private mergeAdminClinicalSourceRef(
    existing: unknown,
    next: Record<string, unknown>,
  ) {
    const refs = (
      Array.isArray(existing) ? existing : existing ? [existing] : []
    ).filter(
      (ref): ref is Record<string, unknown> =>
        Boolean(ref) && typeof ref === 'object',
    );
    const nextKey = this.sourceRefDedupeKey(next);

    if (refs.some((ref) => this.sourceRefDedupeKey(ref) === nextKey)) {
      return refs;
    }

    return [next, ...refs];
  }

  private sourceRefDedupeKey(ref: Record<string, unknown>) {
    return [ref.sourceType, ref.provider, ref.field, ref.title, ref.url]
      .map((part) =>
        String(part ?? '')
          .trim()
          .toLowerCase(),
      )
      .join('|');
  }

  private clinicalEnrichmentStatus(sourceRefs: Record<string, unknown>) {
    const targetFields = [
      'uses',
      'howToTake',
      'sideEffects',
      'warnings',
      'storage',
    ];
    const sourcedCount = targetFields.filter((field) =>
      this.hasTrustedClinicalSource(sourceRefs[field]),
    ).length;

    if (sourcedCount === targetFields.length) return 'COMPLETE';
    if (sourcedCount > 0) return 'PARTIAL';
    return 'NEEDS_SOURCE';
  }

  private hasTrustedClinicalSource(value: unknown) {
    return hasTrustedClinicalSourceRefList(value);
  }

  private jsonRecord(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return {};
    }

    return { ...(value as Record<string, unknown>) };
  }
  private normalizeMedicineName(value: string) {
    return value.toLowerCase().replace(/[^a-z0-9]+/g, '');
  }

  private toHomoglyphKey(value: string) {
    return value
      .toLowerCase()
      .replace(/[0oO]/g, 'o')
      .replace(/[1lI|!]/g, 'l')
      .replace(/[5sS]/g, 's')
      .replace(/[2zZ]/g, 'z')
      .replace(/[8bB]/g, 'b')
      .replace(/vv/g, 'w')
      .replace(/rn/g, 'm')
      .replace(/cl/g, 'd')
      .replace(/ph/g, 'f')
      .replace(/[^a-z0-9]/g, '');
  }

  private buildMasterSearchWhere(
    query: string,
    normalizedQuery: string,
  ): Prisma.MedicineMasterWhereInput {
    const mode = 'insensitive' as const;
    const parts = this.parseMedicineSearchParts(query, normalizedQuery);
    const clauses: Prisma.MedicineMasterWhereInput[] = [
      { normalizedName: { startsWith: normalizedQuery, mode } },
      { brandName: { startsWith: query, mode } },
    ];

    if (parts.brandStem && parts.brandStem !== normalizedQuery) {
      clauses.push(
        { normalizedName: { startsWith: parts.brandStem, mode } },
        { brandName: { startsWith: parts.brandStem, mode } },
      );
    }

    if (normalizedQuery.length >= 4) {
      clauses.push(
        { normalizedName: { contains: normalizedQuery, mode } },
        { brandName: { contains: query, mode } },
        { composition: { contains: query, mode } },
        { genericName: { contains: query, mode } },
        {
          saltProfile: {
            is: {
              OR: [
                { displayName: { contains: query, mode } },
                { saltKey: { contains: normalizedQuery, mode } },
              ],
            },
          },
        },
      );
    }

    return {
      isArchived: false,
      OR: clauses,
    };
  }

  private isRecognizedMoleculeQuery(
    query: string,
    normalizedQuery: string,
    rows: any[],
  ) {
    if (normalizedQuery.length < 6 || rows.length === 0) return false;

    return rows.some((row) => {
      const tier = this.compositionMatchTier(row, query, normalizedQuery);
      return tier === 'exact' || tier === 'strong';
    });
  }

  private hasCompositionMatch(
    master: any,
    rawQuery: string,
    normalizedQuery: string,
  ) {
    return Boolean(
      this.compositionMatchTier(master, rawQuery, normalizedQuery),
    );
  }

  private matchReasonForMaster(
    master: any,
    rawQuery: string,
    normalizedQuery: string,
    reasons?: Set<MasterMatchReason>,
  ): MasterMatchReason {
    if (reasons?.has('composition')) return 'composition';
    return this.hasCompositionMatch(master, rawQuery, normalizedQuery)
      ? 'composition'
      : 'brand';
  }

  private compositionMatchTier(
    master: any,
    rawQuery: string,
    normalizedQuery: string,
  ): CompositionMatchTier | null {
    if (!normalizedQuery) return null;

    const normalizedValues = [
      master.composition,
      master.genericName,
      master.saltProfile?.displayName,
    ]
      .filter(Boolean)
      .map((value) => this.normalizeMedicineName(String(value)));
    const saltKey = this.normalizeMedicineName(
      String(master.saltProfile?.saltKey ?? ''),
    );
    const ingredientNames = this.normalizedIngredientNames(
      master.saltProfile?.ingredients,
    );

    if (ingredientNames.some((ingredient) => ingredient === normalizedQuery)) {
      return 'exact';
    }

    if (normalizedValues.some((value) => value === normalizedQuery)) {
      return 'exact';
    }

    if (
      saltKey === normalizedQuery ||
      saltKey.startsWith(normalizedQuery) ||
      normalizedValues.some((value) => value.startsWith(normalizedQuery))
    ) {
      return 'strong';
    }

    if (
      ingredientNames.some((ingredient) =>
        ingredient.includes(normalizedQuery),
      ) ||
      saltKey.includes(normalizedQuery) ||
      normalizedValues.some((value) => value.includes(normalizedQuery))
    ) {
      return 'contains';
    }

    const queryTokens = rawQuery
      .split(/\s+/)
      .map((token) => this.normalizeMedicineName(token))
      .filter((token) => token.length >= 4);

    if (
      queryTokens.length > 0 &&
      normalizedValues.some((value) =>
        queryTokens.every((token) => value.includes(token)),
      )
    ) {
      return 'contains';
    }

    return null;
  }

  private normalizedIngredientNames(ingredients: unknown) {
    if (!Array.isArray(ingredients)) return [];

    return ingredients
      .map((ingredient) => {
        if (typeof ingredient === 'string') return ingredient;
        if (ingredient && typeof ingredient === 'object') {
          const value = ingredient as Record<string, unknown>;
          return value.ingredient ?? value.name ?? value.raw;
        }

        return null;
      })
      .filter(
        (value): value is string =>
          typeof value === 'string' && value.length > 0,
      )
      .map((value) => this.normalizeMedicineName(value));
  }

  private async findFallbackMasterRows(
    query: string,
    normalizedQuery: string,
    limit: number,
  ) {
    const parts = this.parseMedicineSearchParts(query, normalizedQuery);

    if (!parts.stems.length) {
      return [];
    }

    const searchWithStrength = parts.strengths.length > 0;

    if (searchWithStrength) {
      const strengthMatchedRows = await this.findFallbackRowsByStem(
        parts.stems,
        parts.strengths,
        limit,
      );

      if (strengthMatchedRows.length) {
        return strengthMatchedRows;
      }
    }

    return this.findFallbackRowsByStem(parts.stems, [], limit);
  }

  private async findFallbackRowsByStem(
    stems: string[],
    strengths: string[],
    limit: number,
  ) {
    for (const stem of stems) {
      const mode = 'insensitive' as const;
      const strengthClauses: Prisma.MedicineMasterWhereInput[] =
        strengths.flatMap((strength): Prisma.MedicineMasterWhereInput[] => [
          { brandName: { contains: strength, mode } },
          {
            normalizedName: {
              contains: this.normalizeMedicineName(strength),
              mode,
            },
          },
          { strength: { contains: strength, mode } },
          { composition: { contains: `${strength}mg`, mode } },
          { composition: { contains: `${strength} mg`, mode } },
          {
            saltProfile: {
              is: {
                OR: [
                  {
                    displayName: {
                      contains: `${strength}mg`,
                      mode,
                    },
                  },
                  {
                    saltKey: {
                      contains: `${strength}mg`,
                      mode,
                    },
                  },
                ],
              },
            },
          },
        ]);
      const andFilters: Prisma.MedicineMasterWhereInput[] = [
        {
          OR: [
            { brandName: { startsWith: stem, mode } },
            { normalizedName: { startsWith: stem, mode } },
          ],
        },
      ];

      if (strengthClauses.length) {
        andFilters.push({ OR: strengthClauses });
      }

      const rows = await this.prisma.medicineMaster.findMany({
        where: {
          isArchived: false,
          AND: andFilters,
        },
        include: {
          saltProfile: this.saltProfileInclude(),
          packages: { where: { isDemo: false }, orderBy: { createdAt: 'asc' } },
        },
        take: Math.max(100, limit * 12),
      });

      if (rows.length) {
        return rows;
      }
    }

    return [];
  }

  private async findRowsBySaltProfileQuery(
    query: string,
    normalizedQuery: string,
    limit: number,
  ) {
    if (normalizedQuery.length < 4) {
      return [];
    }

    const parts = this.parseMedicineSearchParts(query, normalizedQuery);
    const saltNeedles = Array.from(
      new Set([parts.letters].filter((value) => value.length >= 6)),
    );

    if (!saltNeedles.length) {
      return [];
    }

    const saltProfiles = await this.prisma.saltProfile.findMany({
      where: {
        OR: saltNeedles.flatMap((needle) => [
          { saltKey: { startsWith: needle, mode: 'insensitive' as const } },
          { saltKey: { contains: needle, mode: 'insensitive' as const } },
          { displayName: { contains: query, mode: 'insensitive' as const } },
        ]),
      },
      select: { id: true },
      take: Math.max(12, limit * 4),
    });
    const saltProfileIds = saltProfiles.map((salt) => salt.id);

    if (!saltProfileIds.length) {
      return [];
    }

    return this.prisma.medicineMaster.findMany({
      where: {
        isArchived: false,
        saltProfileId: { in: saltProfileIds },
      },
      include: {
        saltProfile: this.saltProfileInclude(),
        packages: { where: { isDemo: false }, orderBy: { createdAt: 'asc' } },
      },
      take: Math.max(100, limit * 12),
    });
  }

  private parseMedicineSearchParts(query: string, normalizedQuery: string) {
    const cleanLetters = normalizedQuery.replace(/[0-9]/g, '');
    const cleanDigits = Array.from(
      new Set(query.match(/\d+(?:\.\d+)?/g) ?? []),
    );
    const tokens = query
      .toLowerCase()
      .split(/[^a-z0-9]+/i)
      .filter((t) => t.length >= 2);
    const brandTokens = tokens.filter(
      (t) =>
        !/^\d+$/.test(t) &&
        !/^(?:mg|mcg|ug|g|gm|ml|iu|units?|tablets?|capsules?|film|coated|uncoated|release|sr|cr|xr|er|ds|dr|dt)$/i.test(
          t,
        ),
    );
    const primaryBrandStem = brandTokens[0] ?? cleanLetters;
    const stems = Array.from(
      new Set(
        [
          primaryBrandStem,
          cleanLetters,
          primaryBrandStem.length >= 6 ? primaryBrandStem.slice(0, 6) : null,
          primaryBrandStem.length >= 5 ? primaryBrandStem.slice(0, 5) : null,
          primaryBrandStem.length >= 4 ? primaryBrandStem.slice(0, 4) : null,
          cleanLetters.length >= 5 ? cleanLetters.slice(0, 5) : null,
          cleanLetters.length >= 4 ? cleanLetters.slice(0, 4) : null,
        ].filter((stem): stem is string => Boolean(stem && stem.length >= 3)),
      ),
    );

    return {
      letters: cleanLetters,
      brandStem: primaryBrandStem,
      brandTokens,
      stems,
      strengths: cleanDigits,
      homoglyph: this.toHomoglyphKey(primaryBrandStem || normalizedQuery),
    };
  }

  private scoreMaster(
    master: any,
    rawQuery: string,
    normalizedQuery: string,
    context: MasterSearchContext = { queryIsMolecule: false },
  ) {
    const brand = String(master.brandName || '').toLowerCase();
    const normalized = String(
      master.normalizedName || this.normalizeMedicineName(brand),
    );
    const query = rawQuery.toLowerCase();
    const parts = this.parseMedicineSearchParts(rawQuery, normalizedQuery);
    const masterParts = this.parseMedicineSearchParts(brand, normalized);
    const longestStem = parts.stems[0];
    const compositionTier = this.compositionMatchTier(
      master,
      rawQuery,
      normalizedQuery,
    );

    const brandExact = normalized === normalizedQuery || brand === query;
    const stemExact =
      Boolean(parts.brandStem) &&
      Boolean(masterParts.brandStem) &&
      parts.brandStem === masterParts.brandStem;
    const homoglyphExact =
      Boolean(parts.homoglyph) &&
      Boolean(masterParts.homoglyph) &&
      parts.homoglyph === masterParts.homoglyph;

    const brandPrefix =
      !brandExact &&
      (brand.startsWith(query) ||
        normalized.startsWith(normalizedQuery) ||
        (parts.brandStem.length >= 4 &&
          (masterParts.brandStem.startsWith(parts.brandStem) ||
            parts.brandStem.startsWith(masterParts.brandStem))));

    const brandContains =
      !brandExact &&
      !brandPrefix &&
      (brand.includes(query) ||
        normalized.includes(normalizedQuery) ||
        (parts.brandStem.length >= 4 &&
          (masterParts.brandStem.includes(parts.brandStem) ||
            parts.brandStem.includes(masterParts.brandStem))));

    const stemEditDist =
      parts.brandStem && masterParts.brandStem
        ? this.packageEditDistance(parts.brandStem, masterParts.brandStem)
        : 99;
    const maxStemLen = Math.max(
      parts.brandStem.length,
      masterParts.brandStem.length,
    );
    const stemFuzzyMatch =
      maxStemLen >= 5 &&
      stemEditDist <= (maxStemLen >= 8 ? 2 : 1) &&
      stemEditDist / maxStemLen <= 0.22;

    const hasStrengthMatch = parts.strengths.some((strength) =>
      [
        brand,
        normalized,
        String(master.strength || '').toLowerCase(),
        String(master.composition || '').toLowerCase(),
        String(master.saltProfile?.displayName || '').toLowerCase(),
        this.normalizeMedicineName(String(master.saltProfile?.saltKey || '')),
      ].some((value) => value.includes(strength.toLowerCase())),
    );

    const ocrFuzzyMatch = this.ocrFuzzy.isOcrMatch(query, brand);
    const ocrStemFuzzyMatch =
      parts.brandStem && masterParts.brandStem
        ? this.ocrFuzzy.isOcrMatch(parts.brandStem, masterParts.brandStem)
        : { isMatch: false, score: 0, isVisualConfusion: false };

    const isLearnedAlias =
      this.ocrAliasCache?.lookup(rawQuery)?.masterId === master.id;

    let score = 0.35;

    if (compositionTier === 'exact')
      score = context.queryIsMolecule ? 0.99 : 0.94;
    else if (compositionTier === 'strong')
      score = context.queryIsMolecule ? 0.97 : 0.92;
    else if (compositionTier === 'contains')
      score = context.queryIsMolecule ? 0.9 : 0.82;

    if (isLearnedAlias) {
      score = 1.0;
    } else if (context.queryIsMolecule && !compositionTier) {
      if (brandExact || stemExact) score = Math.max(score, 0.62);
      else if (brandPrefix || homoglyphExact) score = Math.max(score, 0.5);
      else if (ocrFuzzyMatch.isMatch) score = Math.max(score, 0.5);
      else if (brandContains) score = Math.max(score, 0.42);
      else if (
        longestStem &&
        normalized.startsWith(longestStem) &&
        hasStrengthMatch
      ) {
        score = Math.max(score, 0.4);
      }
    } else {
      if (brandExact) {
        score = Math.max(score, 1);
      } else if (stemExact && (hasStrengthMatch || !parts.strengths.length)) {
        score = Math.max(score, 1);
      } else if (
        (homoglyphExact || ocrStemFuzzyMatch.isMatch || ocrFuzzyMatch.isMatch) &&
        (hasStrengthMatch || !parts.strengths.length)
      ) {
        score = Math.max(score, 0.98);
      } else if (
        stemFuzzyMatch &&
        (hasStrengthMatch || !parts.strengths.length)
      ) {
        score = Math.max(score, 0.95);
      } else if (brandPrefix && hasStrengthMatch) {
        score = Math.max(score, 0.96);
      } else if (brandPrefix) {
        score = Math.max(score, 0.9);
      } else if (ocrStemFuzzyMatch.isMatch || ocrFuzzyMatch.isMatch) {
        score = Math.max(score, 0.92);
      } else if (stemFuzzyMatch) {
        score = Math.max(score, 0.88);
      } else if (brandContains && hasStrengthMatch) {
        score = Math.max(score, 0.88);
      } else if (brandContains) {
        score = Math.max(score, 0.75);
      } else if (
        longestStem &&
        normalized.startsWith(longestStem) &&
        hasStrengthMatch
      ) {
        score = Math.max(score, 0.88);
      } else if (
        longestStem &&
        normalized.includes(longestStem) &&
        hasStrengthMatch
      ) {
        score = Math.max(score, 0.78);
      }
    }

    return Math.max(0, master.isDiscontinued ? score - 0.2 : score);
  }

  private dedupeEquivalentMasterResults<T extends Record<string, any>>(
    rows: T[],
  ) {
    const byIdentity = new Map<string, T>();

    for (const row of rows) {
      const key = this.canonicalizer.buildEquivalentIdentityKey({
        brandName: row.brandName,
        saltKey: row.saltProfile?.saltKey,
        manufacturer: row.manufacturer,
      });
      const existing = byIdentity.get(key);

      if (
        !existing ||
        this.masterResultRank(row) > this.masterResultRank(existing)
      ) {
        byIdentity.set(key, row);
      }
    }

    return Array.from(byIdentity.values()).sort(
      (a, b) =>
        (b.score ?? 0) - (a.score ?? 0) ||
        this.masterResultRank(b) - this.masterResultRank(a) ||
        String(a.brandName ?? '').localeCompare(String(b.brandName ?? '')),
    );
  }

  private masterResultRank(row: any) {
    const packages = row.packages ?? [];

    return (
      (row.saltProfile?.isVerified ? 50 : 0) +
      (packages.some((pack: any) => pack.isVerified) ? 30 : 0) +
      (packages.some((pack: any) => pack.stripImageUrl || pack.pillImageUrl)
        ? 10
        : 0) +
      (packages.length > 0 ? 5 : 0)
    );
  }

  private async assertMasterExists(id: string) {
    const exists = await this.prisma.medicineMaster.findFirst({
      where: { id, isArchived: false },
      select: { id: true },
    });

    if (!exists) {
      throw new BadRequestException(
        'Selected medicine master entry was not found.',
      );
    }
  }

  private async resolveMedicineSelection(
    medicineMasterId?: string,
    medicinePackageId?: string,
    packageEvidence?: {
      brandName?: string | null;
      composition?: string | null;
    },
  ) {
    const masterWasProvided = medicineMasterId !== undefined;
    const packageWasProvided = medicinePackageId !== undefined;
    const requestedMasterId = medicineMasterId || null;
    const requestedPackageId = medicinePackageId || null;

    if (requestedPackageId) {
      const pack = await this.prisma.medicinePackage.findFirst({
        where: {
          id: requestedPackageId,
          medicine: { isArchived: false },
        },
        select: {
          id: true,
          medicineId: true,
          isDemo: true,
          medicine: {
            select: {
              brandName: true,
              genericName: true,
              composition: true,
              saltProfile: { select: { displayName: true } },
            },
          },
        },
      });

      if (!pack || pack.isDemo) {
        throw new BadRequestException(
          'Selected medicine package was not found.',
        );
      }

      if (requestedMasterId && pack.medicineId !== requestedMasterId) {
        throw new BadRequestException(
          'Selected package does not belong to the selected medicine.',
        );
      }

      if (
        packageEvidence &&
        !packageIdentityCompatibility(packageEvidence, pack.medicine).compatible
      ) {
        this.logger.warn(
          `Rejected incompatible package-image identity link to master ${pack.medicineId}`,
        );
        return { medicineMasterId: null, medicinePackageId: null };
      }

      return {
        medicineMasterId: pack.medicineId,
        medicinePackageId: pack.id,
      };
    }

    if (requestedMasterId) {
      if (packageEvidence) {
        const master = await this.prisma.medicineMaster.findFirst({
          where: { id: requestedMasterId, isArchived: false },
          select: {
            brandName: true,
            genericName: true,
            composition: true,
            saltProfile: { select: { displayName: true } },
          },
        });
        if (!master) {
          throw new BadRequestException(
            'Selected medicine master entry was not found.',
          );
        }
        const compatibility = packageIdentityCompatibility(
          packageEvidence,
          master,
        );
        if (!compatibility.compatible) {
          this.logger.warn(
            `Rejected incompatible package-image identity link to master ${requestedMasterId}: ${compatibility.reason}`,
          );
          return { medicineMasterId: null, medicinePackageId: null };
        }
      } else {
        await this.assertMasterExists(requestedMasterId);
      }
      return {
        medicineMasterId: requestedMasterId,
        medicinePackageId:
          packageWasProvided || masterWasProvided ? null : undefined,
      };
    }

    if (masterWasProvided && !requestedMasterId) {
      return { medicineMasterId: null, medicinePackageId: null };
    }

    if (packageWasProvided && !requestedPackageId) {
      return { medicineMasterId: undefined, medicinePackageId: null };
    }

    return { medicineMasterId: undefined, medicinePackageId: undefined };
  }

  private async enqueueReviewIfNeeded(userId: string, medicine: any) {
    if (!medicine.medicineMasterId) {
      await this.createReviewOnce({
        type: 'UNKNOWN_MANUAL',
        submittedById: userId,
        normalizedKey: medicine.captureReviewKey,
        source: medicine.source ?? 'MANUAL',
        rawName: medicine.name,
        strength: medicine.strength,
        form: medicine.form,
        userStripImageUrl: medicine.userStripImageUrl,
        payload: {
          brandName: medicine.brandName,
          genericName: medicine.genericName,
          strength: medicine.strength,
          source: medicine.source,
        },
      });

      return;
    }

    const pack = medicine.medicinePackage;
    const hasReferenceImage = Boolean(
      pack?.stripImageUrl || pack?.pillImageUrl,
    );
    const hasUserImage = Boolean(medicine.userStripImageUrl);

    if (!hasReferenceImage && !hasUserImage) {
      await this.createReviewOnce({
        type: 'MISSING_IMAGE',
        submittedById: userId,
        medicineMasterId: medicine.medicineMasterId,
        medicinePackageId: medicine.medicinePackageId,
        source: medicine.source ?? 'MANUAL',
        rawName: medicine.name,
        strength: medicine.strength,
        form: medicine.form,
        payload: {
          brandName: medicine.brandName,
          genericName: medicine.genericName,
          strength: medicine.strength,
        },
      });
    }
  }

  private async createReviewOnce(data: {
    type: string;
    submittedById?: string;
    medicineMasterId?: string | null;
    medicinePackageId?: string | null;
    saltProfileId?: string | null;
    normalizedKey?: string | null;
    source?: string | null;
    strength?: string | null;
    form?: string | null;
    rawName?: string | null;
    gtin?: string | null;
    userStripImageUrl?: string | null;
    billLine?: string | null;
    payload?: Record<string, unknown>;
    notes?: string | null;
  }) {
    const normalizedKey =
      data.normalizedKey ?? this.buildReviewNormalizedKey(data);
    const duplicate = normalizedKey
      ? await this.prisma.medicineDataReview.findUnique({
          where: { normalizedKey },
          select: { id: true, demandCount: true },
        })
      : await this.prisma.medicineDataReview.findFirst({
          where: {
            type: data.type as any,
            status: 'OPEN',
            ...(data.gtin ? { gtin: data.gtin } : {}),
            ...(data.medicineMasterId
              ? { medicineMasterId: data.medicineMasterId }
              : {}),
            ...(data.rawName && !data.medicineMasterId && !data.gtin
              ? { rawName: { equals: data.rawName, mode: 'insensitive' } }
              : {}),
          },
          select: { id: true, demandCount: true },
        });

    if (duplicate) {
      return this.prisma.medicineDataReview.update({
        where: { id: duplicate.id },
        data: {
          demandCount: { increment: 1 },
          submittedById: data.submittedById,
          saltProfileId: data.saltProfileId || undefined,
          userStripImageUrl: data.userStripImageUrl || undefined,
          payload: (data.payload as any) || undefined,
          notes: data.notes || undefined,
        },
      });
    }

    return this.prisma.medicineDataReview.create({
      data: {
        type: data.type as any,
        submittedById: data.submittedById,
        medicineMasterId: data.medicineMasterId || undefined,
        medicinePackageId: data.medicinePackageId || undefined,
        saltProfileId: data.saltProfileId || undefined,
        normalizedKey,
        source: (data.source as any) || undefined,
        strength: data.strength || undefined,
        form: (data.form as any) || undefined,
        rawName: data.rawName || undefined,
        gtin: data.gtin || undefined,
        userStripImageUrl: data.userStripImageUrl || undefined,
        billLine: data.billLine || undefined,
        payload: (data.payload as any) || undefined,
        notes: data.notes || undefined,
      },
    });
  }

  private buildReviewNormalizedKey(data: {
    type?: string | null;
    source?: string | null;
    rawName?: string | null;
    gtin?: string | null;
    strength?: string | null;
    form?: string | null;
    medicineMasterId?: string | null;
    saltProfileId?: string | null;
  }) {
    if (data.gtin) {
      return `barcode:${this.normalizeMedicineName(data.gtin)}`;
    }

    if (data.type === 'MISSING_IMAGE' && data.medicineMasterId) {
      return `missing-image:${data.medicineMasterId}`;
    }

    if (data.type === 'MISSING_CLINICAL_DETAILS' && data.saltProfileId) {
      return `missing-clinical:${data.saltProfileId}`;
    }

    const rawName = this.normalizeMedicineName(data.rawName ?? '');
    if (!rawName) return null;

    const source =
      this.normalizeMedicineName(data.source ?? 'MANUAL') || 'manual';
    const strength = this.normalizeMedicineName(data.strength ?? '');
    return `${data.type ?? 'UNKNOWN'}:${source}:${rawName}:${strength}`;
  }

  private async repointUnknownMedicinesForReview(
    review: {
      normalizedKey?: string | null;
      rawName?: string | null;
      strength?: string | null;
    },
    medicineMasterId: string,
    medicinePackageId?: string | null,
  ) {
    const where: Prisma.MedicineWhereInput = review.normalizedKey
      ? {
          medicineMasterId: null,
          captureReviewKey: review.normalizedKey,
        }
      : {
          medicineMasterId: null,
          ...(review.rawName
            ? { name: { equals: review.rawName, mode: 'insensitive' as const } }
            : {}),
          ...(review.strength
            ? {
                strength: {
                  equals: review.strength,
                  mode: 'insensitive' as const,
                },
              }
            : {}),
        };

    if (!review.normalizedKey && !review.rawName) return;

    await this.prisma.medicine.updateMany({
      where,
      data: {
        medicineMasterId,
        medicinePackageId: medicinePackageId || null,
        captureReviewKey: null,
      },
    });
  }

  private assertOwnership(ownerId: string, requesterId: string) {
    if (ownerId !== requesterId) {
      throw new ForbiddenException(
        'You do not have permission to access this medicine',
      );
    }
  }

  private async canAccessPackageImage(
    user: CurrentUserPayload,
    storedName: string,
  ) {
    const medicineOwner = await this.prisma.medicine.findFirst({
      where: {
        userStripImageUrl: { contains: storedName },
        ...(user.role === 'ADMIN' ? {} : { userId: user.sub }),
      },
      select: { id: true },
    });

    if (medicineOwner) return true;

    const reviewOwner = await this.prisma.medicineDataReview.findFirst({
      where: {
        userStripImageUrl: { contains: storedName },
        ...(user.role === 'ADMIN' ? {} : { submittedById: user.sub }),
      },
      select: { id: true },
    });

    return Boolean(reviewOwner);
  }

  private mimeTypeForImage(fileName: string) {
    return extname(fileName).toLowerCase() === '.png'
      ? 'image/png'
      : 'image/jpeg';
  }

  private async refreshMedicationSafety(userId: string) {
    if (!this.medicationSafety) return;
    try {
      await this.medicationSafety.evaluateUser(userId);
    } catch (error) {
      this.logger.error(
        `Medication safety refresh failed for user ${userId}`,
        error instanceof Error ? error.stack : undefined,
      );
    }
  }
}
