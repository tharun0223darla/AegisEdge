import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Param,
  Query,
  UseGuards,
  DefaultValuePipe,
  ParseIntPipe,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiQuery,
} from '@nestjs/swagger';
import { DoseStatus } from '@prisma/client';
import { DoseLogsService } from './dose-logs.service';
import { CreateDoseLogDto } from './dto/create-dose-log.dto';
import { RecordDoseBarrierDto } from './dto/record-dose-barrier.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { CurrentUserPayload } from '../common/decorators/current-user.decorator';
import { UserRole } from '../common/enums/userrole.enum';

@ApiTags('Dose Logs')
@ApiBearerAuth('JWT-auth')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.PATIENT)
@Controller('dose-logs')
export class DoseLogsController {
  constructor(private readonly doseLogsService: DoseLogsService) {}

  // ── POST /api/v1/dose-logs ────────────────────────────────
  // Patient records a dose action: TAKEN, MISSED, SNOOZED, SKIPPED
  @Post()
  @ApiOperation({
    summary: 'Record a dose action (TAKEN / MISSED / SNOOZED / SKIPPED)',
    description:
      'Called when a patient responds to a reminder. ' +
      'Provide the scheduleId, the exact scheduledAt time, and the action status.',
  })
  recordAction(
    @CurrentUser() user: CurrentUserPayload,
    @Body() dto: CreateDoseLogDto,
  ) {
    return this.doseLogsService.recordAction(user.sub, dto);
  }

  @Post('reconcile')
  @ApiOperation({
    summary: 'Reconcile overdue pending doses for the signed-in patient',
  })
  reconcile(@CurrentUser() user: CurrentUserPayload) {
    return this.doseLogsService.reconcileOverdueForUser(user.sub);
  }

  // ── GET /api/v1/dose-logs ─────────────────────────────────
  @Get()
  @ApiOperation({
    summary: 'List my dose logs (paginated, filterable)',
  })
  @ApiQuery({ name: 'page', required: false, type: Number, example: 1 })
  @ApiQuery({ name: 'limit', required: false, type: Number, example: 20 })
  @ApiQuery({
    name: 'status',
    required: false,
    enum: DoseStatus,
    description: 'Filter by dose status',
  })
  @ApiQuery({
    name: 'medicineId',
    required: false,
    type: String,
    description: 'Filter by a specific medicine',
  })
  @ApiQuery({
    name: 'from',
    required: false,
    type: String,
    description: 'ISO date — start of range (e.g. 2024-01-01)',
  })
  @ApiQuery({
    name: 'to',
    required: false,
    type: String,
    description: 'ISO date — end of range (e.g. 2024-01-31)',
  })
  findAll(
    @CurrentUser() user: CurrentUserPayload,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number,
    @Query('status') status?: DoseStatus,
    @Query('medicineId') medicineId?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.doseLogsService.findAll(user.sub, {
      page,
      limit: Math.min(limit, 100),
      status,
      medicineId,
      from,
      to,
    });
  }

  // ── GET /api/v1/dose-logs/pending ─────────────────────────
  @Get('pending')
  @ApiOperation({
    summary: 'Get upcoming doses due in the next 15 minutes (for reminders)',
  })
  getPendingForReminder(@CurrentUser() user: CurrentUserPayload) {
    return this.doseLogsService.getPendingDosesForReminder(user.sub);
  }

  @Get('barriers/summary')
  @ApiOperation({
    summary: 'Summarize my structured missed-dose and skipped-dose barriers',
    description:
      'Returns patient-owned adherence patterns and non-clinical next steps. It never recommends changing a medicine or dose.',
  })
  @ApiQuery({ name: 'days', required: false, type: Number, example: 30 })
  barrierSummary(
    @CurrentUser() user: CurrentUserPayload,
    @Query('days', new DefaultValuePipe(30), ParseIntPipe) days: number,
  ) {
    return this.doseLogsService.barrierSummary(user.sub, days);
  }

  @Patch(':id/barrier')
  @ApiOperation({
    summary: 'Record why my missed or skipped dose was not taken',
  })
  recordBarrier(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id') id: string,
    @Body() dto: RecordDoseBarrierDto,
  ) {
    return this.doseLogsService.recordBarrierReason(user.sub, id, dto.reason);
  }

  // ── GET /api/v1/dose-logs/:id ─────────────────────────────
  @Get(':id')
  @ApiOperation({ summary: 'Get a single dose log by id' })
  findOne(@CurrentUser() user: CurrentUserPayload, @Param('id') id: string) {
    return this.doseLogsService.findOne(user.sub, id);
  }
}
