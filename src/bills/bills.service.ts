import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import {
  DocumentStatus,
  MedicineForm,
  ResolutionState,
  VerificationExecutionStatus,
  VerificationStatus,
} from '@prisma/client';
import { join } from 'path';
import { createReadStream, existsSync } from 'fs';
import { PrismaService } from '../prisma/prisma.service';
import { OcrService, type OcrResult } from '../ocr/ocr.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { buildRelativePath } from '../common/utils/file-upload.util';
import { MedicinesService } from '../medicines/medicines.service';
import { MedicineResolverService } from '../medicines/capture/medicine-resolver.service';
import { CreateBillDto } from './dto/create-bill.dto';
import {
  ConfirmBillDto,
  ConfirmedBillMedicineDto,
} from './dto/confirm-bill.dto';
import { BillCaptureService, BillLineCandidate } from './bill-capture.service';
import { clientOcrAttempt } from '../ocr/client-ocr-result.util';

// Refill reminder buffer: warn this many days before stock runs out
const REFILL_REMINDER_BUFFER_DAYS = 5;

type BillMasterMatch = {
  id: string;
  score?: number;
  brandName?: string | null;
  genericName?: string | null;
  composition?: string | null;
  strength?: string | null;
  saltProfile?: { displayName?: string | null } | null;
  [key: string]: unknown;
};

@Injectable()
export class BillsService {
  private readonly logger = new Logger(BillsService.name);

  constructor(
    private prisma: PrismaService,
    private ocrService: OcrService,
    private auditLogs: AuditLogsService,
    private medicinesService: MedicinesService,
    private resolver: MedicineResolverService,
    private billCapture: BillCaptureService,
  ) {}

