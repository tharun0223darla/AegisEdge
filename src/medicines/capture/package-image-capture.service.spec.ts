import { PackageImageCaptureService } from './package-image-capture.service';

describe('PackageImageCaptureService', () => {
  const service = new PackageImageCaptureService();

  it('extracts likely brand and strength from cluttered strip OCR', () => {
    const result = service.extractCandidate({
      confidence: 82,
      rawText: [
        'MFD BY MICRO LABS LTD',
        'DOLO 650',
        'PARACETAMOL TABLETS IP 650 mg',
        'B.No AB123 MFG 06/26 EXP 05/28',
        'MRP Rs. 35.00',
      ].join('\n'),
      lines: [
        {
          text: 'MFD BY MICRO LABS LTD',
          confidence: 0.9,
          bbox: [
            [0, 0],
            [180, 0],
            [180, 22],
            [0, 22],
          ],
        },
        {
          text: 'DOLO 650',
          confidence: 0.86,
          bbox: [
            [0, 30],
            [280, 30],
            [280, 86],
            [0, 86],
          ],
        },
        {
          text: 'PARACETAMOL TABLETS IP 650 mg',
          confidence: 0.8,
          bbox: [
            [0, 92],
            [260, 92],
            [260, 122],
            [0, 122],
          ],
        },
        {
          text: 'B.No AB123 MFG 06/26 EXP 05/28',
          confidence: 0.95,
          bbox: [
            [0, 130],
            [260, 130],
            [260, 150],
            [0, 150],
          ],
        },
      ],
    });

    expect(result).toEqual(
      expect.objectContaining({
        rawName: 'DOLO 650',
        extractedStrength: '650mg',
        ocrLine: 'DOLO 650',
        weak: false,
      }),
    );
  });

  it('returns null when OCR only contains package noise', () => {
    const result = service.extractCandidate({
      confidence: 75,
      rawText: ['Batch AB123', 'MFG 06/26 EXP 05/28', 'MRP Rs. 35.00'].join(
        '\n',
      ),
    });

    expect(result).toBeNull();
  });

  it('marks a low-confidence candidate as weak instead of promoting it', () => {
    const result = service.extractCandidate({
      confidence: 25,
      rawText: 'Azithral 500 mg',
      lines: [{ text: 'Azithral 500 mg', confidence: 0.22 }],
    });

    expect(result).toEqual(
      expect.objectContaining({
        rawName: 'Azithral 500mg',
        extractedStrength: '500mg',
        weak: true,
      }),
    );
    expect(service.isReviewableCandidate(result)).toBe(true);
  });

  it('prefers a repeated strip brand over broken IP-strength OCR fragments', () => {
    const result = service.extractCandidate({
      confidence: 64,
      rawText: [
        'Ferrous Ascorbate & Folic Acid Tablets',
        'ArteferXT',
        'a io AGI a IP) 5mg IS Zi',
        'ArteferXT',
        'B.No. AF123 MFG 06/26',
      ].join('\n'),
      lines: [
        {
          text: 'Ferrous Ascorbate & Folic Acid Tablets',
          confidence: 0.72,
          bbox: [
            [0, 0],
            [230, 0],
            [230, 28],
            [0, 28],
          ],
        },
        {
          text: 'ArteferXT',
          confidence: 0.62,
          bbox: [
            [0, 30],
            [150, 30],
            [150, 68],
            [0, 68],
          ],
        },
        {
          text: 'a io AGI a IP) 5mg IS Zi',
          confidence: 0.82,
          bbox: [
            [0, 72],
            [260, 72],
            [260, 105],
            [0, 105],
          ],
        },
        {
          text: 'ArteferXT',
          confidence: 0.58,
          bbox: [
            [0, 110],
            [150, 110],
            [150, 148],
            [0, 148],
          ],
        },
      ],
    });

    expect(result).toEqual(
      expect.objectContaining({
        rawName: 'ArteferXT',
        extractedStrength: undefined,
        ocrLine: 'ArteferXT',
        composition: expect.objectContaining({
          displayName: 'Ferrous Ascorbate + Folic Acid',
          ingredients: ['Ferrous Ascorbate', 'Folic Acid'],
        }),
      }),
    );
  });

  it('rejects broken IP-strength fragments when no brand-like line is present', () => {
    const result = service.extractCandidate({
      confidence: 76,
      rawText: 'a io AGI a IP) 5mg IS Zi',
      lines: [{ text: 'a io AGI a IP) 5mg IS Zi', confidence: 0.82 }],
    });

    expect(result).toBeNull();
  });

  it('rejects fragmented OCR instead of inferring a medicine or strength', () => {
    const result = service.extractCandidate({
      success: true,
      source: 'ML_KIT',
      confidence: 72,
      rawText: '= EE 2 HEHE EE a Ec a 2g',
      lines: [{ text: '= EE 2 HEHE EE a Ec a', confidence: 0.72 }],
    });

    expect(result).toBeNull();
    expect(service.isReviewableCandidate(result)).toBe(false);
  });

  it('never parses a candidate from an OCR result marked NO_RESULT', () => {
    const result = service.extractCandidate({
      success: false,
      source: 'NO_RESULT',
      confidence: 90,
      rawText: 'Vopaxa-200 Cefpodoxime Dispersible Tablets 200 mg',
    });

    expect(result).toBeNull();
  });

  it('extracts the Vopaxa brand, Cefpodoxime composition, and 200mg strength', () => {
    const result = service.extractCandidate({
      success: true,
      source: 'ML_KIT',
      confidence: 88,
      rawText: 'Vopaxa-200\nCefpodoxime Dispersible Tablets 200 mg',
      lines: [
        { text: 'Vopaxa-200', confidence: 0.9 },
        {
          text: 'Cefpodoxime Dispersible Tablets 200 mg',
          confidence: 0.88,
        },
      ],
    });

    expect(result?.rawName).toBe('Vopaxa-200');
    expect(result?.extractedStrength).toBe('200mg');
    expect(result?.weak).toBe(false);
    expect(result?.composition?.displayName).toBe('Cefpodoxime');
    expect(result?.composition?.ingredients).toEqual(['Cefpodoxime']);
  });

  it('extracts a brand token from noisy Tesseract strip OCR', () => {
    const result = service.extractCandidate({
      confidence: 28,
      rawText: [
        'BC orPANEAScorbate & TN',
        'BR Folic Acid Tablas |',
        'BE  ArteferXr 2',
        'AN \\ RR 0q. to elemental iron SOG',
        'Sl folic Acid IP Aa sg |',
        'Rs Exciplents cc 4 REN eg : WA |W Po CD',
        'BREET RPOTT CfO LL  .  N. Tho (a 2 ox',
      ].join('\n'),
    });

    expect(result).toEqual(
      expect.objectContaining({
        rawName: 'ArteferXr',
        ocrLine: 'BE ArteferXr 2',
        weak: true,
      }),
    );
    expect(result?.composition?.ingredients).toContain('Folic Acid');
    expect(result?.composition?.ingredients).not.toContain('Ferrous Ascorbate');
  });

  it('extracts an unseen fictitious brand and single generic without a medicine vocabulary', () => {
    const result = service.extractCandidate({
      confidence: 91,
      rawText: [
        'NEUROVEXA XR 37.5',
        'Venlafaxine Extended Release Tablets 37.5 mg',
        '14 tablets',
      ].join('\n'),
      lines: [
        { text: 'NEUROVEXA XR 37.5', confidence: 0.92 },
        {
          text: 'Venlafaxine Extended Release Tablets 37.5 mg',
          confidence: 0.9,
        },
        { text: '14 tablets', confidence: 0.95 },
      ],
    });

    expect(result?.rawName).toBe('NEUROVEXA XR');
    expect(result?.extractedStrength).toBe('37.5mg');
    expect(result?.composition?.ingredients).toEqual(['Venlafaxine']);
  });

  it('extracts unseen combination ingredients using layout and grammar only', () => {
    const result = service.extractCandidate({
      confidence: 89,
      rawText: [
        'GLYTORAN-M',
        'Empagliflozin 12.5 mg & Linagliptin 5 mg Tablets',
        '10 film coated tablets',
      ].join('\n'),
      lines: [
        { text: 'GLYTORAN-M', confidence: 0.91 },
        {
          text: 'Empagliflozin 12.5 mg & Linagliptin 5 mg Tablets',
          confidence: 0.87,
        },
        { text: '10 film coated tablets', confidence: 0.94 },
      ],
    });

    expect(result?.rawName).toBe('GLYTORAN-M');
    expect(result?.composition?.ingredients).toEqual([
      'Empagliflozin',
      'Linagliptin',
    ]);
  });

  it('ignores regulatory foil text around an unseen repeated package identity', () => {
    const lines = [
      { text: 'TM-Trademark applied for', confidence: 0.999 },
      { text: 'Doxofylline Tablets IP', confidence: 1 },
      {
        text: 'of a Registered Medical Practitioner only.',
        confidence: 0.995,
      },
      { text: 'DOXOLIN', confidence: 0.98 },
      { text: 'Each uncoated tablet contains:', confidence: 0.99 },
      { text: 'Doxofylline IP 400 mg', confidence: 0.994 },
      { text: 'Mkt. by: German Remedies', confidence: 0.976 },
      { text: 'DOXOLIN', confidence: 0.94 },
    ];
    const result = service.extractCandidate({
      confidence: 92,
      rawText: lines.map((line) => line.text).join('\n'),
      lines,
    });

    expect(result?.rawName).toBe('DOXOLIN');
    expect(result?.extractedStrength).toBe('400mg');
    expect(result?.composition?.ingredients).toEqual(['Doxofylline']);
  });

  it('keeps a composition-only strip usable when the brand logo is unreadable', () => {
    const result = service.extractCandidate({
      confidence: 42,
      rawText: [
        'Ferrous Ascorbate &',
        'Folic Acid Tablets',
        'B.No. AF123 MFG 06/26 EXP 05/28',
      ].join('\n'),
      lines: [
        { text: 'Ferrous Ascorbate &', confidence: 0.62 },
        { text: 'Folic Acid Tablets', confidence: 0.64 },
        { text: 'B.No. AF123 MFG 06/26 EXP 05/28', confidence: 0.9 },
      ],
    });

    expect(result).toEqual(
      expect.objectContaining({
        rawName: 'Ferrous Ascorbate + Folic Acid',
        weak: true,
        reason: 'Composition detected, brand unclear',
        composition: expect.objectContaining({
          displayName: 'Ferrous Ascorbate + Folic Acid',
          searchTerms: expect.arrayContaining([
            'Ferrous Ascorbate + Folic Acid',
            'Ferrous Ascorbate Folic Acid',
          ]),
        }),
      }),
    );
    expect(service.isReviewableCandidate(result)).toBe(true);
  });

  it('preserves combination strengths and compact pack notation', () => {
    const result = service.extractCandidate({
      confidence: 87,
      rawText: 'Dartmox CV 500mg/125mg\n10 x 10 tablets',
      lines: [
        { text: 'Dartmox CV 500mg/125mg', confidence: 0.88 },
        { text: '10 x 10 tablets', confidence: 0.92 },
      ],
    });

    expect(result).toEqual(
      expect.objectContaining({
        rawName: 'Dartmox CV 500mg/125mg',
        extractedStrength: '500mg/125mg',
        extractedPack: '10 x 10 tablets',
      }),
    );
  });

  it('keeps a printed brand above generic ingredients on combination packs', () => {
    const lines = [
      { text: 'ONCEDAILY', confidence: 1 },
      { text: 'NOFORGEHCT', confidence: 1 },
      { text: '10mg/160mg/25mg', confidence: 1 },
      { text: 'Amlodipine, Valsartan &', confidence: 0.99 },
      { text: 'Hydrochlorothiazide tablets', confidence: 1 },
      { text: 'Composition:', confidence: 0.79 },
      { text: 'Each film-coated tablet contains:', confidence: 0.95 },
      { text: 'Valsartan USP', confidence: 0.98 },
      { text: '160mg', confidence: 0.99 },
      { text: 'Amlodipine (as besylate) USP', confidence: 0.91 },
      { text: '10mg', confidence: 0.95 },
      { text: 'Hydrochlorothiazide USP', confidence: 0.86 },
      { text: '25mg', confidence: 1 },
      { text: '10 Film coated tablets', confidence: 0.99 },
    ];
    const result = service.extractCandidate({
      success: true,
      source: 'SERVER_OCR',
      confidence: 78,
      rawText: lines.map((line) => line.text).join('\n'),
      lines,
    });

    expect(result).toEqual(
      expect.objectContaining({
        rawName: 'NOFORGEHCT',
        extractedStrength: '10mg/160mg/25mg',
        extractedPack: '10 Film coated tablets',
        weak: false,
      }),
    );
    expect(result?.composition?.ingredients).toEqual([
      'Amlodipine',
      'Valsartan',
      'Hydrochlorothiazide',
    ]);
  });

  it('reconstructs DALSTEP from repeated printing and a single-ingredient line', () => {
    const lines = [
      { text: 'DALSTEP DALSTEP', confidence: 0.92 },
      { text: 'Dalfampridine Extended Release Tablet', confidence: 0.96 },
      { text: 'DALSTEP', confidence: 0.9 },
      {
        text: 'Each film coated extended release tablet contains:',
        confidence: 0.83,
      },
      { text: 'Dalfampridine USP 10 mg', confidence: 0.94 },
      { text: 'SUN PHARMA LABORATORIES LTD.', confidence: 0.95 },
    ];
    const result = service.extractCandidate({
      success: true,
      source: 'SERVER_OCR',
      confidence: 91,
      rawText: lines.map((line) => line.text).join('\n'),
      lines,
    });

    expect(result).toEqual(
      expect.objectContaining({
        rawName: 'DALSTEP',
        extractedStrength: '10mg',
      }),
    );
    expect(result?.composition?.displayName).toBe('Dalfampridine');
    expect(result?.composition?.ingredients).toEqual(['Dalfampridine']);
  });

  it('rejects manufacturer text and extracts Risdone-1 with Risperidone', () => {
    const lines = [
      { text: 'INTAS PHARMACEUTICALS LTD.', confidence: 0.98 },
      { text: 'Risperidone Tablets USP 1 mg', confidence: 0.92 },
      { text: 'Risdone-1', confidence: 0.89 },
      { text: 'Each uncoated tablet contains:', confidence: 0.82 },
      { text: 'Risperidone USP 1 mg', confidence: 0.9 },
      { text: 'Risdone-1', confidence: 0.86 },
    ];
    const result = service.extractCandidate({
      success: true,
      source: 'SERVER_OCR',
      confidence: 76,
      rawText: lines.map((line) => line.text).join('\n'),
      lines,
    });

    expect(result).toEqual(
      expect.objectContaining({
        rawName: 'Risdone-1',
        extractedStrength: '1mg',
      }),
    );
    expect(result?.composition?.displayName).toBe('Risperidone');
    expect(result?.composition?.ingredients).toEqual(['Risperidone']);
  });

  it('rejects corporate text when OCR removes every space', () => {
    const lines = [
      { text: 'PHARMACEUTICALSLTD', confidence: 0.99 },
      { text: 'PRESCRPTIONORUS', confidence: 0.99 },
      { text: 'Risperidone Tablets I.P. 1mg', confidence: 0.82 },
      { text: 'fbeperidone USP 1 mg', confidence: 0.96 },
      { text: 'Risdone-1', confidence: 0.74 },
    ];
    const result = service.extractCandidate({
      success: true,
      source: 'SERVER_OCR',
      confidence: 85,
      rawText: lines.map((line) => line.text).join('\n'),
      lines,
    });

    expect(result).toEqual(
      expect.objectContaining({
        rawName: 'Risdone-1',
        extractedStrength: '1mg',
      }),
    );
    expect(result?.composition?.displayName).toBe('Risperidone');
  });

  it('prefers TOCATE 25 over a truncated P25mg strength fragment', () => {
    const lines = [
      { text: 'Oopiramate Tabicss', confidence: 0.62 },
      { text: 'P25mg', confidence: 0.74 },
      { text: 'TOCATE 25', confidence: 0.68 },
      { text: 'Store below 25 C in a dry place', confidence: 0.8 },
    ];
    const result = service.extractCandidate({
      success: true,
      source: 'SERVER_OCR',
      confidence: 69,
      rawText: lines.map((line) => line.text).join('\n'),
      lines,
    });

    expect(result).toEqual(
      expect.objectContaining({
        rawName: 'TOCATE 25',
        extractedStrength: '25mg',
      }),
    );
  });

  it('ignores repeated rotated print and extracts ISMO 10 identity', () => {
    const lines = [
      { text: 'OWSI O1.OWSI 01.OWSI OL.OWSI', confidence: 0.81 },
      { text: 'Isosorbide Mononitrate', confidence: 0.91 },
      { text: 'Tablets I.P.', confidence: 0.9 },
      { text: 'ISMO*10', confidence: 0.88 },
      { text: '10 mg', confidence: 0.93 },
      { text: 'Manufactured by Abbott Healthcare Pvt Ltd', confidence: 0.9 },
    ];
    const result = service.extractCandidate({
      success: true,
      source: 'SERVER_OCR',
      confidence: 63,
      rawText: lines.map((line) => line.text).join('\n'),
      lines,
    });

    expect(result).toEqual(
      expect.objectContaining({
        rawName: 'ISMO 10',
        extractedStrength: '10mg',
      }),
    );
    expect(result?.composition?.displayName).toBe('Isosorbide Mononitrate');
    expect(result?.composition?.ingredients).toEqual([
      'Isosorbide Mononitrate',
    ]);
  });
});
