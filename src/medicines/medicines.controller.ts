import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  BadRequestException,
  DefaultValuePipe,
  ParseIntPipe,
  ParseBoolPipe,
  Res,
  StreamableFile,
  Logger,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiQuery,
  ApiConsumes,
  ApiBody,
} from '@nestjs/swagger';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { existsSync, mkdirSync, unlinkSync } from 'fs';
import { randomUUID } from 'crypto';
import { extname, join } from 'path';
import sharp from 'sharp';
import { MedicinesService } from './medicines.service';
import { MedicineImportService } from './medicine-import.service';
import { PackageImageCaptureService } from './capture/package-image-capture.service';
import { CreateMedicineDto } from './dto/create-medicine.dto';
import { UpdateMedicineDto } from './dto/update-medicine.dto';
import { ResolveMedicineReviewDto } from './dto/resolve-medicine-review.dto';
import { AdminClinicalDetailsDto } from './dto/admin-clinical-details.dto';
import { VerifyMedicineStripDto } from './dto/verify-medicine-strip.dto';
import type { MedicineCandidate } from './capture/medicine-candidate';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { CurrentUserPayload } from '../common/decorators/current-user.decorator';
import { UserRole } from '../common/enums/userrole.enum';
import { OcrService } from '../ocr/ocr.service';
import type { OcrResult } from '../ocr/ocr.service';
import {
  clientOcrAttempt,
  type ClientOcrAttempt,
  type ClientOcrFields,
} from '../ocr/client-ocr-result.util';
import {
  buildRelativePath,
  MAX_FILE_SIZE_BYTES,
} from '../common/utils/file-upload.util';
import type { Response } from 'express';

const MEDICINE_IMPORT_UPLOAD_DIR = join(
  process.cwd(),
  'uploads',
  'medicine-imports',
);
const PACKAGE_IMAGE_UPLOAD_DIR = join(
  process.cwd(),
  'uploads',
  'package-images',
);
const STRIP_VERIFY_UPLOAD_DIR = join(process.cwd(), 'uploads', 'tmp');

function ensureMedicineImportUploadDir() {
  if (!existsSync(MEDICINE_IMPORT_UPLOAD_DIR)) {
    mkdirSync(MEDICINE_IMPORT_UPLOAD_DIR, { recursive: true });
  }
}

function ensurePackageImageUploadDir() {
  if (!existsSync(PACKAGE_IMAGE_UPLOAD_DIR)) {
    mkdirSync(PACKAGE_IMAGE_UPLOAD_DIR, { recursive: true });
  }
}

function ensureStripVerifyUploadDir() {
  if (!existsSync(STRIP_VERIFY_UPLOAD_DIR)) {
    mkdirSync(STRIP_VERIFY_UPLOAD_DIR, { recursive: true });
  }
}

const medicineImportStorage = diskStorage({
  destination: (_req, _file, callback) => {
    ensureMedicineImportUploadDir();
    callback(null, MEDICINE_IMPORT_UPLOAD_DIR);
  },
  filename: (_req, file, callback) => {
    callback(
      null,
      `${randomUUID()}${extname(file.originalname).toLowerCase()}`,
    );
  },
});

const packageImageStorage = diskStorage({
  destination: (_req, _file, callback) => {
    ensurePackageImageUploadDir();
    callback(null, PACKAGE_IMAGE_UPLOAD_DIR);
  },
  filename: (_req, file, callback) => {
    callback(
      null,
      `${randomUUID()}${extname(file.originalname).toLowerCase()}`,
    );
  },
});

const stripVerifyImageStorage = diskStorage({
  destination: (_req, _file, callback) => {
    ensureStripVerifyUploadDir();
    callback(null, STRIP_VERIFY_UPLOAD_DIR);
  },
  filename: (_req, file, callback) => {
    callback(
      null,
      `strip-verify-${randomUUID()}${extname(file.originalname).toLowerCase()}`,
    );
  },
});

