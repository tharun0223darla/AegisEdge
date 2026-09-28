import { PatientExplanationService } from './patient-explanation.service';

describe('PatientExplanationService', () => {
  const trustedRefs = {
    uses: [{ sourceType: 'DailyMed', provider: 'DailyMed / National Library of Medicine' }],
    howToTake: [{ sourceType: 'openFDA', provider: 'openFDA' }],
    warnings: [{ sourceType: 'openFDA', provider: 'openFDA' }],
    sideEffects: [{ sourceType: 'DailyMed', provider: 'DailyMed / National Library of Medicine' }],
  };

  it('turns sourced Azathioprine label sections into patient-friendly English', () => {
    const service = new PatientExplanationService({} as any);

    const fields = service.generateFields({
      displayName: 'Azathioprine 50mg',
      uses:
        'INDICATIONS AND USAGE Azathioprine tablets are indicated as an adjunct for the prevention of rejection in renal homotransplantation. It is also indicated for the management of active rheumatoid arthritis to reduce signs and symptoms.',
      howToTake:
        'DOSAGE AND ADMINISTRATION Renal Homotransplantation The dose of azathioprine tablets required to prevent rejection and minimize toxicity will vary with individual patients; this necessitates careful management. The initial dose is usually 3 to 5 mg/kg daily, beginning at the time of transplant. Dose reduction to maintenance levels of 1 to 3 mg/kg daily is usually possible. Discontinuation may be necessary for severe hematologic or other toxicity. Rheumatoid Arthritis Azathioprine tablets are usually given on a daily basis. The initial dose should be approximately 1.0 mg/kg (50 to 100 mg) given as a single dose or on a twice-daily schedule. The dose may be increased, beginning at 6 to 8 weeks and thereafter by steps at 4-week intervals, if there are no serious toxicities and if initial response is unsatisfactory. Dose increments should be 0.5 mg/kg daily, up to a maximum dose of 2.5 mg/kg per day.',
      warnings:
        'WARNINGS Patients receiving immunosuppressants, including azathioprine, are at increased risk of developing lymphoma and other malignancies, particularly of the skin. Physicians should inform patients of the risk of malignancy with azathioprine.',
      sideEffects: [
        'ADVERSE REACTIONS The principal and potentially serious toxic effects are hematologic and gastrointestinal. The risks of secondary infection and malignancy are also significant.',
      ],
      sourceRefs: trustedRefs,
    });

    expect(fields.whyPrescribed).toContain('kidney transplant');
    expect(fields.whyPrescribed).toContain('rheumatoid arthritis');
    expect(fields.howToTake).toContain('Source summary');
    expect(fields.howToTake).toContain('3 to 5 mg/kg daily');
    expect(fields.howToTake).toContain('1.0 mg/kg (50 to 100 mg)');
    expect(fields.howToTake).toContain('2.5 mg/kg per day');
    expect(fields.warnings).toContain('skin cancer');
    expect(fields.sideEffects).toEqual(
      expect.arrayContaining([
        'blood-related problems',
        'stomach upset, nausea, vomiting, or diarrhea',
        'higher risk of infection',
      ]),
    );
    expect(fields.sourceRefs).toMatchObject({
      whyPrescribed: trustedRefs.uses,
      howToTake: trustedRefs.howToTake,
      warnings: trustedRefs.warnings,
      sideEffects: trustedRefs.sideEffects,
    });
    expect(fields.unsafeOmittedFields).toEqual([]);
  });

  it('does not generate patient-friendly fields from unsourced clinical text', () => {
    const service = new PatientExplanationService({} as any);

    const fields = service.generateFields({
      displayName: 'Unsafe 10mg',
      uses: 'This drug is used for a condition.',
      warnings: 'This drug has important warnings.',
      sourceRefs: {},
    });

    expect(fields.whyPrescribed).toBeUndefined();
    expect(fields.warnings).toBeUndefined();
    expect(fields.sourceRefs).toEqual({});
    expect(fields.unsafeOmittedFields).toEqual(['whyPrescribed', 'warnings']);
  });

  it('generates patient-friendly fields from NFI/IPC sourced clinical text', () => {
    const service = new PatientExplanationService({} as any);

    const fields = service.generateFields({
      displayName: 'Arteether 150mg',
      uses: 'Arteether is used in the treatment of malaria as directed by a physician.',
      sourceRefs: {
        uses: [
          {
            sourceType: 'NFI_IPC',
            provider: 'Indian Pharmacopoeia Commission',
            title: 'National Formulary of India 2021 - Arteether monograph',
          },
        ],
      },
    });

    expect(fields.whyPrescribed).toContain('Arteether');
    expect(fields.sourceRefs.whyPrescribed).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ sourceType: 'NFI_IPC' }),
      ]),
    );
    expect(fields.unsafeOmittedFields).toEqual([]);
  });
  it('upserts generated explanations only when commit mode is used', async () => {
    const profile = {
      id: 'salt-1',
      saltKey: 'azathioprine-50mg',
      displayName: 'Azathioprine 50mg',
      uses: 'Azathioprine is indicated for active rheumatoid arthritis.',
      sourceRefs: { uses: trustedRefs.uses },
    };
    const prisma = {
      saltProfile: { findUnique: jest.fn().mockResolvedValue(profile) },
      patientExplanation: { upsert: jest.fn() },
    };
    const service = new PatientExplanationService(prisma as any);

    const dryRun = await service.generateForSaltProfile('salt-1', { dryRun: true });
    expect(dryRun.status).toBe('GENERATED');
    expect(prisma.patientExplanation.upsert).not.toHaveBeenCalled();

    await service.generateForSaltProfile('salt-1', { dryRun: false });
    expect(prisma.patientExplanation.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { saltProfileId_language: { saltProfileId: 'salt-1', language: 'en' } },
      }),
    );
  });
});