  // ─────────────────────────────────────────────────────────
  // UPLOAD: save file, run OCR, store raw text
  // ─────────────────────────────────────────────────────────
  async upload(userId: string, file: Express.Multer.File, dto: CreateBillDto) {
    const relativePath = buildRelativePath('bills', file.filename);
    // 1. Create bill record
    const bill = await this.prisma.bill.create({
      data: {
        userId,
        fileName: file.originalname,
        storedName: file.filename,
        localPath: relativePath,
        mimeType: file.mimetype,
        fileSize: file.size,
        status: DocumentStatus.UPLOADED,
        pharmacyName: dto.pharmacyName,
        purchaseDate: dto.purchaseDate ? new Date(dto.purchaseDate) : null,
        totalAmount: dto.totalAmount,
        notes: dto.notes,
      },
    });

    await this.auditLogs.log({
      userId,
      action: 'FILE_UPLOADED',
      entityType: 'Bill',
      entityId: bill.id,
      newValues: { fileName: file.originalname, fileSize: file.size },
    });

    this.logger.log(`Bill uploaded: ${bill.id} by user ${userId}`);

    // 2. Mark OCR_PROCESSING
    await this.prisma.bill.update({
      where: { id: bill.id },
      data: { status: DocumentStatus.OCR_PROCESSING },
    });

    // 3. Run OCR
    const absolutePath = join(process.cwd(), relativePath);
    const nativeAttempt = clientOcrAttempt(dto);
    const nativeOcr = nativeAttempt.result;
    const serverOcr = this.asServerOcr(
      await this.ocrService.extractText(absolutePath, {
        documentType: 'bill',
      }),
      nativeOcr ? 'ML_KIT_SERVER_CONSENSUS' : nativeAttempt.fallbackReason,
    );

    // Printed bills are cheap enough to evaluate with both local engines. Merge
    // their row candidates so one plausible native row cannot hide richer
    // server geometry, while retaining the native result if the sidecar is down.
    const nativeCandidates = nativeOcr?.success
      ? this.billCapture.extractCandidates(nativeOcr)
      : [];
    const serverCandidates = serverOcr.success
      ? this.billCapture.extractCandidates(serverOcr)
      : [];
    const parsedCandidates = this.mergeBillCandidates(
      serverCandidates,
      nativeCandidates,
    );
    const ocrResult = serverOcr.success ? serverOcr : (nativeOcr ?? serverOcr);
    const candidates = await this.resolveBillCandidates(parsedCandidates);

    this.logger.log(
      'Bill OCR diagnostics ' +
        JSON.stringify({
          source: ocrResult.source ?? 'NO_RESULT',
          success: ocrResult.success,
          textLength: ocrResult.rawText.length,
          blockCount: ocrResult.diagnostics?.blockCount ?? 0,
          lineCount: ocrResult.lines?.length ?? 0,
          elementCount: ocrResult.diagnostics?.elementCount ?? 0,
          fallbackReason: ocrResult.fallbackReason ?? null,
          processingMs: ocrResult.diagnostics?.processingMs ?? 0,
          nativeCandidateCount: nativeCandidates.length,
          serverCandidateCount: serverCandidates.length,
          mergedCandidateCount: parsedCandidates.length,
          resolvedCandidateCount: candidates.length,
          strongMatchCount: candidates.filter(
            (candidate) => candidate.resolverOutcome.kind === 'STRONG',
          ).length,
          possibleMatchCount: candidates.filter(
            (candidate) => candidate.resolverOutcome.kind === 'POSSIBLE',
          ).length,
          unknownMatchCount: candidates.filter(
            (candidate) => candidate.resolverOutcome.kind === 'UNKNOWN',
          ).length,
        }),
    );

    // 5. Update bill with OCR result
    const updatedBill = await this.prisma.bill.update({
      where: { id: bill.id },
      data: {
        rawOcrText: ocrResult.rawText || null,
        status: ocrResult.success
          ? DocumentStatus.OCR_PROCESSED
          : DocumentStatus.FAILED,
      },
    });

    // 6. Store unconfirmed extracted medicines
    let extractedMedicines: Awaited<
      ReturnType<typeof this.prisma.extractedMedicine.create>
    >[] = [];
    if (ocrResult.success && candidates.length > 0) {
      extractedMedicines = await Promise.all(
        candidates.map((candidate) =>
          this.prisma.extractedMedicine.create({
            data: (() => {
              const identityMatch =
                candidate.resolverOutcome.kind === 'UNKNOWN'
                  ? undefined
                  : candidate.masterMatches[0];
              return {
                userId,
                billId: bill.id,
                medicineName: candidate.rawName,
                dosage: candidate.extractedStrength,
                quantity: candidate.quantity,
                confidenceScore: candidate.confidence,
                reasons: [
                  `billLine:${candidate.billLine}`,
                  `resolver:${candidate.resolverOutcome.kind}`,
                  ...(candidate.extractedPack
                    ? [`pack:${candidate.extractedPack}`]
                    : []),
                ],
                verificationSource: 'BILL_CAPTURE',
                brandName: identityMatch?.brandName,
                genericName:
                  identityMatch?.genericName ?? identityMatch?.composition,
                strength: candidate.extractedStrength,
                verificationStatus:
                  candidate.resolverOutcome.kind === 'UNKNOWN'
                    ? VerificationStatus.NEEDS_REVIEW
                    : VerificationStatus.VERIFY_REQUIRED,
                isConfirmed: false, // SAFETY: always starts unconfirmed
                isUserConfirmed: false,
                isActiveMedication: false,
                resolutionState:
                  candidate.resolverOutcome.kind === 'UNKNOWN'
                    ? ResolutionState.UNKNOWN
                    : ResolutionState.REVIEW,
                verificationExecutionStatus:
                  VerificationExecutionStatus.COMPLETED,
              };
            })(),
          }),
        ),
      );
    }

    await this.auditLogs.log({
      userId,
      action: ocrResult.success ? 'OCR_PROCESSED' : 'OCR_FAILED',
      entityType: 'Bill',
      entityId: bill.id,
      newValues: {
        confidence: ocrResult.confidence,
        engine: ocrResult.engine,
        candidatesFound: candidates.length,
        ocrError: ocrResult.error,
      },
    });

    return {
      bill: {
        ...updatedBill,
        fileUrl: this.buildBillFileUrl(updatedBill.id),
        localPath: undefined,
      },
      ocr: {
        success: ocrResult.success,
        confidence: ocrResult.confidence,
        engine: ocrResult.engine,
        wordsCount: ocrResult.wordsCount,
        rawText: ocrResult.rawText || null,
        error: ocrResult.error || null,
        safetyNotice:
          'OCR extraction from bills is approximate. ' +
          'Please review quantities carefully before confirming.',
      },
      extractedMedicines: extractedMedicines.map((m) => ({
        id: m.id,
        medicineName: m.medicineName,
        dosage: m.dosage,
        quantity: m.quantity,
        confidenceScore: m.confidenceScore,
        isConfirmed: false,
        capture:
          candidates.find(
            (candidate) => candidate.rawName === m.medicineName,
          ) ?? null,
      })),
      billCandidates: candidates,
    };
  }