function medicineImportFileFilter(
  _req: Express.Request,
  file: Express.Multer.File,
  callback: (error: Error | null, acceptFile: boolean) => void,
) {
  const ext = extname(file.originalname).toLowerCase();

  if (ext !== '.csv') {
    callback(
      new BadRequestException(
        'Only CSV medicine imports are supported here. XLSX needs the separate streaming parser path.',
      ),
      false,
    );
    return;
  }

  callback(null, true);
}

function packageImageFileFilter(
  _req: Express.Request,
  file: Express.Multer.File,
  callback: (error: Error | null, acceptFile: boolean) => void,
) {
  const ext = extname(file.originalname).toLowerCase();
  const allowedMimeTypes = ['image/jpeg', 'image/jpg', 'image/png'];
  const allowedExtensions = ['.jpg', '.jpeg', '.png'];

  if (
    !allowedMimeTypes.includes(file.mimetype) ||
    !allowedExtensions.includes(ext)
  ) {
    callback(
      new BadRequestException('Only JPG and PNG package photos are accepted.'),
      false,
    );
    return;
  }

  callback(null, true);
}

@ApiTags('Medicines')
@ApiBearerAuth('JWT-auth')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.PATIENT)
@Controller('medicines')
export class MedicinesController {
  private readonly logger = new Logger(MedicinesController.name);

  constructor(
    private readonly medicinesService: MedicinesService,
    private readonly medicineImportService: MedicineImportService,
    private readonly ocrService: OcrService,
    private readonly packageImageCapture: PackageImageCaptureService,
  ) {}

  @Post()
  @ApiOperation({ summary: 'Add a new medicine manually' })
  create(
    @CurrentUser() user: CurrentUserPayload,
    @Body() dto: CreateMedicineDto,
  ) {
    return this.medicinesService.create(user.sub, dto);
  }

  @Get()
  @ApiOperation({ summary: 'List all my medicines' })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiQuery({ name: 'activeOnly', required: false, type: Boolean })
  findAll(
    @CurrentUser() user: CurrentUserPayload,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number,
    @Query('activeOnly', new DefaultValuePipe(false), ParseBoolPipe)
    activeOnly: boolean,
  ) {
    return this.medicinesService.findAll(
      user.sub,
      page,
      Math.min(limit, 100),
      activeOnly,
    );
  }

  @Get('master/search')
  @Roles(UserRole.PATIENT, UserRole.ADMIN)
  @ApiOperation({
    summary: 'Search Medicine Master for manual entry/typeahead',
  })
  @ApiQuery({ name: 'q', required: true, type: String })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  searchMaster(
    @Query('q') query: string,
    @Query('limit', new DefaultValuePipe(8), ParseIntPipe) limit: number,
  ) {
    return this.medicinesService.searchMaster(query ?? '', limit);
  }

  @Post('capture/resolve')
  @Roles(UserRole.PATIENT, UserRole.ADMIN)
  @ApiOperation({
    summary: 'Resolve a captured medicine candidate through the shared matcher',
  })
  resolveCandidate(@Body() candidate: MedicineCandidate) {
    return this.medicinesService.resolveCandidate(candidate);
  }

  @Get('master/barcode/:gtin')
  @Roles(UserRole.PATIENT, UserRole.ADMIN)
  @ApiOperation({
    summary: 'Lookup a verified medicine package by barcode/GTIN',
  })
  findByBarcode(@Param('gtin') gtin: string) {
    return this.medicinesService.findByBarcode(gtin);
  }

  @Post('master/barcode/:gtin/review')
  @Roles(UserRole.PATIENT, UserRole.ADMIN)
  @ApiOperation({ summary: 'Queue an unknown barcode for admin verification' })
  reportUnknownBarcode(
    @CurrentUser() user: CurrentUserPayload,
    @Param('gtin') gtin: string,
    @Body('userStripImageUrl') userStripImageUrl?: string,
  ) {
    return this.medicinesService.reportUnknownBarcode(user.sub, gtin, {
      userStripImageUrl,
    });
  }

