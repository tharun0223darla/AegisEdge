import {
  AllergyCategory,
  AllergyClinicalStatus,
  AllergyCriticality,
  MedicationSafetyRule,
  MedicationSafetySeverity,
  SafetyRecordSource,
  SafetyVerificationStatus,
} from '@prisma/client';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  type EvaluatedAllergy,
  type EvaluatedMedicine,
  MedicationSafetyService,
} from './medication-safety.service';

describe('MedicationSafetyService deterministic evaluator', () => {
  const service = new MedicationSafetyService(
    {} as unknown as PrismaService,
    {} as unknown as AuditLogsService,
  );

  function medicine(input: {
    id: string;
    masterId?: string;
    name?: string;
    ingredient?: string;
    time?: string;
    day?: number;
  }): EvaluatedMedicine {
    return {
      id: input.id,
      name: input.name ?? `Medicine ${input.id}`,
      strength: '500mg',
      form: 'TABLET',
      medicineMasterId: input.masterId ?? input.id,
      medicinePackageId: null,
      medicineMaster: input.ingredient
        ? {
            id: input.masterId ?? input.id,
            brandName: input.name ?? `Medicine ${input.id}`,
            genericName: input.ingredient,
            composition: `${input.ingredient} 500mg`,
            salts: null,
            saltProfile: {
              id: `salt-${input.ingredient}`,
              saltKey: input.ingredient,
              displayName: input.ingredient,
              ingredients: [
                { ingredient: input.ingredient, strength: '500', unit: 'mg' },
              ],
            },
          }
        : null,
      schedules: input.time
        ? [
            {
              id: `schedule-${input.id}`,
              frequency: 'DAILY',
              timesOfDay: [input.time],
              daysOfWeek: input.day === undefined ? [] : [input.day],
              startDate: new Date('2026-01-01T00:00:00.000Z'),
              endDate: null,
            },
          ]
        : [],
    };
  }

  const build = (
    userId: string,
    medicines: EvaluatedMedicine[],
    allergies: EvaluatedAllergy[] = [],
  ) => service.buildCandidates(userId, medicines, allergies);

  it('detects the same medicine master once without duplicating the ingredient finding', () => {
    const findings = build('patient-1', [
      medicine({ id: 'a', masterId: 'master-1', ingredient: 'paracetamol' }),
      medicine({ id: 'b', masterId: 'master-1', ingredient: 'paracetamol' }),
    ]);

    expect(findings.map((item) => item.rule)).toEqual([
      MedicationSafetyRule.EXACT_DUPLICATE,
    ]);
  });

  it('detects shared ingredients and a real date/day/time overlap', () => {
    const findings = build('patient-1', [
      medicine({
        id: 'a',
        masterId: 'master-a',
        name: 'Brand A',
        ingredient: 'paracetamol',
        time: '08:00',
        day: 1,
      }),
      medicine({
        id: 'b',
        masterId: 'master-b',
        name: 'Brand B',
        ingredient: 'paracetamol',
        time: '8:00',
        day: 1,
      }),
    ]);

    expect(findings.map((item) => item.rule)).toEqual(
      expect.arrayContaining([
        MedicationSafetyRule.DUPLICATE_INGREDIENT,
        MedicationSafetyRule.OVERLAPPING_SCHEDULE,
      ]),
    );
  });

  it('does not report schedule overlap when saved days differ', () => {
    const findings = build('patient-1', [
      medicine({ id: 'a', ingredient: 'paracetamol', time: '08:00', day: 1 }),
      medicine({ id: 'b', ingredient: 'paracetamol', time: '08:00', day: 2 }),
    ]);

    expect(
      findings.some(
        (item) => item.rule === MedicationSafetyRule.OVERLAPPING_SCHEDULE,
      ),
    ).toBe(false);
  });

  it('raises a high finding only for an exact normalized allergy ingredient match', () => {
    const allergy: EvaluatedAllergy = {
      id: 'allergy-1',
      userId: 'patient-1',
      saltProfileId: null,
      substanceRaw: 'Amoxycillin',
      normalizedSubstance: 'amoxicillin',
      category: AllergyCategory.ALLERGY,
      criticality: AllergyCriticality.UNABLE_TO_ASSESS,
      reaction: null,
      clinicalStatus: AllergyClinicalStatus.ACTIVE,
      verificationStatus: SafetyVerificationStatus.UNVERIFIED,
      source: SafetyRecordSource.PATIENT_REPORTED,
      verifiedAt: null,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
      saltProfile: null,
    };
    const findings = build(
      'patient-1',
      [medicine({ id: 'a', ingredient: 'amoxicillin' })],
      [allergy],
    );

    expect(findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          rule: MedicationSafetyRule.ALLERGY_CONFLICT,
          severity: MedicationSafetySeverity.HIGH,
        }),
      ]),
    );
  });

  it('fails closed when no reliable composition is linked', () => {
    const findings = build('patient-1', [medicine({ id: 'unknown' })]);

    expect(findings).toEqual([
      expect.objectContaining({
        rule: MedicationSafetyRule.UNKNOWN_COMPOSITION,
        severity: MedicationSafetySeverity.INFO,
      }),
    ]);
  });

  it('scopes stable fingerprints by patient', () => {
    const medicines = [medicine({ id: 'unknown' })];
    const first = build('patient-1', medicines)[0].fingerprint;
    const second = build('patient-2', medicines)[0].fingerprint;

    expect(first).not.toEqual(second);
    expect(build('patient-1', medicines)[0].fingerprint).toEqual(first);
  });
});