  // ─────────────────────────────────────────────────────────
  // CONFIRM: patient confirms purchased medicines
  // Updates medicine stock + creates RefillLog entries
  // ─────────────────────────────────────────────────────────
  async confirm(userId: string, billId: string, dto: ConfirmBillDto) {
    const bill = await this.findOne(userId, billId);

    if (bill.status === DocumentStatus.CONFIRMED) {
      throw new BadRequestException('This bill has already been confirmed.');
    }

    if (!dto.medicines || dto.medicines.length === 0) {
      throw new BadRequestException(
        'At least one medicine must be provided for confirmation.',
      );
    }

    const refillResults: {
      medicineName: string;
      medicineId: string | null;
      quantityUpdated: boolean;
      refillLogId: string | null;
      expectedFinishDate: string | null;
      refillReminderDate: string | null;
      reviewQueued?: boolean;
    }[] = [];
    const reviewQueue: Array<{
      normalizedKey: string | null;
      rawName: string;
      strength?: string;
      form?: string;
      billLine?: string;
    }> = [];

    await this.prisma.$transaction(async (tx) => {
      for (const item of dto.medicines) {
        const result = await this.processBillMedicine(tx, userId, billId, item);
        refillResults.push(result);
        if (result.reviewQueued) {
          reviewQueue.push({
            normalizedKey: this.medicinesService.buildCaptureReviewKey({
              type: 'UNKNOWN_MANUAL',
              source: 'BILL',
              rawName: item.medicineName,
              strength: item.strength,
              form: item.form,
            }),
            rawName: item.medicineName,
            strength: item.strength,
            form: item.form,
            billLine: item.billLine,
          });
        }
      }

      // Update bill metadata from confirmation
      await tx.bill.update({
        where: { id: billId },
        data: {
          status: DocumentStatus.CONFIRMED,
          pharmacyName: dto.pharmacyName ?? bill.pharmacyName,
          purchaseDate: dto.purchaseDate
            ? new Date(dto.purchaseDate)
            : bill.purchaseDate,
          totalAmount: dto.totalAmount ?? bill.totalAmount,
        },
      });
    });

    await this.auditLogs.log({
      userId,
      action: 'BILL_CONFIRMED',
      entityType: 'Bill',
      entityId: billId,
      newValues: {
        medicinesProcessed: refillResults.length,
        medicines: refillResults.map((r) => r.medicineName),
      },
    });

    for (const review of reviewQueue) {
      await this.medicinesService.queueCaptureReview({
        type: 'UNKNOWN_MANUAL',
        submittedById: userId,
        normalizedKey: review.normalizedKey,
        source: 'BILL',
        rawName: review.rawName,
        strength: review.strength,
        form: review.form,
        billLine: review.billLine,
        payload: {
          source: 'bill_confirm_unknown',
          billId,
        },
      });
    }

    this.logger.log(
      `Bill ${billId} confirmed — ${refillResults.length} medicine(s) processed`,
    );

    return {
      billId,
      status: 'CONFIRMED',
      medicines: refillResults,
      message: `${refillResults.length} medicine(s) processed. Stock quantities and refill predictions updated.`,
    };
  }

