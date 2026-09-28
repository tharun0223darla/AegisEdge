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
import { BillsService } from './bills.service';
import { CreateBillDto } from './dto/create-bill.dto';
import { ConfirmBillDto } from './dto/confirm-bill.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { CurrentUserPayload } from '../common/decorators/current-user.decorator';
import type { Response } from 'express';
import { UserRole } from '../common/enums/userrole.enum';
import {
  medicalFileFilter,
  buildDiskStorage,
  MAX_FILE_SIZE_BYTES,
} from '../common/utils/file-upload.util';

@ApiTags('Bills')
@ApiBearerAuth('JWT-auth')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.PATIENT)
@Controller('bills')
export class BillsController {
  constructor(private readonly billsService: BillsService) {}

  // ── POST /api/v1/bills/upload ──────────────────────────────
  @Post('upload')
  @HttpCode(HttpStatus.CREATED)
  @UseInterceptors(
    FileInterceptor('file', {
      storage: buildDiskStorage('bills'),
      fileFilter: medicalFileFilter,
      limits: { fileSize: MAX_FILE_SIZE_BYTES },
    }),
  )
  @ApiOperation({
    summary: 'Upload a pharmacy bill and run OCR extraction',
    description:
      'Upload your pharmacy receipt or bill. ' +
      'OCR will extract medicine names and quantities. ' +
      '\n\nResults require your confirmation before updating stock. ' +
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
          description: 'Bill/receipt image (JPG/PNG) or PDF',
        },
        pharmacyName: { type: 'string', example: 'Apollo Pharmacy' },
        purchaseDate: { type: 'string', example: '2024-01-15' },
        totalAmount: { type: 'number', example: 850.5 },
        notes: { type: 'string', example: 'January refill' },
      },
    },
  })
  @ApiResponse({ status: 201, description: 'Bill uploaded and OCR complete' })
  @ApiResponse({ status: 400, description: 'Invalid file type or size' })
  async upload(
    @CurrentUser() user: CurrentUserPayload,
    @UploadedFile() file: Express.Multer.File,
    @Body() dto: CreateBillDto,
  ) {
    if (!file) {
      throw new BadRequestException(
        'No file uploaded. Please attach a JPG, PNG, or PDF file.',
      );
    }
    return this.billsService.upload(user.sub, file, dto);
  }

  // ── GET /api/v1/bills ──────────────────────────────────────
  @Get()
  @ApiOperation({ summary: 'List all my uploaded bills' })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  findAll(
    @CurrentUser() user: CurrentUserPayload,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number,
  ) {
    return this.billsService.findAll(user.sub, page, Math.min(limit, 50));
  }

  // ── GET /api/v1/bills/:id ──────────────────────────────────
  @Get(':id/file')
  @ApiOperation({ summary: 'Download a bill file after owner/admin authorization' })
  async getFile(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id') id: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const file = await this.billsService.getFile(user.sub, id);
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
  @ApiOperation({ summary: 'Get a bill with its OCR-extracted medicine candidates' })
  findOne(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id') id: string,
  ) {
    return this.billsService.findOne(user.sub, id);
  }

  // ── POST /api/v1/bills/:id/confirm ────────────────────────
  @Post(':id/confirm')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Confirm purchased medicines — updates stock quantities and refill predictions',
    description:
      'After reviewing OCR results, confirm the medicines you purchased. ' +
      'This updates remaining stock and calculates when you will need a refill. ' +
      '\n\n⚕️ Link each confirmed medicine to an existing medicine in your list ' +
      'using medicineId for accurate stock tracking.',
  })
  @ApiResponse({ status: 200, description: 'Bill confirmed and stock updated' })
  confirm(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id') id: string,
    @Body() dto: ConfirmBillDto,
  ) {
    return this.billsService.confirm(user.sub, id, dto);
  }

  // ── DELETE /api/v1/bills/:id ──────────────────────────────
  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Delete a bill' })
  @ApiResponse({ status: 200, description: 'Bill deleted successfully' })
  @ApiResponse({ status: 404, description: 'Bill not found' })
  remove(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id') id: string,
  ) {
    return this.billsService.remove(user.sub, id);
  }
}
