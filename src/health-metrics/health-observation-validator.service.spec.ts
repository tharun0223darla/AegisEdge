import { BadRequestException } from '@nestjs/common';
import { HealthObservationValidatorService } from './health-observation-validator.service';

describe('HealthObservationValidatorService', () => {
  const service = new HealthObservationValidatorService();

  it('normalizes glucose from mmol/L to the canonical mg/dL unit', () => {
    const result = service.normalize(
      'BLOOD_GLUCOSE',
      { glucose: 5.5, mealStatus: 'fasting' },
      'mmol/L',
    );

    expect(result).toEqual({
      unit: 'mg/dL',
      value: { glucose: 99.1, mealStatus: 'FASTING' },
    });
  });

  it('accepts the common spo2 alias but stores one canonical field', () => {
    const result = service.normalize('OXYGEN_SATURATION', {
      spo2: 97,
    });

    expect(result).toEqual({
      unit: '%',
      value: { oxygenSaturation: 97 },
    });
  });

  it('rejects unknown nested fields instead of silently trusting them', () => {
    expect(() =>
      service.normalize('HEART_RATE', {
        heartRate: 72,
        diagnosis: 'normal',
      }),
    ).toThrow(BadRequestException);
  });

  it('rejects impossible blood pressure ordering', () => {
    expect(() =>
      service.normalize('BLOOD_PRESSURE', {
        systolic: 70,
        diastolic: 90,
      }),
    ).toThrow('Systolic pressure must be greater than diastolic pressure.');
  });
});