  // ─────────────────────────────────────────────────────────
  // LIST
  // ─────────────────────────────────────────────────────────
  async findAll(userId: string, page = 1, limit = 20) {
    const skip = (page - 1) * limit;

    const [total, bills] = await Promise.all([
      this.prisma.bill.count({ where: { userId } }),
      this.prisma.bill.findMany({
        where: { userId },
        skip,
        take: Math.min(limit, 50),
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          fileName: true,
          storedName: true,
          mimeType: true,
          fileSize: true,
          pharmacyName: true,
          purchaseDate: true,
          totalAmount: true,
          status: true,
          notes: true,
          createdAt: true,
          updatedAt: true,
          _count: { select: { extractedMedicines: true } },
        },
      }),
    ]);

    return {
      data: bills.map((b) => ({
        ...b,
        fileUrl: this.buildBillFileUrl(b.id),
      })),
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }

  // ─────────────────────────────────────────────────────────
  // GET ONE
  // ─────────────────────────────────────────────────────────
  async findOne(userId: string, id: string) {
    const bill = await this.prisma.bill.findUnique({
      where: { id },
      include: {
        extractedMedicines: { orderBy: { createdAt: 'asc' } },
      },
    });

    if (!bill) throw new NotFoundException('Bill not found');
    if (bill.userId !== userId) {
      throw new ForbiddenException('You do not have access to this bill');
    }

    return {
      ...bill,
      fileUrl: this.buildBillFileUrl(bill.id),
      localPath: undefined,
    };
  }

  // ─────────────────────────────────────────────────────────
  // INTERNAL: process a single confirmed bill medicine
  // Updates stock + creates RefillLog if dailyUsage provided
  // ─────────────────────────────────────────────────────────
  async getFile(userId: string, id: string) {
    const bill = await this.prisma.bill.findUnique({ where: { id } });

    if (!bill) throw new NotFoundException('Bill not found');
    if (bill.userId !== userId) {
      throw new ForbiddenException('You do not have access to this bill');
    }

    const absolutePath = join(process.cwd(), bill.localPath);
    if (!existsSync(absolutePath)) {
      throw new NotFoundException('Bill file not found');
    }

    return {
      stream: createReadStream(absolutePath),
      mimeType: bill.mimeType,
      fileName: bill.fileName,
      fileSize: bill.fileSize,
    };
  }

  private asServerOcr(result: OcrResult, fallbackReason?: string): OcrResult {
    return {
      ...result,
      source: result.success && result.rawText ? 'SERVER_OCR' : 'NO_RESULT',
      fallbackReason:
        result.success && result.rawText
          ? fallbackReason
          : (result.fallbackReason ?? fallbackReason ?? 'SERVER_OCR_NO_RESULT'),
      diagnostics: {
        textLength: result.rawText.length,
        blockCount: result.diagnostics?.blockCount ?? 0,
        lineCount: result.lines?.length ?? 0,
        elementCount: result.diagnostics?.elementCount ?? 0,
        processingMs: result.diagnostics?.processingMs ?? 0,
      },
    };
  }

