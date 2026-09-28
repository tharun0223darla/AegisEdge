import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { NotificationChannel } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { CreateHealthMetricDto } from './dto/create-health-metric.dto';
import type { HealthConnectMetricDto } from './dto/import-health-connect.dto';
import { TestAlarmDto, DismissAlarmDto } from './dto/test-alarm.dto';
import { HealthObservationValidatorService } from './health-observation-validator.service';
import {
  HealthSafetyRulesService,
  type HealthSafetyAssessment,
} from './health-safety-rules.service';
import type {
  HealthDeviceRecord,
  HealthDeviceTrustLevel,
  HealthMetricQuality,
  HealthMetricSource,
  HealthMetricType,
} from './health-metric.types';
import { HEALTH_METRIC_TYPES } from './health-metric.types';

const MAX_FUTURE_CLOCK_SKEW_MS = 5 * 60 * 1000;
const STANDARD_ALERT_COOLDOWN_MS = 30 * 60 * 1000;
const CRITICAL_ALERT_COOLDOWN_MS = 5 * 60 * 1000;
const TREND_MAX_RECORDS = 10_000;
export const HEALTH_TREND_QUALITY_SCOPES = ['ALL', 'TRUSTED_ONLY'] as const;
export type HealthTrendQualityScope = (typeof HEALTH_TREND_QUALITY_SCOPES)[number];

export interface DeviceHealthMetricInput {
  metricType: HealthMetricType;
  value: Record<string, unknown>;
  recordedAt?: string;
  clientRecordId?: string;
  unit?: string;
  timezoneOffsetMinutes?: number;
}

interface IngestHealthMetricInput extends DeviceHealthMetricInput {
  source: HealthMetricSource;
  quality: HealthMetricQuality;
  qualityFlags: string[];
  deviceRegistryId?: string;
  sourceMetadata?: Record<string, unknown>;
}

export interface StoredHealthMetric {
  id: string;
  [key: string]: unknown;
}

interface IngestHealthMetricResult {
  metric: StoredHealthMetric;
  duplicate: boolean;
}

export interface HealthConnectImportItemResult {
  clientRecordId: string;
  status: 'IMPORTED' | 'DUPLICATE' | 'REJECTED';
  metricId?: string;
  reason?: string;
}

export interface HealthMetricTrendPoint {
  date: string;
  count: number;
  questionableCount: number;
  average?: number;
  minimum?: number;
  maximum?: number;
  systolicAverage?: number;
  diastolicAverage?: number;
}

interface HealthMetricRepository {
  create(args: { data: Record<string, unknown> }): Promise<StoredHealthMetric>;
  findUnique(args: {
    where: Record<string, unknown>;
  }): Promise<StoredHealthMetric | null>;
  findFirst(args: {
    where: Record<string, unknown>;
    select: { id: true };
  }): Promise<{ id: string } | null>;
  findMany(args: {
    where: Record<string, unknown>;
    orderBy: { recordedAt: 'desc' };
    take: number;
  }): Promise<StoredHealthMetric[]>;
  update(args: {
    where: { id: string };
    data: Record<string, unknown>;
  }): Promise<StoredHealthMetric>;
}

function hasHealthMetricRepository(
  value: unknown,
): value is { healthMetric: HealthMetricRepository } {
  if (
    typeof value !== 'object' ||
    value === null ||
    !('healthMetric' in value)
  ) {
    return false;
  }
  const repository = value.healthMetric;
  return (
    typeof repository === 'object' &&
    repository !== null &&
    'create' in repository &&
    typeof repository.create === 'function' &&
    'findUnique' in repository &&
    typeof repository.findUnique === 'function' &&
    'findFirst' in repository &&
    typeof repository.findFirst === 'function' &&
    'findMany' in repository &&
    typeof repository.findMany === 'function' &&
    'update' in repository &&
    typeof repository.update === 'function'
  );
}

