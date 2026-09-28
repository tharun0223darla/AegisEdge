import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiProduces,
  ApiTags,
} from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { CurrentUserPayload } from '../common/decorators/current-user.decorator';
import { Public } from '../common/decorators/public.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { UserRole } from '../common/enums/userrole.enum';
import {
  ComposeDoctorReportDto,
  CreateDoctorReportShareDto,
  SharedDoctorReportTokenDto,
} from './dto/doctor-report.dto';
import { DoctorReportsService } from './doctor-reports.service';

@ApiTags('Doctor visit reports')
@ApiBearerAuth('JWT-auth')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.PATIENT)
@Controller('doctor-reports')
export class DoctorReportsController {
  constructor(private readonly reports: DoctorReportsService) {}

  @Post('preview')
  @Throttle({ default: { limit: 12, ttl: 60_000 } })
  @ApiOperation({ summary: 'Preview a deterministic doctor visit report' })
  preview(
    @CurrentUser() user: CurrentUserPayload,
    @Body() dto: ComposeDoctorReportDto,
  ) {
    return this.reports.preview(user.sub, dto);
  }

  @Post()
  @Throttle({ default: { limit: 8, ttl: 60_000 } })
  @ApiOperation({ summary: 'Create an immutable doctor visit report snapshot' })
  create(
    @CurrentUser() user: CurrentUserPayload,
    @Body() dto: ComposeDoctorReportDto,
    @Req() request: Request,
  ) {
    return this.reports.create(user.sub, dto, this.auditContext(request));
  }

  @Get()
  @ApiOperation({ summary: 'List my immutable doctor visit reports' })
  list(@CurrentUser() user: CurrentUserPayload) {
    return this.reports.list(user.sub);
  }

  @Get(':reportId')
  @ApiOperation({ summary: 'Get one of my doctor visit reports' })
  get(
    @CurrentUser() user: CurrentUserPayload,
    @Param('reportId') reportId: string,
  ) {
    return this.reports.get(user.sub, reportId);
  }

  @Delete(':reportId')
  @ApiOperation({
    summary: 'Archive my immutable report and revoke all of its links',
  })
  archive(
    @CurrentUser() user: CurrentUserPayload,
    @Param('reportId') reportId: string,
    @Req() request: Request,
  ) {
    return this.reports.archive(user.sub, reportId, this.auditContext(request));
  }

  @Get(':reportId/pdf')
  @ApiProduces('application/pdf')
  @ApiOperation({ summary: 'Download my immutable report as a PDF' })
  async download(
    @CurrentUser() user: CurrentUserPayload,
    @Param('reportId') reportId: string,
    @Res() response: Response,
  ) {
    const file = await this.reports.ownerPdf(user.sub, reportId);
    this.sendPdf(response, file.fileName, file.content);
  }

  @Post(':reportId/shares')
  @Throttle({ default: { limit: 8, ttl: 60_000 } })
  @ApiOperation({ summary: 'Create an expiring private report link' })
  createShare(
    @CurrentUser() user: CurrentUserPayload,
    @Param('reportId') reportId: string,
    @Body() dto: CreateDoctorReportShareDto,
    @Req() request: Request,
  ) {
    return this.reports.createShare(
      user.sub,
      reportId,
      dto,
      this.auditContext(request),
    );
  }

  @Delete(':reportId/shares/:shareId')
  @ApiOperation({ summary: 'Immediately revoke a private report link' })
  revokeShare(
    @CurrentUser() user: CurrentUserPayload,
    @Param('reportId') reportId: string,
    @Param('shareId') shareId: string,
    @Req() request: Request,
  ) {
    return this.reports.revokeShare(
      user.sub,
      reportId,
      shareId,
      this.auditContext(request),
    );
  }

  @Get(':reportId/access-history')
  @ApiOperation({ summary: 'Review link access history for my report' })
  accessHistory(
    @CurrentUser() user: CurrentUserPayload,
    @Param('reportId') reportId: string,
  ) {
    return this.reports.accessHistory(user.sub, reportId);
  }

  private auditContext(request: Request) {
    return {
      ipAddress: request.ip,
      userAgent: request.get('user-agent'),
    };
  }

  private sendPdf(response: Response, fileName: string, content: Buffer) {
    response.set({
      'Content-Type': 'application/pdf',
      'Content-Length': String(content.length),
      'Content-Disposition': `attachment; filename="${fileName}"`,
      'Cache-Control': 'private, no-store, max-age=0',
      Pragma: 'no-cache',
      'X-Content-Type-Options': 'nosniff',
    });
    response.end(content);
  }
}

@ApiTags('Shared doctor visit reports')
@Public()
@Controller('shared-reports')
export class SharedDoctorReportsController {
  constructor(private readonly reports: DoctorReportsService) {}

  @Post('view')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @ApiOperation({ summary: 'Open a valid expiring doctor report link' })
  async view(
    @Body() dto: SharedDoctorReportTokenDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    this.secureSharedResponse(response);
    return this.reports.sharedView(dto.token);
  }

  @Post('pdf')
  @Throttle({ default: { limit: 12, ttl: 60_000 } })
  @ApiProduces('application/pdf')
  @ApiOperation({ summary: 'Download a valid shared report PDF' })
  async download(
    @Body() dto: SharedDoctorReportTokenDto,
    @Res() response: Response,
  ) {
    this.secureSharedResponse(response);
    const file = await this.reports.sharedPdf(dto.token);
    response.set({
      'Content-Type': 'application/pdf',
      'Content-Length': String(file.content.length),
      'Content-Disposition': `attachment; filename="${file.fileName}"`,
    });
    response.end(file.content);
  }

  private secureSharedResponse(response: Response) {
    response.set({
      'Cache-Control': 'private, no-store, max-age=0',
      Pragma: 'no-cache',
      'Referrer-Policy': 'no-referrer',
      'X-Content-Type-Options': 'nosniff',
      'X-Robots-Tag': 'noindex, nofollow, noarchive',
    });
  }
}