  private mergeBillCandidates(
    ...candidateGroups: BillLineCandidate[][]
  ): BillLineCandidate[] {
    const merged = new Map<string, BillLineCandidate>();

    for (const candidate of candidateGroups.flat()) {
      const key = `${this.normalizeBillKey(candidate.rawName)}:${this.normalizeBillKey(candidate.extractedStrength ?? '')}`;
      const existing = merged.get(key);
      if (!existing) {
        merged.set(key, candidate);
        continue;
      }

      merged.set(key, {
        ...existing,
        billLine:
          candidate.billLine.length > existing.billLine.length
            ? candidate.billLine
            : existing.billLine,
        extractedStrength:
          existing.extractedStrength ?? candidate.extractedStrength,
        extractedPack: existing.extractedPack ?? candidate.extractedPack,
        quantity: existing.quantity ?? candidate.quantity,
      });
    }

    return Array.from(merged.values());
  }

  private normalizeBillKey(value: string) {
    return value.toLowerCase().replace(/[^a-z0-9]+/g, '');
  }

  private buildBillFileUrl(billId: string) {
    const baseUrl = process.env.API_BASE_URL ?? 'http://localhost:3001';
    return `${baseUrl}/api/bills/${billId}/file`;
  }

  private async resolveBillCandidates(candidates: BillLineCandidate[]) {
    const resolved: Array<
      BillLineCandidate & {
        source: 'BILL';
        confidence: number;
        resolverOutcome: ReturnType<MedicineResolverService['classify']>;
        masterMatches: BillMasterMatch[];
      }
    > = [];

    for (const candidate of candidates) {
      const matchesById = new Map<string, BillMasterMatch>();
      const identityById = new Map<string, BillMasterMatch>();
      const searchTerms = this.billCapture.buildMasterSearchTerms(candidate);

      for (const term of searchTerms) {
        const matches = (await this.medicinesService.searchMaster(
          term,
          6,
        )) as BillMasterMatch[];
        for (const match of matches) {
          const existing = matchesById.get(match.id);
          if (!existing || (match.score ?? 0) > (existing.score ?? 0)) {
            matchesById.set(match.id, match);
          }
          if (
            this.isBrandAlignedBillMatch(term, match) &&
            this.isStrengthCompatibleBillMatch(candidate, match)
          ) {
            const identity = identityById.get(match.id);
            if (!identity || (match.score ?? 0) > (identity.score ?? 0)) {
              identityById.set(match.id, match);
            }
          }
        }

        if (
          Array.from(identityById.values()).some(
            (match) => (match.score ?? 0) >= 0.99,
          )
        ) {
          break;
        }
      }

      const identityMatches = Array.from(identityById.values())
        .sort((left, right) => (right.score ?? 0) - (left.score ?? 0))
        .slice(0, 6);
      const identityIds = new Set(identityMatches.map((match) => match.id));
      const masterMatches = [
        ...identityMatches,
        ...Array.from(matchesById.values())
          .filter((match) => !identityIds.has(match.id))
          .sort((left, right) => (right.score ?? 0) - (left.score ?? 0)),
      ].slice(0, 6);
      const resolverOutcome = this.resolver.classify({
        rawName: candidate.rawName,
        source: 'BILL',
        extractedStrength: candidate.extractedStrength,
        extractedPack: candidate.extractedPack,
        billLine: candidate.billLine,
        possibleMasterMatches: identityMatches.map((match) => ({
          masterId: match.id,
          score: match.score ?? 0,
        })),
      });

      resolved.push({
        ...candidate,
        source: 'BILL',
        confidence: identityMatches[0]?.score ?? 0,
        resolverOutcome,
        masterMatches,
      });
    }

    return resolved;
  }

  private isBrandAlignedBillMatch(term: string, match: BillMasterMatch) {
    const candidate = this.normalizeIdentity(term);
    const brand = this.normalizeIdentity(match.brandName ?? '');
    if (candidate.length < 4 || brand.length < 4) return false;
    if (candidate.includes(brand) || brand.includes(candidate)) return true;

    const longest = Math.max(candidate.length, brand.length);
    if (
      Math.abs(candidate.length - brand.length) >
      Math.max(2, Math.ceil(longest * 0.2))
    ) {
      return false;
    }
    return 1 - this.identityEditDistance(candidate, brand) / longest >= 0.82;
  }

