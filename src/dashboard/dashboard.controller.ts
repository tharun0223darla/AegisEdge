import {
  Controller,
  Get,
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
  ApiParam,
  ApiResponse,
} from '@nestjs/swagger';
import { DashboardService, PeriodOption } from './dashboard.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { CurrentUserPayload } from '../common/decorators/current-user.decorator';
import { UserRole } from '../common/enums/userrole.enum';
import type { AdherenceBand } from './dashboard.service';

const VALID_PERIODS: PeriodOption[] = ['7d', '14d', '30d', '90d'];
const safePeriod = (p: string): PeriodOption =>
  VALID_PERIODS.includes(p as PeriodOption) ? (p as PeriodOption) : '30d';

@ApiTags('Dashboard')
@ApiBearerAuth('JWT-auth')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.PATIENT)
@Controller('dashboard')
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  // ── GET /api/v1/dashboard/summary ─────────────────────────
  @Get('summary')
  @ApiOperation({
    summary: 'Home screen summary — today stats, next dose, streak, low stock alerts',
    description: '⚕️ Adherence tracking only. Not a clinical report.',
  })
  getSummary(@CurrentUser() user: CurrentUserPayload) {
    return this.dashboardService.getSummary(user.sub);
  }

  // ── GET /api/v1/dashboard/quick-stats ─────────────────────
  // Phase 1 backward compat alias
  @Get('quick-stats')
  @ApiOperation({ summary: '[Alias] Same as /summary — kept for Phase 1 compatibility' })
  getQuickStats(@CurrentUser() user: CurrentUserPayload) {
    return this.dashboardService.getSummary(user.sub);
  }

  // ── GET /api/v1/dashboard/adherence ───────────────────────
  @Get('adherence')
  @ApiOperation({
    summary: 'Full adherence dashboard with per-medicine breakdown and streaks',
    description: '⚕️ Returns medication adherence tracking indicators for personal monitoring only.',
  })
  @ApiQuery({ name: 'period', required: false, enum: ['7d', '14d', '30d', '90d'], description: 'Time window (default: 30d)' })
  getAdherenceDashboard(
    @CurrentUser() user: CurrentUserPayload,
    @Query('period', new DefaultValuePipe('30d')) period: string,
  ) {
    return this.dashboardService.getAdherenceDashboard(user.sub, safePeriod(period));
  }

  // ── GET /api/v1/dashboard/daily-breakdown ─────────────────
  @Get('daily-breakdown')
  @ApiOperation({
    summary: 'Day-by-day dose breakdown for chart rendering',
    description: 'Returns taken/missed/snoozed/skipped counts per day. Max 92-day range.',
  })
  @ApiQuery({ name: 'from', required: false, example: '2024-01-01', description: 'Start date YYYY-MM-DD; defaults to 29 days before today' })
  @ApiQuery({ name: 'to', required: false, example: '2024-01-31', description: 'End date YYYY-MM-DD; defaults to today' })
  getDailyBreakdown(
    @CurrentUser() user: CurrentUserPayload,
    @Query('from') from: string,
    @Query('to') to: string,
  ) {
    return this.dashboardService.getDailyBreakdownApi(user.sub, from, to);
  }

  // ── GET /api/v1/dashboard/weekly-summary ──────────────────
  @Get('weekly-summary')
  @ApiOperation({
    summary: 'Last 4 weeks of week-level adherence aggregation',
    description: 'Used for the weekly trends chart on the dashboard.',
  })
  getWeeklySummary(@CurrentUser() user: CurrentUserPayload) {
    return this.dashboardService.getWeeklySummary(user.sub);
  }

  // ── GET /api/v1/dashboard/monthly-summary ─────────────────
  @Get('monthly-summary')
  @ApiOperation({
    summary: 'Current month vs previous month adherence with trend direction',
  })
  getMonthlySummary(@CurrentUser() user: CurrentUserPayload) {
    return this.dashboardService.getMonthlySummary(user.sub);
  }

  // ── GET /api/v1/dashboard/trends ──────────────────────────
  @Get('trends')
  @ApiOperation({
    summary: 'Adherence trend data from daily snapshots (fast read)',
    description: 'Returns pre-computed adherence snapshots from the nightly cron job.',
  })
  @ApiQuery({ name: 'days', required: false, type: Number, description: 'Days to look back (7–90, default: 30)' })
  getTrends(
    @CurrentUser() user: CurrentUserPayload,
    @Query('days', new DefaultValuePipe(30), ParseIntPipe) days: number,
  ) {
    return this.dashboardService.getAdherenceTrends(user.sub, days);
  }

  // ── GET /api/v1/dashboard/medicine/:medicineId ────────────
  @Get('medicine/:medicineId')
  @ApiOperation({
    summary: 'Per-medicine adherence analytics',
    description: 'Detailed adherence breakdown for a single medicine including daily chart data.',
  })
  @ApiParam({ name: 'medicineId', description: 'Medicine ID to analyse' })
  @ApiQuery({ name: 'period', required: false, enum: ['7d', '14d', '30d', '90d'] })
  getMedicineAnalytics(
    @CurrentUser() user: CurrentUserPayload,
    @Param('medicineId') medicineId: string,
    @Query('period', new DefaultValuePipe('30d')) period: string,
  ) {
    return this.dashboardService.getMedicineAnalytics(user.sub, medicineId, safePeriod(period));
  }
}