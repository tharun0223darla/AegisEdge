import {
  Controller,
  Post,
  Get,
  Delete,
  Param,
  Body,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  Query,
  DefaultValuePipe,
  ParseIntPipe,
  BadRequestException,
  HttpCode,
  HttpStatus,
  Res,
  StreamableFile,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiConsumes,
  ApiBody,
  ApiQuery,
  ApiResponse,
} from '@nestjs/swagger';
import { PrescriptionsService } from './prescriptions.service';
import { CreatePrescriptionDto } from './dto/create-prescription.dto';
import { ConfirmPrescriptionDto } from './dto/confirm-prescription.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { CurrentUserPayload } from '../common/decorators/current-user.decorator';
import { UserRole } from '../common/enums/userrole.enum';
import type { Response } from 'express';
import {
  medicalFileFilter,
  buildDiskStorage,
  MAX_FILE_SIZE_BYTES,
} from '../common/utils/file-upload.util';

@ApiTags('Prescriptions')
@ApiBearerAuth('JWT-auth')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.PATIENT)
@Controller('prescriptions')
export class PrescriptionsController {
  constructor(private readonly prescriptionsService: PrescriptionsService) {}

  // ── POST /api/v1/prescriptions/upload ─────────────────────
  @Post('upload')
  @HttpCode(HttpStatus.CREATED)
  @UseInterceptors(
    FileInterceptor('file', {
      storage: buildDiskStorage('prescriptions'),
      fileFilter: medicalFileFilter,
      limits: { fileSize: MAX_FILE_SIZE_BYTES },
    }),
  )
  @ApiOperation({
    summary: 'Upload a prescription image/PDF and run OCR extraction',
    description:
      '**Step 1 of 2**: Upload your prescription. ' +
      'The system will extract medicine information using OCR. ' +
      '\n\n⚕️ **Safety**: OCR results are stored as unconfirmed suggestions only. ' +
      'No medicines or schedules are created until you confirm in Step 2. ' +
      '\n\n**Accepted**: JPG, PNG, PDF | **Max size**: 5MB',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file'],
      properties: {
        file: {
          type: 'string',
          format: 'binary',
          description: 'Prescription image (JPG/PNG) or PDF',
        },
        doctorName: { type: 'string', example: 'Dr. Priya Sharma' },
        prescribedAt: { type: 'string', example: '2024-01-15' },
        notes: { type: 'string', example: 'Apollo Hospital visit' },
      },
    },
  })
  @ApiResponse({ status: 201, description: 'File uploaded and vision extraction queued' })
  @ApiResponse({ status: 400, description: 'Invalid file type or size' })
  async upload(
    @CurrentUser() user: CurrentUserPayload,
    @UploadedFile() file: Express.Multer.File,
    @Body() dto: CreatePrescriptionDto,
  ) {
    if (!file) {
      throw new BadRequestException(
        'No file uploaded. Please attach a JPG, PNG, or PDF file.',
      );
    }
    return this.prescriptionsService.upload(user.sub, file, dto);
  }

  // ── GET /api/v1/prescriptions ──────────────────────────────
  @Get()
  @ApiOperation({ summary: 'List all my uploaded prescriptions' })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  findAll(
    @CurrentUser() user: CurrentUserPayload,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number,
  ) {
    return this.prescriptionsService.findAll(user.sub, page, Math.min(limit, 50));
  }

  // ── GET /api/v1/prescriptions/:id ─────────────────────────
  @Get(':id/file')
  @ApiOperation({ summary: 'Download a prescription file after owner authorization' })
  async getFile(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id') id: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const file = await this.prescriptionsService.getFile(user.sub, id);
    res.setHeader('Content-Type', file.mimeType);
    res.setHeader('Content-Length', String(file.fileSize));
    res.setHeader(
      'Content-Disposition',
      `inline; filename="${file.fileName.replace(/"/g, '')}"`,
    );
    res.setHeader('Cache-Control', 'private, no-store');
    return new StreamableFile(file.stream);
  }
  @Get(':id')
  @ApiOperation({
    summary: 'Get a prescription with its OCR-extracted medicine candidates',
  })
  findOne(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id') id: string,
  ) {
    return this.prescriptionsService.findOne(user.sub, id);
  }

  // ── POST /api/v1/prescriptions/:id/confirm ────────────────

  @Post(':id/vision-review')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary: 'Queue prescription vision processing',
    description:
      'Creates or returns an active background vision job. ' +
      'The request returns immediately; all extracted rows require human review.',
  })
  @ApiResponse({
    status: 202,
    description: 'Vision processing job queued successfully',
  })
  @ApiResponse({
    status: 404,
    description: 'Prescription not found',
  })
  runVisionReview(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id') id: string,
  ) {
    return this.prescriptionsService.runVisionReview(
      user.sub,
      id,
    );
  }

  @Get(':id/vision-review')
  @ApiOperation({
    summary: 'Get the latest vision job for a prescription',
  })
  @ApiResponse({
    status: 200,
    description: 'Latest vision job returned successfully',
  })
  getLatestVisionReviewJob(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id') id: string,
  ) {
    return this.prescriptionsService.getLatestVisionReviewJob(
      user.sub,
      id,
    );
  }

  @Get(':id/vision-review/:jobId')
  @ApiOperation({
    summary: 'Get a specific prescription vision job',
  })
  @ApiResponse({
    status: 200,
    description: 'Vision job status returned successfully',
  })
  getVisionReviewJob(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id') id: string,
    @Param('jobId') jobId: string,
  ) {
    return this.prescriptionsService.getVisionReviewJob(
      user.sub,
      id,
      jobId,
    );
  }

  @Post(':id/confirm')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Step 2: Confirm reviewed medicines — creates Medicine + Schedule records',
    description:
      '**Step 2 of 2**: After reviewing the OCR output, confirm the medicines you want to add. ' +
      '\n\n⚕️ **Safety Rules**:' +
      '\n- Only YOU can confirm your prescriptions' +
      '\n- Medicine records are created only after your explicit confirmation' +
      '\n- Always follow your doctor\'s actual prescription — correct any OCR errors before confirming' +
      '\n- Do not change dosage or frequency from what your doctor prescribed',
  })
  @ApiResponse({ status: 200, description: 'Prescription confirmed and medicines created' })
  @ApiResponse({ status: 400, description: 'Prescription already confirmed or invalid data' })
  confirm(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id') id: string,
    @Body() dto: ConfirmPrescriptionDto,
  ) {
    return this.prescriptionsService.confirm(user.sub, id, dto);
  }

  // ── DELETE /api/v1/prescriptions/:id ──────────────────────
  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Delete prescription and suggestions' })
  @ApiResponse({ status: 200, description: 'Prescription deleted successfully' })
  @ApiResponse({ status: 404, description: 'Prescription not found' })
  remove(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id') id: string,
  ) {
    return this.prescriptionsService.remove(user.sub, id);
  }
}