  private isStrengthCompatibleBillMatch(
    candidate: BillLineCandidate,
    match: BillMasterMatch,
  ) {
    const captured = this.extractStrengthSignatures(
      candidate.extractedStrength ?? candidate.rawName,
    );
    if (!captured.length) return true;

    const master = this.extractStrengthSignatures(
      [
        match.strength,
        match.brandName,
        match.composition,
        match.genericName,
        match.saltProfile?.displayName,
      ]
        .filter(Boolean)
        .join(' '),
    );
    if (!master.length) return true;
    return captured.every((strength) => master.includes(strength));
  }

  private extractStrengthSignatures(value: string) {
    return Array.from(
      new Set(
        Array.from(
          value.matchAll(
            /\b(\d+(?:\.\d+)?)\s*(mg|mcg|ug|g|gm|ml|iu|units?|%)\b/gi,
          ),
        ).map((match) => {
          const unit = match[2]
            .toLowerCase()
            .replace(/^ug$/, 'mcg')
            .replace(/^gm$/, 'g');
          return `${Number(match[1])}${unit}`;
        }),
      ),
    );
  }

  private normalizeIdentity(value: string) {
    return value
      .toLowerCase()
      .replace(
        /(\d+(?:\.\d+)?)\s*(?:mg|mcg|ug|g|gm|ml|iu|units?)(?=\b|\/)/g,
        '$1',
      )
      .replace(/[^a-z0-9]+/g, '');
  }

