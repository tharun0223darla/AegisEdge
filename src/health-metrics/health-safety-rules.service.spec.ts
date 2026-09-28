import { HealthSafetyRulesService } from './health-safety-rules.service';

describe('HealthSafetyRulesService', () => {
  const service = new HealthSafetyRulesService();

  it('never creates a clinical alert from an unverified device reading', () => {
    const result = service.assess(
      'OXYGEN_SATURATION',
      { oxygenSaturation: 70 },
      'QUESTIONABLE',
    );

    expect(result.status).toBe('VERIFY_READING');
    expect(result.requiresNotification).toBe(false);
    expect(result.isDiagnosis).toBe(false);
  });

  it('flags a very low verified oxygen reading for urgent review', () => {
    const result = service.assess(
      'OXYGEN_SATURATION',
      { oxygenSaturation: 88 },
      'DEVICE_REPORTED',
    );

    expect(result.status).toBe('URGENT_HELP');
    expect(result.reasonCode).toBe('OXYGEN_SATURATION_VERY_LOW');
    expect(result.requiresNotification).toBe(true);
  });

  it('does not treat an active heart rate as a resting measurement', () => {
    const result = service.assess(
      'HEART_RATE',
      { heartRate: 120, context: 'ACTIVE' },
      'DEVICE_REPORTED',
    );

    expect(result.status).toBe('NORMAL');
  });
});
