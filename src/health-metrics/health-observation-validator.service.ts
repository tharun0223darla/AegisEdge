import { BadRequestException, Injectable } from '@nestjs/common';
import type { HealthMetricType } from './health-metric.types';

export type NormalizedMetricValue = Record<string, string | number | boolean>;

export interface NormalizedHealthObservation {
  value: NormalizedMetricValue;
  unit: string;
}

@Injectable()
export class HealthObservationValidatorService {
  normalize(
    metricType: HealthMetricType,
    rawValue: Record<string, unknown>,
    requestedUnit?: string,
  ): NormalizedHealthObservation {
    switch (metricType) {
      case 'BLOOD_PRESSURE':
        return this.normalizeBloodPressure(rawValue, requestedUnit);
      case 'BLOOD_GLUCOSE':
        return this.normalizeBloodGlucose(rawValue, requestedUnit);
      case 'HEART_RATE':
        return this.normalizeHeartRate(rawValue, requestedUnit);
      case 'OXYGEN_SATURATION':
        return this.normalizeOxygenSaturation(rawValue, requestedUnit);
      case 'SLEEP_HOURS':
        return this.normalizeSleep(rawValue, requestedUnit);
      default:
        throw new BadRequestException('Unsupported health metric type.');
    }
  }

  private normalizeBloodPressure(
    value: Record<string, unknown>,
    unit?: string,
  ): NormalizedHealthObservation {
    this.assertAllowedKeys(value, [
      'systolic',
      'diastolic',
      'pulse',
      'bodyPosition',
    ]);
    this.assertUnit(unit, ['mmHg'], 'mmHg');
    const systolic = this.numberInRange(value.systolic, 'systolic', 40, 300);
    const diastolic = this.numberInRange(value.diastolic, 'diastolic', 20, 200);
    if (systolic <= diastolic) {
      throw new BadRequestException(
        'Systolic pressure must be greater than diastolic pressure.',
      );
    }

    const normalized: NormalizedMetricValue = { systolic, diastolic };
    if (value.pulse !== undefined) {
      normalized.pulse = this.numberInRange(value.pulse, 'pulse', 20, 250);
    }
    if (value.bodyPosition !== undefined) {
      normalized.bodyPosition = this.enumValue(
        value.bodyPosition,
        'bodyPosition',
        ['SITTING', 'STANDING', 'LYING_DOWN', 'UNKNOWN'],
      );
    }
    return { value: normalized, unit: 'mmHg' };
  }

  private normalizeBloodGlucose(
    value: Record<string, unknown>,
    unit?: string,
  ): NormalizedHealthObservation {
    this.assertAllowedKeys(value, ['glucose', 'mealStatus']);
    const selectedUnit = this.assertUnit(unit, ['mg/dL', 'mmol/L'], 'mg/dL');
    const rawGlucose = this.numberInRange(
      value.glucose,
      'glucose',
      selectedUnit === 'mmol/L' ? 0.6 : 10,
      selectedUnit === 'mmol/L' ? 55.5 : 1000,
    );
    const glucose =
      selectedUnit === 'mmol/L'
        ? Math.round(rawGlucose * 180.182) / 10
        : rawGlucose;
    const mealStatus = this.enumValue(
      value.mealStatus ?? 'UNKNOWN',
      'mealStatus',
      ['FASTING', 'POST_MEAL', 'RANDOM', 'UNKNOWN'],
    );
    return { value: { glucose, mealStatus }, unit: 'mg/dL' };
  }

  private normalizeHeartRate(
    value: Record<string, unknown>,
    unit?: string,
  ): NormalizedHealthObservation {
    this.assertAllowedKeys(value, ['heartRate', 'context']);
    this.assertUnit(unit, ['bpm'], 'bpm');
    const heartRate = this.numberInRange(value.heartRate, 'heartRate', 20, 300);
    const context = this.enumValue(value.context ?? 'UNKNOWN', 'context', [
      'RESTING',
      'ACTIVE',
      'SLEEPING',
      'UNKNOWN',
    ]);
    return { value: { heartRate, context }, unit: 'bpm' };
  }

  private normalizeOxygenSaturation(
    value: Record<string, unknown>,
    unit?: string,
  ): NormalizedHealthObservation {
    this.assertAllowedKeys(value, ['oxygenSaturation', 'spo2', 'pulse']);
    this.assertUnit(unit, ['%'], '%');
    const saturation = this.numberInRange(
      value.oxygenSaturation ?? value.spo2,
      'oxygenSaturation',
      1,
      100,
    );
    const normalized: NormalizedMetricValue = { oxygenSaturation: saturation };
    if (value.pulse !== undefined) {
      normalized.pulse = this.numberInRange(value.pulse, 'pulse', 20, 250);
    }
    return { value: normalized, unit: '%' };
  }

  private normalizeSleep(
    value: Record<string, unknown>,
    unit?: string,
  ): NormalizedHealthObservation {
    this.assertAllowedKeys(value, ['sleepHours']);
    this.assertUnit(unit, ['h'], 'h');
    return {
      value: {
        sleepHours: this.numberInRange(value.sleepHours, 'sleepHours', 0, 24),
      },
      unit: 'h',
    };
  }

  private assertAllowedKeys(
    value: Record<string, unknown>,
    allowed: string[],
  ): void {
    const unknown = Object.keys(value).filter((key) => !allowed.includes(key));
    if (unknown.length > 0) {
      throw new BadRequestException(
        `Unexpected health metric fields: ${unknown.join(', ')}.`,
      );
    }
  }

  private assertUnit(
    unit: string | undefined,
    allowed: string[],
    fallback: string,
  ): string {
    const selected = unit?.trim() || fallback;
    const match = allowed.find(
      (candidate) => candidate.toLowerCase() === selected.toLowerCase(),
    );
    if (!match) {
      throw new BadRequestException(
        `Unsupported unit '${selected}'. Expected ${allowed.join(' or ')}.`,
      );
    }
    return match;
  }

  private numberInRange(
    value: unknown,
    field: string,
    minimum: number,
    maximum: number,
  ): number {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw new BadRequestException(`${field} must be a finite number.`);
    }
    if (value < minimum || value > maximum) {
      throw new BadRequestException(
        `${field} is outside the supported measurement range.`,
      );
    }
    return value;
  }

  private enumValue(value: unknown, field: string, allowed: string[]): string {
    if (typeof value !== 'string') {
      throw new BadRequestException(`${field} must be a string.`);
    }
    const normalized = value.trim().toUpperCase();
    if (!allowed.includes(normalized)) {
      throw new BadRequestException(
        `${field} must be one of: ${allowed.join(', ')}.`,
      );
    }
    return normalized;
  }
}