  private identityEditDistance(left: string, right: string) {
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

  private formFromBillItem(
    item: ConfirmedBillMedicineDto,
    fallbackType?: string | null,
  ) {
    if (item.form) return item.form;

    const text =
      `${item.medicineName} ${item.billLine ?? ''} ${fallbackType ?? ''}`.toLowerCase();

    if (/\b(cap|caps|capsule)\b/.test(text)) return MedicineForm.CAPSULE;
    if (/\b(syrup|syp)\b/.test(text)) return MedicineForm.SYRUP;
    if (/\b(inj|injection|vial|ampoule)\b/.test(text))
      return MedicineForm.INJECTION;
    if (/\b(drop|drops)\b/.test(text)) return MedicineForm.DROPS;
    if (/\b(cream)\b/.test(text)) return MedicineForm.CREAM;
    if (/\b(oint|ointment)\b/.test(text)) return MedicineForm.OINTMENT;
    if (/\b(powder|sachet)\b/.test(text)) return MedicineForm.POWDER;

    return MedicineForm.TABLET;
  }

  private defaultUnitForForm(form: MedicineForm) {
    const units: Partial<Record<MedicineForm, string>> = {
      [MedicineForm.TABLET]: 'tablets',
      [MedicineForm.CAPSULE]: 'capsules',
      [MedicineForm.SYRUP]: 'ml',
      [MedicineForm.INJECTION]: 'units',
      [MedicineForm.DROPS]: 'ml',
      [MedicineForm.CREAM]: 'g',
      [MedicineForm.OINTMENT]: 'g',
      [MedicineForm.POWDER]: 'sachets',
    };

    return units[form] ?? 'units';
  }

  private async processBillMedicine(
    tx: Parameters<Parameters<typeof this.prisma.$transaction>[0]>[0],
    userId: string,
    billId: string,
    item: ConfirmedBillMedicineDto,
  ) {
    let medicineId: string | null = item.medicineId ?? null;
    let quantityUpdated = false;
    let refillLogId: string | null = null;
    let expectedFinishDate: string | null = null;
    let refillReminderDate: string | null = null;
    let reviewQueued = false;

    // 1. Update medicine stock if linked to existing medicine
    if (medicineId) {
      const medicine = await tx.medicine.findUnique({
        where: { id: medicineId },
      });
      if (medicine && medicine.userId === userId) {
        await this.incrementMedicineStock(
          tx,
          medicine.id,
          item.quantityPurchased,
        );
        quantityUpdated = true;
      } else {
        // Medicine not found or ownership mismatch — proceed without update
        medicineId = null;
      }
    }

    if (!medicineId) {
      const linked = await this.resolveOrCreateMedicineFromBillLine(
        tx,
        userId,
        item,
      );
      medicineId = linked.medicineId;
      quantityUpdated = true;
      reviewQueued = linked.reviewQueued;
    }

    // 2. Create RefillLog if dailyUsage is provided
    if (medicineId && item.dailyUsage && item.dailyUsage > 0) {
      const daysUntilEmpty = Math.floor(
        item.quantityPurchased / item.dailyUsage,
      );
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const finishDate = new Date(today);
      finishDate.setDate(finishDate.getDate() + daysUntilEmpty);

      const reminderDate = new Date(finishDate);
      reminderDate.setDate(
        reminderDate.getDate() - REFILL_REMINDER_BUFFER_DAYS,
      );

      // If reminder would be in the past, set to today + 1
      if (reminderDate <= today) {
        reminderDate.setDate(today.getDate() + 1);
      }

      const refillLog = await tx.refillLog.create({
        data: {
          userId,
          medicineId,
          totalQuantity: item.quantityPurchased,
          dailyUsage: item.dailyUsage,
          remainingQuantity: item.quantityPurchased,
          expectedFinishDate: finishDate,
          refillReminderDate: reminderDate,
          notes: `Created from bill ${billId}`,
        },
      });

      refillLogId = refillLog.id;
      expectedFinishDate = finishDate.toISOString().split('T')[0];
      refillReminderDate = reminderDate.toISOString().split('T')[0];
    }

    // 3. Mark extracted medicine confirmed if linked
    await tx.extractedMedicine.updateMany({
      where: {
        userId,
        billId,
        isConfirmed: false,
        ...(item.extractedMedicineId
          ? { id: item.extractedMedicineId }
          : { medicineName: item.medicineName }),
      },
      data: {
        isConfirmed: true,
        confirmedAt: new Date(),
        quantity: item.quantityPurchased,
        createdMedicineId: medicineId,
        resolutionState: ResolutionState.PURCHASE_CONFIRMED,
        isUserConfirmed: false,
        isActiveMedication: false,
      },
    });

    return {
      medicineName: item.medicineName,
      medicineId,
      quantityUpdated,
      refillLogId,
      expectedFinishDate,
      refillReminderDate,
      reviewQueued,
    };
  }

  private async incrementMedicineStock(
    tx: Parameters<Parameters<typeof this.prisma.$transaction>[0]>[0],
    medicineId: string,
    quantity: number,
  ) {
    const medicine = await tx.medicine.findUnique({
      where: { id: medicineId },
    });
    if (!medicine) return;

    await tx.medicine.update({
      where: { id: medicineId },
      data: {
        remainingQuantity: (medicine.remainingQuantity ?? 0) + quantity,
        totalQuantity: (medicine.totalQuantity ?? 0) + quantity,
        lastStockAlertLevel: null,
        lastStockAlertAt: null,
      },
    });
  }

  private async resolveOrCreateMedicineFromBillLine(
    tx: Parameters<Parameters<typeof this.prisma.$transaction>[0]>[0],
    userId: string,
    item: ConfirmedBillMedicineDto,
  ) {
    let medicineMasterId = item.medicineMasterId || null;
    let medicinePackageId = item.medicinePackageId || null;

    if (medicinePackageId) {
      const pack = await tx.medicinePackage.findFirst({
        where: {
          id: medicinePackageId,
          medicine: { isArchived: false },
        },
        select: { id: true, medicineId: true, isDemo: true },
      });

      if (!pack || pack.isDemo) {
        throw new BadRequestException(
          'Selected bill medicine package was not found.',
        );
      }

      if (medicineMasterId && medicineMasterId !== pack.medicineId) {
        throw new BadRequestException(
          'Selected bill medicine package does not belong to the selected master.',
        );
      }

      medicineMasterId = pack.medicineId;
      medicinePackageId = pack.id;
    }

    if (medicineMasterId) {
      const master = await tx.medicineMaster.findFirst({
        where: { id: medicineMasterId, isArchived: false },
        select: {
          id: true,
          brandName: true,
          genericName: true,
          composition: true,
          strength: true,
          type: true,
        },
      });

      if (!master) {
        throw new BadRequestException(
          'Selected bill medicine master was not found.',
        );
      }

      const existing = await tx.medicine.findFirst({
        where: { userId, medicineMasterId: master.id, isActive: true },
        orderBy: { createdAt: 'asc' },
      });

      if (existing) {
        await this.incrementMedicineStock(
          tx,
          existing.id,
          item.quantityPurchased,
        );
        return { medicineId: existing.id, reviewQueued: false };
      }

      const form = this.formFromBillItem(item, master.type);
      const created = await tx.medicine.create({
        data: {
          userId,
          medicineMasterId: master.id,
          medicinePackageId,
          name: master.brandName,
          brandName: master.brandName,
          genericName: master.genericName ?? master.composition,
          form,
          strength: item.strength ?? master.strength,
          unit: item.unit ?? this.defaultUnitForForm(form),
          remainingQuantity: item.quantityPurchased,
          totalQuantity: item.quantityPurchased,
          source: 'BILL',
          visualConfirmed: false,
          notes:
            `Created from bill ${item.billLine ? `line: ${item.billLine}` : ''}`.trim(),
        },
      });

      return { medicineId: created.id, reviewQueued: false };
    }

    const form = this.formFromBillItem(item);
    const captureReviewKey = this.medicinesService.buildCaptureReviewKey({
      type: 'UNKNOWN_MANUAL',
      source: 'BILL',
      rawName: item.medicineName,
      strength: item.strength,
      form,
    });
    const existingUnknown = captureReviewKey
      ? await tx.medicine.findFirst({
          where: { userId, medicineMasterId: null, captureReviewKey },
          orderBy: { createdAt: 'asc' },
        })
      : null;

    if (existingUnknown) {
      await this.incrementMedicineStock(
        tx,
        existingUnknown.id,
        item.quantityPurchased,
      );
      return { medicineId: existingUnknown.id, reviewQueued: true };
    }

    const createdUnknown = await tx.medicine.create({
      data: {
        userId,
        name: item.medicineName,
        brandName: item.medicineName,
        form,
        strength: item.strength,
        unit: item.unit ?? this.defaultUnitForForm(form),
        remainingQuantity: item.quantityPurchased,
        totalQuantity: item.quantityPurchased,
        source: 'BILL',
        visualConfirmed: false,
        captureReviewKey,
        notes: `Unverified medicine created from bill${
          item.billLine ? ` line: ${item.billLine}` : ''
        }`,
      },
    });

    return { medicineId: createdUnknown.id, reviewQueued: true };
  }

  // ── DELETE: remove bill and extracted suggestions ──
  async remove(userId: string, id: string) {
    const bill = await this.prisma.bill.findUnique({
      where: { id },
    });
    if (!bill) {
      throw new NotFoundException('Bill not found');
    }
    if (bill.userId !== userId) {
      throw new ForbiddenException(
        'You do not have permission to delete this bill',
      );
    }

    // Delete associated extracted medicines first
    await this.prisma.extractedMedicine.deleteMany({
      where: { billId: id },
    });

    // Delete the bill record
    await this.prisma.bill.delete({
      where: { id },
    });

    await this.auditLogs.log({
      userId,
      action: 'DELETED',
      entityType: 'Bill',
      entityId: id,
      newValues: { fileName: bill.fileName },
    });

    return { success: true };
  }
}