@Injectable()
export class HealthMetricsService {
  private readonly logger = new Logger(HealthMetricsService.name);
  private readonly healthMetrics: HealthMetricRepository;

  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationsService: NotificationsService,
    private readonly validator: HealthObservationValidatorService,
    private readonly safetyRules: HealthSafetyRulesService,
  ) {
    const prismaClient: unknown = prisma;
    if (!hasHealthMetricRepository(prismaClient)) {
      throw new Error('Health metric repository is unavailable.');
    }
    this.healthMetrics = prismaClient.healthMetric;
  }

  async create(
    userId: string,
    dto: CreateHealthMetricDto,
  ): Promise<StoredHealthMetric> {
    const result = await this.ingest(userId, {
      metricType: dto.metricType,
      value: dto.value,
      recordedAt: dto.recordedAt,
      clientRecordId: dto.clientRecordId,
      unit: dto.unit,
      timezoneOffsetMinutes: dto.timezoneOffsetMinutes,
      source: 'MANUAL',
      quality: 'USER_REPORTED',
      qualityFlags: [],
    });
    return result.metric;
  }

  async createFromDevice(
    userId: string,
    device: HealthDeviceRecord,
    input: DeviceHealthMetricInput,
  ): Promise<StoredHealthMetric> {
    const provenance = this.deviceProvenance(device.trustLevel);
    const result = await this.ingest(userId, {
      ...input,
      deviceRegistryId: device.id,
      ...provenance,
    });
    return result.metric;
  }

  async importHealthConnectBatch(
    userId: string,
    records: HealthConnectMetricDto[],
  ): Promise<{
    received: number;
    imported: number;
    duplicates: number;
    rejected: number;
    results: HealthConnectImportItemResult[];
  }> {
    const results: HealthConnectImportItemResult[] = [];

    for (const record of records) {
      try {
        const outcome = await this.ingest(userId, {
          metricType: record.metricType,
          value: record.value,
          recordedAt: record.recordedAt,
          clientRecordId: record.clientRecordId,
          unit: record.unit,
          timezoneOffsetMinutes: record.timezoneOffsetMinutes,
          source: 'HEALTH_CONNECT',
          quality: 'QUESTIONABLE',
          qualityFlags: ['UNATTESTED_MOBILE_CLIENT'],
          sourceMetadata: { originPackage: record.originPackage },
        });
        results.push({
          clientRecordId: record.clientRecordId,
          status: outcome.duplicate ? 'DUPLICATE' : 'IMPORTED',
          metricId: outcome.metric.id,
        });
      } catch (error) {
        const reason = this.healthConnectRejectionReason(error);
        this.logger.warn(
          `Rejected Health Connect record ${record.clientRecordId}: ${reason}`,
        );
        results.push({
          clientRecordId: record.clientRecordId,
          status: 'REJECTED',
          reason,
        });
      }
    }

    return {
      received: records.length,
      imported: results.filter((item) => item.status === 'IMPORTED').length,
      duplicates: results.filter((item) => item.status === 'DUPLICATE').length,
      rejected: results.filter((item) => item.status === 'REJECTED').length,
      results,
    };
  }

  findAll(userId: string, metricType?: HealthMetricType, limit = 50) {
    return this.healthMetrics.findMany({
      where: {
        userId,
        ...(metricType ? { metricType } : {}),
      },
      orderBy: { recordedAt: 'desc' },
      take: Math.min(Math.max(limit, 1), 100),
    });
  }

  async getTrend(
    userId: string,
    metricType: HealthMetricType,
    days = 14,
    qualityScope: HealthTrendQualityScope = 'ALL',
  ) {
    if (!HEALTH_METRIC_TYPES.includes(metricType)) {
      throw new BadRequestException('Unsupported health metric type.');
    }
    if (!HEALTH_TREND_QUALITY_SCOPES.includes(qualityScope)) {
      throw new BadRequestException('Unsupported health trend quality scope.');
    }
    const safeDays = Math.min(Math.max(days, 7), 90);
    const records = await this.healthMetrics.findMany({
      where: {
        userId,
        metricType,
        recordedAt: { gte: new Date(Date.now() - safeDays * 86_400_000) },
        ...(qualityScope === 'TRUSTED_ONLY'
          ? { quality: { not: 'QUESTIONABLE' } }
          : {}),
      },
      orderBy: { recordedAt: 'desc' },
      take: TREND_MAX_RECORDS,
    });
    const points = this.aggregateTrend(metricType, records);
    const first = points[0];
    const last = points.at(-1);
    const firstValue = first ? this.primaryTrendValue(metricType, first) : null;
    const lastValue = last ? this.primaryTrendValue(metricType, last) : null;

    return {
      metricType,
      days: safeDays,
      qualityScope,
      unit: this.trendUnit(metricType),
      totalReadings: points.reduce((sum, point) => sum + point.count, 0),
      questionableReadings: points.reduce(
        (sum, point) => sum + point.questionableCount,
        0,
      ),
      direction: this.trendDirection(firstValue, lastValue, points.length),
      truncated: records.length >= TREND_MAX_RECORDS,
      points,
    };
  }

  private async ingest(
    userId: string,
    input: IngestHealthMetricInput,
  ): Promise<IngestHealthMetricResult> {
    const recordedAt = this.parseRecordedAt(input.recordedAt);
    const normalized = this.validator.normalize(
      input.metricType,
      input.value,
      input.unit,
    );
    const assessment = this.safetyRules.assess(
      input.metricType,
      normalized.value,
      input.quality,
    );
    const idempotencyKey = this.buildIdempotencyKey(input);

    if (idempotencyKey) {
      const existing = await this.findByIdempotencyKey(userId, idempotencyKey);
      if (existing) return { metric: existing, duplicate: true };
    }

    let metric: StoredHealthMetric;
    try {
      metric = await this.healthMetrics.create({
        data: {
          userId,
          deviceRegistryId: input.deviceRegistryId,
          metricType: input.metricType,
          value: normalized.value,
          unit: normalized.unit,
          recordedAt,
          timezoneOffsetMinutes: input.timezoneOffsetMinutes,
          source: input.source,
          quality: input.quality,
          qualityFlags: input.qualityFlags,
          sourceMetadata: input.sourceMetadata,
          clientRecordId: input.clientRecordId,
          idempotencyKey,
          safetyAssessment: { ...assessment },
          evaluatedAt: new Date(),
        },
      });
    } catch (error) {
      if (idempotencyKey && this.isUniqueConstraintError(error)) {
        const existing = await this.findByIdempotencyKey(
          userId,
          idempotencyKey,
        );
        if (existing) return { metric: existing, duplicate: true };
      }
      throw error;
    }

    if (assessment.requiresNotification) {
      await this.deliverSafetyNotification(
        userId,
        metric.id,
        input.metricType,
        assessment,
      );
    }

    return { metric, duplicate: false };
  }

  private healthConnectRejectionReason(error: unknown): string {
    if (error instanceof BadRequestException) {
      const response = error.getResponse();
      if (typeof response === 'string') return response;
      if (
        typeof response === 'object' &&
        response !== null &&
        'message' in response
      ) {
        const message = response.message;
        if (typeof message === 'string') return message;
        if (Array.isArray(message)) return message.join('; ');
      }
    }
    return 'Unable to import this reading.';
  }

  private aggregateTrend(
    metricType: HealthMetricType,
    records: StoredHealthMetric[],
  ): HealthMetricTrendPoint[] {
    const buckets = new Map<
      string,
      { primary: number[]; secondary: number[]; questionableCount: number }
    >();

    for (const record of records) {
      const recordedAt = new Date(String(record.recordedAt));
      if (Number.isNaN(recordedAt.getTime())) continue;
      const offset =
        typeof record.timezoneOffsetMinutes === 'number'
          ? record.timezoneOffsetMinutes
          : 0;
      const date = new Date(recordedAt.getTime() + offset * 60_000)
        .toISOString()
        .slice(0, 10);
      const values = this.trendValues(metricType, record.value);
      if (!values) continue;
      const bucket = buckets.get(date) ?? {
        primary: [],
        secondary: [],
        questionableCount: 0,
      };
      bucket.primary.push(values.primary);
      if (values.secondary !== undefined) {
        bucket.secondary.push(values.secondary);
      }
      if (record.quality === 'QUESTIONABLE') bucket.questionableCount += 1;
      buckets.set(date, bucket);
    }

    return [...buckets.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([date, bucket]) => {
        const base = {
          date,
          count: bucket.primary.length,
          questionableCount: bucket.questionableCount,
        };
        if (metricType === 'BLOOD_PRESSURE') {
          return {
            ...base,
            systolicAverage: this.average(bucket.primary),
            diastolicAverage: this.average(bucket.secondary),
          };
        }
        return {
          ...base,
          average: this.average(bucket.primary),
          minimum: this.round(Math.min(...bucket.primary)),
          maximum: this.round(Math.max(...bucket.primary)),
        };
      });
  }

  private trendValues(
    metricType: HealthMetricType,
    rawValue: unknown,
  ): { primary: number; secondary?: number } | null {
    if (typeof rawValue !== 'object' || rawValue === null) return null;
    const value = rawValue as Record<string, unknown>;
    const fields =
      metricType === 'BLOOD_PRESSURE'
        ? ['systolic', 'diastolic']
        : [
            metricType === 'BLOOD_GLUCOSE'
              ? 'glucose'
              : metricType === 'HEART_RATE'
                ? 'heartRate'
                : metricType === 'OXYGEN_SATURATION'
                  ? 'oxygenSaturation'
                  : 'sleepHours',
          ];
    const primary = value[fields[0]];
    const secondary = fields[1] ? value[fields[1]] : undefined;
    if (typeof primary !== 'number' || !Number.isFinite(primary)) return null;
    if (
      secondary !== undefined &&
      (typeof secondary !== 'number' || !Number.isFinite(secondary))
    ) {
      return null;
    }
    return { primary, secondary };
  }

  private primaryTrendValue(
    metricType: HealthMetricType,
    point: HealthMetricTrendPoint,
  ): number | null {
    return metricType === 'BLOOD_PRESSURE'
      ? (point.systolicAverage ?? null)
      : (point.average ?? null);
  }

  private trendDirection(
    first: number | null,
    last: number | null,
    pointCount: number,
  ): 'RISING' | 'FALLING' | 'STABLE' | 'INSUFFICIENT_DATA' {
    if (first === null || last === null || pointCount < 3) {
      return 'INSUFFICIENT_DATA';
    }
    const threshold = Math.max(Math.abs(first) * 0.03, 1);
    if (last - first > threshold) return 'RISING';
    if (first - last > threshold) return 'FALLING';
    return 'STABLE';
  }

  private average(values: number[]): number {
    return this.round(
      values.reduce((sum, value) => sum + value, 0) / values.length,
    );
  }

  private round(value: number): number {
    return Math.round(value * 10) / 10;
  }

  private trendUnit(metricType: HealthMetricType): string {
    return {
      BLOOD_PRESSURE: 'mmHg',
      BLOOD_GLUCOSE: 'mg/dL',
      HEART_RATE: 'bpm',
      OXYGEN_SATURATION: '%',
      SLEEP_HOURS: 'h',
    }[metricType];
  }

  private deviceProvenance(trustLevel: HealthDeviceTrustLevel): {
    source: HealthMetricSource;
    quality: HealthMetricQuality;
    qualityFlags: string[];
  } {
    switch (trustLevel) {
      case 'VERIFIED':
        return {
          source: 'BLUETOOTH_REAL',
          quality: 'DEVICE_REPORTED',
          qualityFlags: [],
        };
      case 'SIMULATOR':
        return {
          source: 'BLUETOOTH_SIMULATED',
          quality: 'QUESTIONABLE',
          qualityFlags: ['SIMULATED_DATA'],
        };
      case 'UNVERIFIED':
      default:
        return {
          source: 'UNVERIFIED_DEVICE',
          quality: 'QUESTIONABLE',
          qualityFlags: ['UNVERIFIED_DEVICE'],
        };
    }
  }

  private parseRecordedAt(recordedAt?: string): Date {
    const parsed = recordedAt ? new Date(recordedAt) : new Date();
    if (Number.isNaN(parsed.getTime())) {
      throw new BadRequestException('Invalid recordedAt timestamp format.');
    }
    if (parsed.getTime() > Date.now() + MAX_FUTURE_CLOCK_SKEW_MS) {
      throw new BadRequestException(
        'recordedAt cannot be more than 5 minutes in the future.',
      );
    }
    return parsed;
  }

  private buildIdempotencyKey(
    input: IngestHealthMetricInput,
  ): string | undefined {
    if (!input.clientRecordId) return undefined;
    const material = [
      input.source,
      input.deviceRegistryId ?? 'manual',
      input.metricType,
      input.clientRecordId,
    ].join(':');
    return createHash('sha256').update(material).digest('hex');
  }

  private findByIdempotencyKey(userId: string, idempotencyKey: string) {
    return this.healthMetrics.findUnique({
      where: { userId_idempotencyKey: { userId, idempotencyKey } },
    });
  }

  private isUniqueConstraintError(error: unknown): boolean {
    return (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      error.code === 'P2002'
    );
  }

  async testAlarm(userId: string, dto: TestAlarmDto) {
    const patientUser = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { patientProfile: true },
    });

    const patientName = patientUser?.patientProfile?.firstName
      ? `${patientUser.patientProfile.firstName} ${patientUser.patientProfile.lastName || ''}`.trim()
      : patientUser?.email?.split('@')[0] || 'Patient';

    const relationships = await this.prisma.careRelationship.findMany({
      where: { patientId: userId, status: 'ACTIVE' },
      include: {
        caregiver: {
          include: { patientProfile: true },
        },
      },
    });

    let title = `🚨 [RPM TEST ALARM] Health Anomaly: ${patientName}`;
    let body = `Simulated parameter test for ${patientName}.`;
    let parameterDesc = '';

    switch (dto.scenario) {
      case 'SPO2_CRASH':
        title = `🚨 [RPM TEST ALARM] Critical Hypoxia (SpO2 ${dto.value ?? 76}%): ${patientName}`;
        body = `Simulation Alert: ${patientName}'s SpO2 dropped to ${dto.value ?? 76}% (Severe Hypoxia). Automated caregiver drill triggered.`;
        parameterDesc = `SpO2: ${dto.value ?? 76}% (Critical Low)`;
        break;
      case 'HYPERTENSION':
        title = `⚠️ [RPM TEST ALARM] Hypertensive Crisis (168/104): ${patientName}`;
        body = `Simulation Alert: ${patientName}'s Blood Pressure spiked to 168/104 mmHg. Caregiver escalation triggered.`;
        parameterDesc = `BP: 168/104 mmHg (Severe Elevation)`;
        break;
      case 'TACHYCARDIA':
        title = `⚠️ [RPM TEST ALARM] Severe Tachycardia (${dto.value ?? 165} BPM): ${patientName}`;
        body = `Simulation Alert: ${patientName}'s resting Heart Rate spiked to ${dto.value ?? 165} BPM. Caregiver escalation triggered.`;
        parameterDesc = `Heart Rate: ${dto.value ?? 165} BPM (Tachycardia)`;
        break;
      case 'GLUCOSE_CRASH':
        title = `🚨 [RPM TEST ALARM] Severe Hypoglycemia (${dto.value ?? 48} mg/dL): ${patientName}`;
        body = `Simulation Alert: ${patientName}'s Blood Glucose crashed to ${dto.value ?? 48} mg/dL. Immediate caregiver drill triggered.`;
        parameterDesc = `Glucose: ${dto.value ?? 48} mg/dL (Critical Low)`;
        break;
      case 'FALL_IMPACT':
        title = `🚨 [SOS TEST ALARM] Fall Impact & Immobility: ${patientName}`;
        body = `Simulation Alert: High-impact accelerometer shock detected with 60s total immobility for ${patientName}. 30s liveness switch activated.`;
        parameterDesc = `Fall Impact + Immobility`;
        break;
      case 'NEWS2_CRITICAL':
        title = `🚨 [RPM TEST ALARM] NEWS2 Critical Decompensation: ${patientName}`;
        body = `Simulation Alert: ${patientName}'s National Early Warning Score reached 9 (High Risk). Immediate clinical review requested.`;
        parameterDesc = `NEWS2 Score: 9 (High Decompensation Risk)`;
        break;
    }

    if (dto.notes) {
      body += ` Source: ${dto.notes}`;
    }

    const notifiedCaregivers: Array<{
      id: string;
      name: string;
      email: string;
      phone?: string | null;
    }> = [];

    for (const rel of relationships) {
      const caregiverName = rel.caregiver.patientProfile?.firstName
        ? `${rel.caregiver.patientProfile.firstName} ${rel.caregiver.patientProfile.lastName || ''}`.trim()
        : rel.caregiver.email.split('@')[0];

      await this.notificationsService.send({
        userId: rel.caregiverId,
        title,
        body,
        channel: NotificationChannel.LOCAL,
        metadata: {
          type: 'RPM_TEST_ALARM',
          scenario: dto.scenario,
          patientId: userId,
          patientName,
          parameterDesc,
          simulatedValue: dto.value,
          isSimulation: true,
          actionUrl: `/care/patients/${userId}`,
        },
      });

      notifiedCaregivers.push({
        id: rel.caregiverId,
        name: caregiverName,
        email: rel.caregiver.email,
        phone: rel.caregiver.phone,
      });
    }

    const caregiverSummary =
      notifiedCaregivers.length > 0
        ? `Notified ${notifiedCaregivers.length} caregiver(s): ${notifiedCaregivers.map((c) => c.name).join(', ')}.`
        : 'No active caregivers linked in Care Circle yet.';

    await this.notificationsService.send({
      userId,
      title: `🔔 Alarm Test Dispatched: ${dto.scenario}`,
      body: `You tested the ${dto.scenario} alarm drill. ${caregiverSummary}`,
      channel: NotificationChannel.LOCAL,
      metadata: {
        type: 'PATIENT_TEST_CONFIRMATION',
        scenario: dto.scenario,
        notifiedCount: notifiedCaregivers.length,
        isSimulation: true,
      },
    });

    return {
      success: true,
      scenario: dto.scenario,
      patientName,
      parameterDesc,
      caregiversNotified: notifiedCaregivers,
      message:
        notifiedCaregivers.length > 0
          ? `Alarm test simulated successfully. Notified caregiver(s): ${notifiedCaregivers.map((c) => c.name).join(', ')}.`
          : 'Alarm test simulated successfully. Tip: Add a caregiver in Care Circle to receive remote alerts.',
    };
  }

  async dismissAlarm(userId: string, dto: DismissAlarmDto) {
    const patientUser = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { patientProfile: true },
    });

    const patientName = patientUser?.patientProfile?.firstName
      ? `${patientUser.patientProfile.firstName} ${patientUser.patientProfile.lastName || ''}`.trim()
      : patientUser?.email?.split('@')[0] || 'Patient';

    const relationships = await this.prisma.careRelationship.findMany({
      where: { patientId: userId, status: 'ACTIVE' },
      include: {
        caregiver: {
          include: { patientProfile: true },
        },
      },
    });

    const reason =
      dto.reason ||
      'Patient confirmed conscious and safe (False alarm resolved).';

    for (const rel of relationships) {
      await this.notificationsService.send({
        userId: rel.caregiverId,
        title: `✅ [ALARM DISARMED] Patient Confirmed Safe: ${patientName}`,
        body: `${patientName} dismissed the ${dto.scenario} alarm. Status: ${reason}`,
        channel: NotificationChannel.LOCAL,
        metadata: {
          type: 'ALARM_DISARMED',
          scenario: dto.scenario,
          patientId: userId,
          patientName,
          reason,
          isSimulation: true,
        },
      });
    }

    return {
      success: true,
      message: 'Alarm dismissed and caregivers notified of safe status.',
    };
  }

  private async deliverSafetyNotification(
    userId: string,
    metricId: string,
    metricType: HealthMetricType,
    assessment: HealthSafetyAssessment,
  ): Promise<void> {
    const cooldownMs =
      assessment.severity === 'CRITICAL'
        ? CRITICAL_ALERT_COOLDOWN_MS
        : STANDARD_ALERT_COOLDOWN_MS;
    const recentAlert = await this.healthMetrics.findFirst({
      where: {
        userId,
        metricType,
        id: { not: metricId },
        alertedAt: { gte: new Date(Date.now() - cooldownMs) },
      },
      select: { id: true },
    });
    if (recentAlert) return;

    try {
      await this.notificationsService.send({
        userId,
        title:
          assessment.status === 'URGENT_HELP'
            ? 'Review a health reading now'
            : 'Review a health reading',
        body: 'A recent health reading may need attention. Open MediTrack to review the reading and next steps.',
        channel: 'LOCAL',
        metadata: {
          type: 'HEALTH_READING_ALERT',
          metricId,
          metricType,
          status: assessment.status,
          severity: assessment.severity,
          reasonCode: assessment.reasonCode,
          ruleVersion: assessment.ruleVersion,
        },
      });

      // Also notify Care Circle caregivers if high or critical severity
      if (assessment.severity === 'CRITICAL' || assessment.severity === 'HIGH') {
        const patient = await this.prisma.user.findUnique({
          where: { id: userId },
          include: { patientProfile: true },
        });
        const patientName = patient?.patientProfile?.firstName
          ? `${patient.patientProfile.firstName} ${patient.patientProfile.lastName || ''}`.trim()
          : 'Your patient';

        const relationships = await this.prisma.careRelationship.findMany({
          where: { patientId: userId, status: 'ACTIVE' },
        });

        for (const rel of relationships) {
          await this.notificationsService.send({
            userId: rel.caregiverId,
            title: `🚨 [RPM VITAL ALERT] ${patientName}: ${assessment.reasonCode}`,
            body: `${patientName} recorded an abnormal ${metricType} reading requiring review: ${assessment.message}`,
            channel: NotificationChannel.LOCAL,
            metadata: {
              type: 'CAREGIVER_HEALTH_READING_ALERT',
              patientId: userId,
              metricId,
              metricType,
              severity: assessment.severity,
              reasonCode: assessment.reasonCode,
            },
          });
        }
      }

      await this.healthMetrics.update({
        where: { id: metricId },
        data: { alertedAt: new Date() },
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unknown notification error';
      this.logger.error(
        `Health reading ${metricId} was stored, but alert delivery failed: ${message}`,
      );
    }
  }
}
