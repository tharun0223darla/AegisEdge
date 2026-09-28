import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  Query,
  UseGuards,
  DefaultValuePipe,
  ParseIntPipe,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiQuery,
  ApiResponse,
  ApiParam,
} from '@nestjs/swagger';
import { RemindersService } from './reminders.service';
import { SnoozeReminderDto } from './dto/snooze-remainder.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { CurrentUserPayload } from '../common/decorators/current-user.decorator';
import { UserRole } from '../common/enums/userrole.enum';

@ApiTags('Reminders')
@ApiBearerAuth('JWT-auth')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.PATIENT)
@Controller('reminders')
export class RemindersController {
  constructor(private readonly remindersService: RemindersService) {}

  // ── GET /api/v1/reminders/today ───────────────────────────
  @Get('today')
  @ApiOperation({
    summary: "Today's full medicine timeline — ordered chronologically",
    description:
      'Returns all dose events for today including past (TAKEN/MISSED) and ' +
      'future (PENDING/SNOOZED) doses with reminder status enrichment. ' +
      'Includes a summary count for the home screen widget.',
  })
  @ApiResponse({ status: 200, description: "Today's timeline with summary" })
  @ApiQuery({ name: 'timezone', required: false, type: String })
  getTodayTimeline(
    @CurrentUser() user: CurrentUserPayload,
    @Query('timezone', new DefaultValuePipe('UTC')) timezone: string,
  ) {
    return this.remindersService.getTodayTimeline(user.sub, timezone);
  }

  // ── GET /api/v1/reminders/due-now ─────────────────────────
  @Get('due-now')
  @ApiOperation({
    summary: 'Doses due right now (±5 min) + expired snoozes',
    description:
      'Returns PENDING doses within ±5 minutes of the current time, ' +
      'and any SNOOZED doses whose snoozeUntil has passed. ' +
      'Mobile app should poll this every minute to drive local notifications.',
  })
  getDueNow(@CurrentUser() user: CurrentUserPayload) {
    return this.remindersService.getDueNow(user.sub);
  }

  // ── GET /api/v1/reminders/upcoming ────────────────────────
  @Get('upcoming')
  @ApiOperation({
    summary: 'Upcoming scheduled doses in the next N hours',
    description:
      'Returns future PENDING doses starting from 5 minutes from now. ' +
      'Used for the upcoming reminders list on the home screen.',
  })
  @ApiQuery({
    name: 'hours',
    required: false,
    type: Number,
    description: 'Hours to look ahead (1–48, default: 24)',
  })
  getUpcoming(
    @CurrentUser() user: CurrentUserPayload,
    @Query('hours', new DefaultValuePipe(24), ParseIntPipe) hours: number,
  ) {
    const safeHours = Math.min(Math.max(hours, 1), 48);
    return this.remindersService.getUpcoming(user.sub, safeHours);
  }

  // ── GET /api/v1/reminders/overdue ─────────────────────────
  @Get('overdue')
  @ApiOperation({
    summary: 'Overdue doses that have passed their grace period',
    description:
      'Returns PENDING doses that are past scheduledAt + grace period. ' +
      'These are still actionable — patient can mark TAKEN or they will ' +
      'be auto-marked MISSED by the hourly cron job.',
  })
  getOverdue(@CurrentUser() user: CurrentUserPayload) {
    return this.remindersService.getOverdue(user.sub);
  }

  // ── GET /api/v1/reminders/weekly ──────────────────────────
  @Get('weekly')
  @ApiOperation({
    summary: '7-day adherence overview for the weekly summary screen',
    description:
      'Returns day-by-day adherence status for the past 7 days. ' +
      'Each day shows: full / partial / none / no_doses status. ' +
      'Used for the weekly calendar heatmap UI.',
  })
  getWeeklySummary(@CurrentUser() user: CurrentUserPayload) {
    return this.remindersService.getWeeklySummary(user.sub);
  }

  // ── POST /api/v1/reminders/:doseLogId/snooze ──────────────
  @Post(':doseLogId/snooze')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Snooze a reminder for N minutes',
    description:
      'Delays a PENDING or SNOOZED dose reminder. ' +
      `Maximum ${3} snoozes per dose. ` +
      'Provide either snoozeMinutes or snoozeUntil (ISO datetime). ' +
      '\n\n⚕️ Snoozed doses should still be taken as prescribed. ' +
      'Frequent snoozing may indicate difficulty with the schedule — ' +
      'consult your doctor.',
  })
  @ApiParam({ name: 'doseLogId', description: 'ID of the dose log to snooze' })
  @ApiResponse({ status: 200, description: 'Reminder snoozed successfully' })
  @ApiResponse({
    status: 400,
    description: 'Max snooze count reached or invalid time',
  })
  @ApiResponse({ status: 403, description: 'Not your dose log' })
  @ApiResponse({ status: 404, description: 'Dose log not found' })
  snooze(
    @CurrentUser() user: CurrentUserPayload,
    @Param('doseLogId') doseLogId: string,
    @Body() dto: SnoozeReminderDto,
  ) {
    return this.remindersService.snooze(user.sub, doseLogId, dto);
  }
}
