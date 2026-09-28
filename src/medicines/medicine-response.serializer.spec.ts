import { MedicineResponseSerializer } from './medicine-response.serializer';

describe('MedicineResponseSerializer', () => {
  it('keeps the stored strip OCR private while exposing reference readiness', () => {
    const serializer = new MedicineResponseSerializer();

    const response: unknown = serializer.mapMedicine({
      id: 'med_strip',
      userId: 'user_1',
      name: 'Dolo 650',
      remainingQuantity: 5,
      userStripImageUrl: '/api/medicines/package-image/private-strip.jpg',
      userStripOcrText: 'DOLO 650 PARACETAMOL 650 MG',
      medicinePackage: null,
      medicineMaster: null,
    });

    expect(response).toMatchObject({ stripReferenceReady: true });
    expect(response).not.toHaveProperty('userStripOcrText');
  });

  it('omits clinical fields without matching source refs and marks enrichment unsafe', () => {
    const serializer = new MedicineResponseSerializer();

    const response = serializer.mapMedicine({
      id: 'med_1',
      userId: 'user_1',
      name: 'Unsafe Detail Test',
      remainingQuantity: 10,
      medicinePackage: null,
      medicineMaster: {
        id: 'master_1',
        brandName: 'Unsafe Detail Test',
        composition: 'Test ingredient 10mg',
        packages: [],
        saltProfile: {
          id: 'salt_1',
          saltKey: 'test-ingredient-10mg',
          displayName: 'Test ingredient 10mg',
          enrichmentStatus: 'PARTIAL',
          uses: 'This should not be serialized without a source.',
          warnings: 'This warning is sourced.',
          sourceRefs: {
            warnings: [
              { sourceType: 'openFDA', title: 'Verified warning source' },
            ],
          },
        },
      },
    });

    expect(response.enrichment.uses).toBeNull();
    expect(response.enrichment.warnings).toBe('This warning is sourced.');
    expect(response.enrichment.enrichmentStatus).toBe('NEEDS_SOURCE');
    expect(response.enrichment.unsafeOmittedFields).toContain('uses');
  });

  it('does not trust local starter seed source refs as production clinical sources', () => {
    const serializer = new MedicineResponseSerializer();

    const response = serializer.mapMedicine({
      id: 'med_2',
      userId: 'user_1',
      name: 'Seed Detail Test',
      remainingQuantity: 10,
      medicinePackage: null,
      medicineMaster: {
        id: 'master_2',
        brandName: 'Seed Detail Test',
        composition: 'Paracetamol 650mg',
        packages: [],
        saltProfile: {
          id: 'salt_2',
          saltKey: 'paracetamol-650mg',
          displayName: 'Paracetamol 650mg',
          enrichmentStatus: 'COMPLETE',
          sideEffects: ['Nausea'],
          sourceRefs: {
            sideEffects: [
              {
                sourceType: 'local_starter_knowledge_base',
                title: 'MediTrack starter patient education seed',
              },
            ],
          },
        },
      },
    });

    expect(response.enrichment.sideEffects).toEqual([]);
    expect(response.enrichment.status).toBe('NEEDS_SOURCE');
    expect(response.enrichment.enrichmentStatus).toBe('NEEDS_SOURCE');
    expect(response.enrichment.unsafeOmittedFields).toContain('sideEffects');
  });

  it('serializes prescription requirement and package price metadata', () => {
    const serializer = new MedicineResponseSerializer();

    const response = serializer.mapMaster({
      id: 'master_3',
      brandName: 'Abixim 100mg',
      composition: 'Cefixime (100mg)',
      manufacturer: 'Abbott',
      type: 'tablet',
      isDiscontinued: false,
      prescriptionRequired: true,
      packages: [
        {
          id: 'pack_1',
          medicineId: 'master_3',
          packSize: 'strip of 10 tablets',
          mrpPrice: { toString: () => '87.50' },
          priceCurrency: 'INR',
          priceSource: '1mg-2025',
          priceLastSeenAt: new Date('2026-07-05T00:00:00.000Z'),
          isVerified: false,
        },
      ],
    });

    expect(response?.prescriptionRequired).toBe(true);
    expect(response?.packages?.[0]).toMatchObject({
      mrpPrice: '87.50',
      priceCurrency: 'INR',
      priceSource: '1mg-2025',
    });
  });

  it('omits unsafe salt profile fields from master search responses', () => {
    const serializer = new MedicineResponseSerializer();

    const response = serializer.mapMaster({
      id: 'master_4',
      brandName: 'Dartmox CV 500mg/125mg',
      composition: 'Amoxycillin (500mg) + Clavulanic Acid (125mg)',
      packages: [],
      saltProfile: {
        id: 'salt_4',
        saltKey: 'amoxicillin-500mg+clavulanic-acid-125mg',
        displayName: 'Amoxicillin 500mg + Clavulanic Acid 125mg',
        enrichmentStatus: 'COMPLETE',
        uses: 'Unsafe local seed use text.',
        warnings: 'Unsafe local seed warning text.',
        sourceRefs: {
          uses: [{ sourceType: 'local_starter_knowledge_base' }],
          warnings: [{ sourceType: 'local_starter_knowledge_base' }],
        },
      },
    });

    expect(response?.saltProfile?.uses).toBeNull();
    expect(response?.saltProfile?.warnings).toBeNull();
    expect(response?.saltProfile?.enrichmentStatus).toBe('NEEDS_SOURCE');
  });

  it('trusts DailyMed source refs for clinical fields', () => {
    const serializer = new MedicineResponseSerializer();

    const response = serializer.mapMaster({
      id: 'master_5',
      brandName: 'DailyMed Test',
      composition: 'Tafamidis (61mg)',
      packages: [],
      saltProfile: {
        id: 'salt_5',
        saltKey: 'tafamidis-61mg',
        displayName: 'Tafamidis 61mg',
        enrichmentStatus: 'PARTIAL',
        uses: 'Sourced DailyMed use text.',
        sourceRefs: {
          uses: [
            {
              sourceType: 'DailyMed',
              provider: 'DailyMed / National Library of Medicine',
            },
          ],
        },
      },
    });

    expect(response?.saltProfile?.uses).toBe('Sourced DailyMed use text.');
    expect(response?.saltProfile?.enrichmentStatus).toBe('PARTIAL');
  });

  it('quarantines clinical fields contaminated by a non-human source', () => {
    const serializer = new MedicineResponseSerializer();
    const response = serializer.mapMaster({
      id: 'master-contaminated',
      brandName: 'Pyloripan-DSR',
      composition: 'Domperidone 30mg + Pantoprazole 40mg',
      type: 'capsule',
      packages: [],
      saltProfile: {
        id: 'salt-contaminated',
        saltKey: 'domperidone-30mg+pantoprazole-40mg',
        displayName: 'Domperidone 30mg + Pantoprazole 40mg',
        warnings: 'Not for use in humans. Avoid accidental self-injection.',
        sourceRefs: {
          warnings: [
            {
              sourceType: 'DailyMed',
              title: 'OVAPRIM (SGNRHA AND DOMPERIDONE) INJECTION, SOLUTION',
            },
          ],
        },
      },
    });

    expect(response?.saltProfile?.warnings).toBeNull();
    expect(response?.saltProfile?.enrichmentStatus).toBe('NEEDS_SOURCE');
  });

  it('hides injection-only patient guidance for an oral medicine', () => {
    const serializer = new MedicineResponseSerializer();
    expect(
      serializer.mapMedicine({
        id: 'med-oral',
        name: 'Oral medicine',
        form: 'CAPSULE',
        medicinePackage: null,
        medicineMaster: {
          id: 'master-oral',
          brandName: 'Oral medicine',
          type: 'capsule',
          packages: [],
          saltProfile: {
            id: 'salt-oral',
            displayName: 'Pantoprazole 40mg',
            patientExplanations: [
              {
                id: 'explanation-injection',
                language: 'en',
                status: 'GENERATED',
                howToTake:
                  'Administer by intravenous injection or intravenous infusion for 15 minutes.',
                sourceRefs: {
                  howToTake: [{ sourceType: 'openFDA', provider: 'openFDA' }],
                },
              },
            ],
          },
        },
      }),
    ).toMatchObject({ enrichment: { patientExplanation: null } });
  });

  it('trusts NFI/IPC source refs for clinical fields', () => {
    const serializer = new MedicineResponseSerializer();

    const response = serializer.mapMaster({
      id: 'master_nfi',
      brandName: 'NFI Test',
      composition: 'Arteether (150mg)',
      packages: [],
      saltProfile: {
        id: 'salt_nfi',
        saltKey: 'arteether-150mg',
        displayName: 'Arteether 150mg',
        enrichmentStatus: 'PARTIAL',
        warnings: 'Sourced NFI warning text.',
        sourceRefs: {
          warnings: [
            {
              sourceType: 'NFI_IPC',
              provider: 'Indian Pharmacopoeia Commission',
              title: 'National Formulary of India 2021 - Arteether monograph',
            },
          ],
        },
      },
    });

    expect(response?.saltProfile?.warnings).toBe('Sourced NFI warning text.');
    expect(response?.saltProfile?.enrichmentStatus).toBe('PARTIAL');
  });
  it('serializes only source-backed patient-friendly explanations', () => {
    const serializer = new MedicineResponseSerializer();

    const response = serializer.mapMedicine({
      id: 'med_6',
      userId: 'user_1',
      name: 'Azathioprine Test',
      remainingQuantity: 10,
      medicinePackage: null,
      medicineMaster: {
        id: 'master_6',
        brandName: 'Azathioprine Test',
        composition: 'Azathioprine 50mg',
        packages: [],
        saltProfile: {
          id: 'salt_6',
          saltKey: 'azathioprine-50mg',
          displayName: 'Azathioprine 50mg',
          enrichmentStatus: 'PARTIAL',
          patientExplanations: [
            {
              id: 'explanation_1',
              language: 'en',
              status: 'GENERATED',
              whyPrescribed:
                'Azathioprine may be prescribed to lower immune system activity after a kidney transplant or for active rheumatoid arthritis.',
              warnings:
                'This medicine can raise infection and cancer risk. Ask your doctor what symptoms to watch for.',
              sourceRefs: {
                whyPrescribed: [
                  {
                    sourceType: 'DailyMed',
                    provider: 'DailyMed / National Library of Medicine',
                  },
                ],
                warnings: [{ sourceType: 'openFDA', provider: 'openFDA' }],
              },
            },
          ],
        },
      },
    });

    expect(response.enrichment.patientExplanation).toMatchObject({
      language: 'en',
      whyPrescribed:
        'Azathioprine may be prescribed to lower immune system activity after a kidney transplant or for active rheumatoid arthritis.',
      warnings:
        'This medicine can raise infection and cancer risk. Ask your doctor what symptoms to watch for.',
    });
    expect(response.enrichment.patientExplanation.unsafeOmittedFields).toEqual(
      [],
    );
  });

  it('omits patient-friendly explanation fields that do not have source refs', () => {
    const serializer = new MedicineResponseSerializer();

    const response = serializer.mapMaster({
      id: 'master_7',
      brandName: 'Unsourced Friendly Text',
      composition: 'Test drug 10mg',
      packages: [],
      saltProfile: {
        id: 'salt_7',
        saltKey: 'test-drug-10mg',
        displayName: 'Test Drug 10mg',
        patientExplanations: [
          {
            id: 'explanation_2',
            language: 'en',
            status: 'GENERATED',
            whyPrescribed:
              'This friendly sentence must be hidden without a source.',
            sourceRefs: {},
          },
        ],
      },
    });

    expect(response?.saltProfile?.patientExplanations?.[0]).toMatchObject({
      language: 'en',
      status: 'NEEDS_SOURCE',
      whyPrescribed: null,
      unsafeOmittedFields: ['whyPrescribed'],
    });
  });
});