  @Post('package-image/capture')
  @Roles(UserRole.PATIENT, UserRole.ADMIN)
  @UseInterceptors(
    FileInterceptor('file', {
      storage: packageImageStorage,
      fileFilter: packageImageFileFilter,
      limits: { fileSize: MAX_FILE_SIZE_BYTES },
    }),
  )
  @ApiOperation({
    summary: 'Capture a medicine candidate from a package or strip image',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: { type: 'string', format: 'binary' },
      },
      required: ['file'],
    },
  })
  async capturePackageImage(
    @UploadedFile() file: Express.Multer.File,
    @Body() body: ClientOcrFields,
  ) {
    if (!file) {
      throw new BadRequestException('No package image uploaded.');
    }

    const relativePath = buildRelativePath('package-images', file.filename);
    const absolutePath = join(process.cwd(), relativePath);
    const imageUrl = this.medicinesService.buildPackageImageUrl(file.filename);
    const nativeAttempt = clientOcrAttempt(body);
    const { ocrResult, parsed } = await this.extractPackageImageCandidate(
      absolutePath,
      nativeAttempt,
    );
    this.logPackageOcrDiagnostics(ocrResult);
    const candidate = parsed
      ? await this.medicinesService.resolvePackageImageCandidate(
          parsed,
          imageUrl,
        )
      : null;

    return {
      image: {
        fileName: file.originalname,
        storedName: file.filename,
        mimeType: file.mimetype,
        fileSize: file.size,
        imageUrl,
      },
      ocr: {
        success: ocrResult.success,
        source: ocrResult.source ?? 'NO_RESULT',
        fallbackReason: ocrResult.fallbackReason || null,
        confidence: ocrResult.confidence,
        wordsCount: ocrResult.wordsCount,
        rawText: ocrResult.rawText || null,
        engine: ocrResult.engine,
        diagnostics: ocrResult.diagnostics,
        error: ocrResult.error || null,
      },
      candidate,
      reviewRequired:
        !candidate ||
        candidate.weak ||
        candidate.resolverOutcome.kind !== 'STRONG',
      message: candidate
        ? 'Package image candidate extracted. Please confirm before saving.'
        : 'Unable to read medicine strip. Please retake the photo.',
    };
  }

  private async extractPackageImageCandidate(
    absolutePath: string,
    nativeAttempt: ClientOcrAttempt,
  ) {
    const nativeOcr = nativeAttempt.result;
    const nativeParsed = nativeOcr?.success
      ? this.packageImageCapture.extractCandidate(nativeOcr)
      : null;
    if (
      nativeOcr &&
      !this.packageImageCapture.isLowQualityCandidate(nativeParsed)
    ) {
      return { ocrResult: nativeOcr, parsed: nativeParsed };
    }

    const fallbackReason =
      nativeOcr && nativeParsed
        ? 'ML_KIT_LOW_QUALITY'
        : (nativeAttempt.fallbackReason ?? 'ML_KIT_NO_RESULT');

    const original = await this.runServerPackageOcr(
      absolutePath,
      fallbackReason,
    );
    const originalParsed = original.success
      ? this.packageImageCapture.extractCandidate(original)
      : null;

    if (!this.packageImageCapture.isLowQualityCandidate(originalParsed)) {
      return { ocrResult: original, parsed: originalParsed };
    }

    // PP-OCRv6 already evaluates bounded contrast and illumination variants.
    // Re-uploading a Sharp-enhanced copy would repeat the model work and can
    // turn compression artifacts into false text without adding new evidence.
    if (original.engine === 'paddleocr') {
      return this.pickPackageOcrResult(
        ...(nativeOcr ? [{ ocrResult: nativeOcr, parsed: nativeParsed }] : []),
        { ocrResult: original, parsed: originalParsed },
      );
    }

    const enhancedPath = await this.createEnhancedPackageOcrImage(absolutePath);

    try {
      const enhanced = await this.runServerPackageOcr(
        enhancedPath,
        fallbackReason,
      );
      const combined = this.combineOcrResults(
        [nativeOcr, original, enhanced].filter((result): result is OcrResult =>
          Boolean(result),
        ),
      );
      const combinedParsed = combined.success
        ? this.packageImageCapture.extractCandidate(combined)
        : null;

      return this.pickPackageOcrResult(
        ...(nativeOcr ? [{ ocrResult: nativeOcr, parsed: nativeParsed }] : []),
        { ocrResult: original, parsed: originalParsed },
        {
          ocrResult: enhanced,
          parsed: enhanced.success
            ? this.packageImageCapture.extractCandidate(enhanced)
            : null,
        },
        { ocrResult: combined, parsed: combinedParsed },
      );
    } finally {
      try {
        unlinkSync(enhancedPath);
      } catch {
        // Best-effort cleanup for OCR variant.
      }
    }
  }

  private async runServerPackageOcr(
    absolutePath: string,
    fallbackReason: string,
  ): Promise<OcrResult> {
    const startedAt = Date.now();
    const result = await this.ocrService.extractPackagePhotoText(absolutePath);
    const success = Boolean(result.success && result.rawText.trim());
    return {
      ...result,
      success,
      source: success ? 'SERVER_OCR' : 'NO_RESULT',
      fallbackReason: success
        ? fallbackReason
        : `${result.fallbackReason ?? 'SERVER_OCR_NO_RESULT'}_AFTER_${fallbackReason}`,
      diagnostics: {
        textLength: result.rawText.length,
        blockCount: result.diagnostics?.blockCount ?? 0,
        lineCount: result.lines?.length ?? 0,
        elementCount: result.diagnostics?.elementCount ?? 0,
        processingMs: Date.now() - startedAt,
      },
    };
  }

  private logPackageOcrDiagnostics(result: OcrResult) {
    this.logger.log(
      'Package OCR diagnostics ' +
        JSON.stringify({
          source: result.source ?? 'NO_RESULT',
          success: result.success,
          textLength: result.rawText.length,
          blockCount: result.diagnostics?.blockCount ?? 0,
          lineCount: result.diagnostics?.lineCount ?? result.lines?.length ?? 0,
          elementCount: result.diagnostics?.elementCount ?? 0,
          fallbackReason: result.fallbackReason ?? null,
          processingMs: result.diagnostics?.processingMs ?? 0,
        }),
    );
  }

  private async createEnhancedPackageOcrImage(absolutePath: string) {
    const variantPath = absolutePath.replace(
      /\.[^.]+$/,
      `.ocr-${randomUUID()}.jpg`,
    );

    await sharp(absolutePath)
      .rotate()
      .resize({ width: 2200, withoutEnlargement: false })
      .grayscale()
      .clahe({ width: 3, height: 3, maxSlope: 3 })
      .sharpen({ sigma: 1.2, m1: 1, m2: 2 })
      .jpeg({ quality: 95 })
      .toFile(variantPath);

    return variantPath;
  }

  private combineOcrResults(results: OcrResult[]): OcrResult {
    const successful = results.filter((result) => result.success);
    const rawLines = new Map<string, string>();
    const structuredLines = successful.flatMap((result) => result.lines ?? []);

    for (const result of successful) {
      for (const line of result.rawText.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (trimmed) rawLines.set(trimmed.toLowerCase(), trimmed);
      }
    }

    const rawText = Array.from(rawLines.values()).join('\n');
    const confidence = successful.length
      ? Math.max(...successful.map((result) => result.confidence))
      : 0;
    const serverResult = successful.find(
      (result) => result.source === 'SERVER_OCR',
    );

    return {
      success: successful.length > 0,
      rawText,
      confidence,
      wordsCount: rawText.split(/\s+/).filter(Boolean).length,
      engine: serverResult?.engine ?? successful[0]?.engine,
      source: serverResult
        ? 'SERVER_OCR'
        : (successful[0]?.source ?? 'NO_RESULT'),
      fallbackReason:
        serverResult?.fallbackReason ?? successful[0]?.fallbackReason,
      diagnostics: {
        textLength: rawText.length,
        blockCount: Math.max(
          0,
          ...successful.map((result) => result.diagnostics?.blockCount ?? 0),
        ),
        lineCount: structuredLines.length,
        elementCount: Math.max(
          0,
          ...successful.map((result) => result.diagnostics?.elementCount ?? 0),
        ),
        processingMs: successful.reduce(
          (sum, result) => sum + (result.diagnostics?.processingMs ?? 0),
          0,
        ),
      },
      lines: structuredLines,
      error: successful.length
        ? undefined
        : results
            .map((result) => result.error)
            .filter(Boolean)
            .join('; '),
    };
  }

  private pickPackageOcrResult(
    ...choices: Array<{
      ocrResult: OcrResult;
      parsed: ReturnType<PackageImageCaptureService['extractCandidate']>;
    }>
  ) {
    const eligible = choices.filter(
      (choice) =>
        choice.ocrResult.success &&
        choice.ocrResult.source !== 'NO_RESULT' &&
        choice.parsed !== null &&
        this.packageImageCapture.isReviewableCandidate(choice.parsed),
    );

    if (eligible.length > 0) {
      return eligible.sort(
        (left, right) =>
          this.packageOcrChoiceScore(right) - this.packageOcrChoiceScore(left),
      )[0];
    }

    const diagnosticAttempt = [...choices].sort(
      (left, right) =>
        (right.ocrResult.diagnostics?.textLength ??
          right.ocrResult.rawText.length) -
        (left.ocrResult.diagnostics?.textLength ??
          left.ocrResult.rawText.length),
    )[0];
    const hadRecognizedText = choices.some(
      (choice) => choice.ocrResult.success && choice.ocrResult.rawText.trim(),
    );

    return {
      ocrResult: {
        success: false,
        rawText: '',
        confidence: 0,
        wordsCount: 0,
        engine: diagnosticAttempt?.ocrResult.engine,
        source: 'NO_RESULT' as const,
        fallbackReason: hadRecognizedText
          ? 'OCR_QUALITY_REJECTED'
          : (diagnosticAttempt?.ocrResult.fallbackReason ?? 'OCR_NO_RESULT'),
        diagnostics: diagnosticAttempt?.ocrResult.diagnostics ?? {
          textLength: 0,
          blockCount: 0,
          lineCount: 0,
          elementCount: 0,
          processingMs: 0,
        },
        error: 'OCR output did not meet the medicine-strip quality threshold.',
      },
      parsed: null,
    };
  }

  private packageOcrChoiceScore(choice: {
    ocrResult: OcrResult;
    parsed: ReturnType<PackageImageCaptureService['extractCandidate']>;
  }) {
    if (!choice.parsed) return choice.ocrResult.success ? 0.1 : 0;
    const rawName = choice.parsed.rawName.trim();
    const tokens = rawName.split(/\s+/).filter(Boolean);
    const compact = rawName.replace(/[^a-z0-9]/gi, '');
    const isCompactBrand =
      tokens.length <= 2 &&
      compact.length >= 4 &&
      compact.length <= 24 &&
      /[a-z]/i.test(compact);
    const hasBrandShape =
      /[a-z][A-Z]/.test(rawName) ||
      /\d/.test(compact) ||
      /(?:xt|sr|cr|xr|cv|lb|ds|plus|forte)$/i.test(compact);
    const longGarbagePenalty =
      tokens.length > 3 ||
      (/^[A-Z0-9\s.-]+$/.test(rawName) && rawName.length > 10)
        ? 2
        : 0;

    return (
      (isCompactBrand ? 3 : 0) +
      (hasBrandShape ? 1.2 : 0) +
      (this.packageImageCapture.isLowQualityCandidate(choice.parsed) ? 0 : 2) +
      (choice.parsed.weak ? -0.25 : 1) +
      choice.parsed.ocrConfidence +
      Math.min(compact.length / 20, 1) -
      longGarbagePenalty
    );
  }

  @Post(':id/verify-strip')
  @Roles(UserRole.PATIENT, UserRole.ADMIN)
  @ApiOperation({
    summary: 'Verify current on-device strip OCR against a saved medicine',
  })
  verifyStripText(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id') id: string,
    @Body() dto: VerifyMedicineStripDto,
  ) {
    return this.medicinesService.verifyStripText(user.sub, id, dto);
  }

  @Post(':id/verify-strip-image')
  @Roles(UserRole.PATIENT, UserRole.ADMIN)
  @UseInterceptors(
    FileInterceptor('file', {
      storage: stripVerifyImageStorage,
      fileFilter: packageImageFileFilter,
      limits: { fileSize: MAX_FILE_SIZE_BYTES },
    }),
  )
  @ApiConsumes('multipart/form-data')
  @ApiOperation({
    summary: 'Server OCR fallback for a one-time strip verification image',
  })
  async verifyStripImage(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!file) throw new BadRequestException('No strip image uploaded.');

    let enhancedPath: string | null = null;
    try {
      // 1. Create enhanced high-contrast variant for blister pack foil recognition
      enhancedPath = `${file.path}.enhanced.png`;
      try {
        await sharp(file.path)
          .rotate()
          .resize({ width: 1800, withoutEnlargement: false })
          .grayscale()
          .normalize()
          .sharpen({ sigma: 1.5 })
          .png()
          .toFile(enhancedPath);
      } catch {
        enhancedPath = null;
      }

      // 2. Run OCR directly on enhanced image or original image
      let ocr = enhancedPath
        ? await this.ocrService.extractText(enhancedPath, { documentType: 'package' })
        : await this.ocrService.extractText(file.path, { documentType: 'package' });

      // If enhanced returned empty or low confidence, also try original file
      if (!ocr.rawText || !ocr.rawText.trim()) {
        const rawOcr = await this.ocrService.extractText(file.path, {
          documentType: 'package',
        });
        if (rawOcr.rawText && rawOcr.rawText.trim().length > 0) {
          ocr = rawOcr;
        }
      }

      this.logPackageOcrDiagnostics(ocr);
      this.logger.log(
        `[Strip Verification OCR] id=${id}, engine=${ocr.engine}, conf=${ocr.confidence}%, extractedText="${ocr.rawText.replace(/\r?\n/g, ' ')}"`,
      );
      return this.medicinesService.verifyStripText(user.sub, id, {
        ocrText: ocr.rawText,
        ocrConfidence: ocr.confidence,
        engine: ocr.engine ?? 'server-ocr',
      });
    } finally {
      if (enhancedPath) {
        try {
          unlinkSync(enhancedPath);
        } catch {
          // Best-effort cleanup
        }
      }
      try {
        unlinkSync(file.path);
      } catch {
        // Verification frames are deliberately ephemeral.
      }
    }
  }

  @Get('package-image/:storedName')
  @Roles(UserRole.PATIENT, UserRole.ADMIN)
  @ApiOperation({
    summary: 'Read a private package/strip image after authorization',
  })
  async getPackageImage(
    @CurrentUser() user: CurrentUserPayload,
    @Param('storedName') storedName: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const file = await this.medicinesService.getPackageImageFile(
      user,
      storedName,
    );
    res.setHeader('Content-Type', file.mimeType);
    res.setHeader(
      'Content-Disposition',
      `inline; filename="${file.fileName.replace(/"/g, '')}"`,
    );
    res.setHeader('Cache-Control', 'private, no-store');
    return new StreamableFile(file.stream);
  }

  @Post('master/:id/request-details')
  @Roles(UserRole.PATIENT, UserRole.ADMIN)
  @ApiOperation({
    summary:
      'Request trusted clinical details for an incomplete Medicine Master salt',
  })
  requestMasterClinicalDetails(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id') id: string,
    @Body('medicinePackageId') medicinePackageId?: string,
  ) {
    return this.medicinesService.requestMasterClinicalDetails(
      user.sub,
      id,
      medicinePackageId,
    );
  }
  @Get('master/:id')
  @Roles(UserRole.PATIENT, UserRole.ADMIN)
  @ApiOperation({
    summary: 'Get Medicine Master detail and patient-friendly enrichment',
  })
  getMaster(@Param('id') id: string) {
    return this.medicinesService.getMaster(id);
  }

  @Get('admin/reviews')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Admin: list medicine master/package review queue' })
  @ApiQuery({ name: 'status', required: false, type: String })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiQuery({ name: 'type', required: false, type: String })
  listReviews(
    @Query('status', new DefaultValuePipe('OPEN')) status: string,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number,
    @Query('type') type?: string,
  ) {
    return this.medicinesService.listReviews(status, page, limit, type);
  }

  @Post('admin/reviews/:id/web-source-assist')
  @Roles(UserRole.ADMIN)
  @ApiOperation({
    summary: 'Admin: search trusted web sources for clinical detail draft',
  })
  assistReviewWebSources(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id') id: string,
    @Body('refresh') refresh?: boolean,
  ) {
    return this.medicinesService.assistReviewWebSources(user.sub, id, {
      refresh: Boolean(refresh),
    });
  }
  @Patch('admin/reviews/:id/clinical-details')
  @Roles(UserRole.ADMIN)
  @ApiOperation({
    summary: 'Admin: add trusted clinical details for a salt review request',
  })
  updateReviewClinicalDetails(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id') id: string,
    @Body() dto: AdminClinicalDetailsDto,
  ) {
    return this.medicinesService.updateReviewClinicalDetails(user.sub, id, dto);
  }
  @Patch('admin/reviews/:id/resolve')
  @Roles(UserRole.ADMIN)
  @ApiOperation({
    summary: 'Admin: link, verify, or reject a medicine review item',
  })
  resolveReview(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id') id: string,
    @Body() dto: ResolveMedicineReviewDto,
  ) {
    return this.medicinesService.resolveReview(user.sub, id, dto);
  }

  @Get('admin/imports')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Admin: list medicine import batches' })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  listImports(
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number,
  ) {
    return this.medicineImportService.list(page, limit);
  }

  @Post('admin/imports/upload')
  @Roles(UserRole.ADMIN)
  @UseInterceptors(
    FileInterceptor('file', {
      storage: medicineImportStorage,
      fileFilter: medicineImportFileFilter,
      limits: { fileSize: 25 * 1024 * 1024 },
    }),
  )
  @ApiOperation({
    summary: 'Admin: upload CSV to stage Medicine Master import',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: { type: 'string', format: 'binary' },
        datasetName: { type: 'string' },
        datasetVersion: { type: 'string' },
      },
      required: ['file'],
    },
  })
  uploadMedicineImport(
    @CurrentUser() user: CurrentUserPayload,
    @UploadedFile() file: Express.Multer.File,
    @Body('datasetName') datasetName?: string,
    @Body('datasetVersion') datasetVersion?: string,
  ) {
    return this.medicineImportService.ingestUpload(user.sub, file, {
      datasetName,
      datasetVersion,
    });
  }

  @Get('admin/imports/:batchId/preview')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Admin: preview staged medicine import batch' })
  previewMedicineImport(@Param('batchId') batchId: string) {
    return this.medicineImportService.preview(batchId);
  }

  @Post('admin/imports/:batchId/commit')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Admin: commit staged medicine import batch' })
  @ApiQuery({ name: 'batchSize', required: false, type: Number })
  commitMedicineImport(
    @CurrentUser() user: CurrentUserPayload,
    @Param('batchId') batchId: string,
    @Query('batchSize', new DefaultValuePipe(1000), ParseIntPipe)
    batchSize: number,
  ) {
    return this.medicineImportService.commit(user.sub, batchId, batchSize);
  }

  @Post('admin/imports/:batchId/discard')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Admin: discard staged medicine import batch' })
  discardMedicineImport(
    @CurrentUser() user: CurrentUserPayload,
    @Param('batchId') batchId: string,
  ) {
    return this.medicineImportService.discard(user.sub, batchId);
  }

  @Post(':id/request-details')
  @Roles(UserRole.PATIENT, UserRole.ADMIN)
  @ApiOperation({
    summary: 'Request trusted clinical details for an incomplete medicine salt',
  })
  requestClinicalDetails(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id') id: string,
  ) {
    return this.medicinesService.requestClinicalDetails(user.sub, id);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a specific medicine by id' })
  findOne(@CurrentUser() user: CurrentUserPayload, @Param('id') id: string) {
    return this.medicinesService.findOne(user.sub, id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a medicine' })
  update(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id') id: string,
    @Body() dto: UpdateMedicineDto,
  ) {
    return this.medicinesService.update(user.sub, id, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete or deactivate a medicine' })
  @ApiQuery({ name: 'permanent', required: false, type: Boolean })
  deactivate(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id') id: string,
    @Query('permanent') permanent?: string,
  ) {
    const isPermanent = permanent !== 'false';
    return this.medicinesService.deactivate(user.sub, id, isPermanent);
  }
}
