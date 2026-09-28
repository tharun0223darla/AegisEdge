import {
  Controller,
  Get,
  Post,
  Body,
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
import {
  HEALTH_TREND_QUALITY_SCOPES,
  HealthMetricsService,
  type HealthTrendQualityScope,
} from './health-metrics.service';
import { CreateHealthMetricDto } from './dto/create-health-metric.dto';
import { ImportHealthConnectBatchDto } from './dto/import-health-connect.dto';
import { TestAlarmDto, DismissAlarmDto } from './dto/test-alarm.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { CurrentUserPayload } from '../common/decorators/current-user.decorator';
import { UserRole } from '../common/enums/userrole.enum';
import {
  HEALTH_METRIC_TYPES,
  type HealthMetricType,
} from './health-metric.types';

import { News2ScorerService } from './news2-scorer.service';

@ApiTags('Health Vitals')
@ApiBearerAuth('JWT-auth')
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('health-metrics')
export class HealthMetricsController {
  constructor(
    private readonly healthMetricsService: HealthMetricsService,
    private readonly news2Scorer: News2ScorerService,
  ) {}

  @Post()
  @Roles(UserRole.PATIENT, UserRole.CAREGIVER)
  @ApiOperation({
    summary:
      'Add a new vital reading (BP, Blood Glucose, Heart Rate, Sleep, etc.)',
  })
  create(
    @CurrentUser() user: CurrentUserPayload,
    @Body() dto: CreateHealthMetricDto,
  ) {
    return this.healthMetricsService.create(user.sub, dto);
  }

  @Post('health-connect/import')
  @Roles(UserRole.PATIENT)
  @ApiOperation({
    summary: 'Import a bounded batch of user-approved Health Connect readings',
  })
  importHealthConnect(
    @CurrentUser() user: CurrentUserPayload,
    @Body() dto: ImportHealthConnectBatchDto,
  ) {
    return this.healthMetricsService.importHealthConnectBatch(
      user.sub,
      dto.records,
    );
  }

  @Post('test-alarm')
  @Roles(UserRole.PATIENT, UserRole.CAREGIVER, UserRole.ADMIN)
  @ApiOperation({
    summary: 'Test parameter alarm drill and notify care circle caregivers',
    description:
      'Simulates an acute anomaly (e.g. Hypoxia SpO2 crash, Hypertensive crisis, Tachycardia, Fall) and dispatches real-time alerts to linked caregivers.',
  })
  testAlarm(
    @CurrentUser() user: CurrentUserPayload,
    @Body() dto: TestAlarmDto,
  ) {
    return this.healthMetricsService.testAlarm(user.sub, dto);
  }

  @Post('dismiss-alarm')
  @Roles(UserRole.PATIENT, UserRole.CAREGIVER, UserRole.ADMIN)
  @ApiOperation({
    summary: 'Dismiss active alarm drill and send confirmation to caregivers',
    description:
      'Confirms patient is conscious/safe and sends a reassurance update to care circle caregivers.',
  })
  dismissAlarm(
    @CurrentUser() user: CurrentUserPayload,
    @Body() dto: DismissAlarmDto,
  ) {
    return this.healthMetricsService.dismissAlarm(user.sub, dto);
  }

  @Get()
  @Roles(UserRole.PATIENT, UserRole.CAREGIVER, UserRole.DOCTOR)
  @ApiOperation({ summary: 'Retrieve logs of vitals for the user' })
  @ApiQuery({ name: 'type', required: false, enum: HEALTH_METRIC_TYPES })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  findAll(
    @CurrentUser() user: CurrentUserPayload,
    @Query('type') type?: HealthMetricType,
    @Query('limit', new DefaultValuePipe(50), ParseIntPipe) limit?: number,
  ) {
    return this.healthMetricsService.findAll(user.sub, type, limit);
  }

  @Get('trends')
  @Roles(UserRole.PATIENT, UserRole.CAREGIVER, UserRole.DOCTOR)
  @ApiOperation({ summary: 'Retrieve deterministic daily vital trends' })
  @ApiQuery({ name: 'type', required: true, enum: HEALTH_METRIC_TYPES })
  @ApiQuery({ name: 'days', required: false, enum: [7, 14, 30, 90] })
  @ApiQuery({
    name: 'quality',
    required: false,
    enum: HEALTH_TREND_QUALITY_SCOPES,
    description: 'Use TRUSTED_ONLY for clinical or AI decision support.',
  })
  getTrend(
    @CurrentUser() user: CurrentUserPayload,
    @Query('type') type: HealthMetricType,
    @Query('days', new DefaultValuePipe(14), ParseIntPipe) days: number,
    @Query('quality', new DefaultValuePipe('ALL'))
    quality: HealthTrendQualityScope,
  ) {
    return this.healthMetricsService.getTrend(user.sub, type, days, quality);
  }

  @Get('news2')
  @Roles(UserRole.PATIENT, UserRole.CAREGIVER, UserRole.DOCTOR)
  @ApiOperation({
    summary:
      'Compute National Early Warning Score (NEWS2) & Decompensation Risk',
  })
  async getNews2Assessment(
    @CurrentUser() user: CurrentUserPayload,
    @Query('respiratoryRate') respiratoryRate?: number,
    @Query('oxygenSaturation') oxygenSaturation?: number,
    @Query('systolicBP') systolicBP?: number,
    @Query('heartRate') heartRate?: number,
    @Query('temperature') temperature?: number,
    @Query('consciousness') consciousness?: any,
  ) {
    // If explicit query params provided, score them directly
    if (respiratoryRate || oxygenSaturation || systolicBP || heartRate) {
      return this.news2Scorer.assess({
        respiratoryRate: respiratoryRate ? Number(respiratoryRate) : 16,
        oxygenSaturation: oxygenSaturation ? Number(oxygenSaturation) : 98,
        systolicBP: systolicBP ? Number(systolicBP) : 122,
        heartRate: heartRate ? Number(heartRate) : 74,
        temperature: temperature ? Number(temperature) : 36.8,
        consciousness: consciousness ?? 'ALERT',
      });
    }

    // Otherwise load latest recorded telemetry for the patient
    const latestMetrics = await this.healthMetricsService.findAll(
      user.sub,
      undefined,
      25,
    );

    const bp = latestMetrics.find((m) => m.metricType === 'BLOOD_PRESSURE');
    const hr = latestMetrics.find((m) => m.metricType === 'HEART_RATE');
    const spo2 = latestMetrics.find(
      (m) => m.metricType === 'OXYGEN_SATURATION',
    );

    const bpValue = bp?.value as any;
    const hrValue = hr?.value as any;
    const spo2Value = spo2?.value as any;

    return this.news2Scorer.assess({
      respiratoryRate: 16,
      oxygenSaturation: spo2Value?.oxygenSaturation ?? 98,
      systolicBP: bpValue?.systolic ?? 122,
      heartRate: hrValue?.heartRate ?? 74,
      temperature: 36.8,
      consciousness: 'ALERT',
    });
  }
}
