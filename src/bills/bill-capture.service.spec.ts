import { BillCaptureService } from './bill-capture.service';

describe('BillCaptureService', () => {
  const service = new BillCaptureService();

  it('extracts one candidate per printed medicine line', () => {
    const result = service.extractCandidates({
      rawText: [
        'Apollo Pharmacy',
        'DOLO 650 TAB 15S 1 30.00',
        'AUGMENTIN 625 DUO TAB 10S 1 190.50',
        'CGST 6% 11.43',
        'Grand Total 231.93',
      ].join('\n'),
    });

    expect(result).toEqual([
      expect.objectContaining({
        rawName: 'DOLO 650',
        billLine: 'DOLO 650 TAB 15S 1 30.00',
        extractedPack: '15S',
        quantity: 1,
      }),
      expect.objectContaining({
        rawName: 'AUGMENTIN 625 DUO',
        billLine: 'AUGMENTIN 625 DUO TAB 10S 1 190.50',
        quantity: 1,
      }),
    ]);
  });

  it('filters non-medicine financial and service lines', () => {
    const result = service.extractCandidates({
      rawText: [
        'Consultation Fee 500.00',
        'SGST 6% 30.00',
        'Round Off 0.20',
        'UPI PAID 530.20',
      ].join('\n'),
    });

    expect(result).toEqual([]);
  });

  it('rejects standalone manufacture and expiry dates as medicine rows', () => {
    const result = service.extractCandidates({
      rawText: [
        'Dec 2026',
        'Jul 2023',
        'EXP 08/2028',
        'MFG: Jan-2022',
        'DATE 05-May-26',
      ].join('\n'),
    });

    expect(result).toEqual([]);
  });

  it('extracts strength and pack when present', () => {
    const candidate = service.parseMedicineLine(
      'ITRANEXT 100MG CAP 10S 2 240.00',
    );

    expect(candidate).toEqual(
      expect.objectContaining({
        rawName: 'ITRANEXT 100MG',
        extractedStrength: '100MG',
        extractedPack: '10S',
      }),
    );
  });

  it('reconstructs OCR fragments into one physical bill row', () => {
    const result = service.extractCandidates({
      rawText: '',
      lines: [
        {
          text: 'DARTMOX CV',
          confidence: 0.9,
          bbox: [
            [10, 20],
            [180, 20],
            [180, 45],
            [10, 45],
          ],
        },
        {
          text: '500mg/125mg TAB',
          confidence: 0.88,
          bbox: [
            [190, 21],
            [370, 21],
            [370, 46],
            [190, 46],
          ],
        },
        {
          text: '10S 2 240.00',
          confidence: 0.86,
          bbox: [
            [390, 20],
            [520, 20],
            [520, 45],
            [390, 45],
          ],
        },
      ],
    });

    expect(result).toEqual([
      expect.objectContaining({
        rawName: 'DARTMOX CV 500mg/125mg',
        extractedStrength: '500mg/125mg',
        extractedPack: '10S',
        quantity: 2,
      }),
    ]);
  });

  it('keeps medicine rows that also contain batch or expiry metadata', () => {
    const candidate = service.parseMedicineLine(
      'AZITHRAL 500MG TAB 3S 1 BATCH AB12 EXP 08/28',
    );

    expect(candidate).toEqual(
      expect.objectContaining({
        rawName: 'AZITHRAL 500MG',
        extractedStrength: '500MG',
        extractedPack: '3S',
      }),
    );
  });

  it('does not infer a purchase quantity from strength or an unlabeled price', () => {
    const candidate = service.parseMedicineLine('DOLO 650 TAB Rs 30');

    expect(candidate).toEqual(
      expect.objectContaining({
        rawName: 'DOLO 650',
        quantity: undefined,
      }),
    );
  });

  it('keeps strengths out of quantity for simple item-only bill lines', () => {
    const result = service.extractCandidates({
      rawText: [
        'Paracetamol 500 mg',
        'Cough Syrup (200ml)',
        'Antibiotic Cream (30g)',
        'Dec 2026',
      ].join('\n'),
    });

    expect(result).toHaveLength(3);
    expect(result.every((candidate) => candidate.quantity === undefined)).toBe(
      true,
    );
  });

  it('builds dosage-aware master search terms for OCR medicine names', () => {
    expect(
      service.buildMasterSearchTerms({
        rawName: 'HCQS 200MG',
        billLine: 'HCQS 200 MG TAB',
        extractedStrength: '200MG',
      }),
    ).toEqual(['HCQS 200MG', 'HCQS 200', 'HCQS']);
    expect(
      service.buildMasterSearchTerms({
        rawName: 'SAZO-500MG',
        billLine: 'SAZO-500MG TAB',
        extractedStrength: '500MG',
      }),
    ).toEqual(['SAZO-500MG', 'SAZO-500', 'SAZO']);
  });

  it('extracts code-style medicine names from a pharmacy bill row', () => {
    expect(
      service.parseMedicineLine(
        'AU 30096QDOL-PT4 UGT-26338E Feb/28 20.0 21.90 438.00',
      ),
    ).toEqual(
      expect.objectContaining({
        rawName: 'QDOL-PT4',
      }),
    );
    expect(
      service.parseMedicineLine(
        "HAB 30049099 HAPIRAB D 1X10' LGP10/377J08 Mar/27 10.0 11.25 112.50",
      ),
    ).toEqual(
      expect.objectContaining({
        rawName: 'HAPIRAB D',
        extractedPack: '1X10',
      }),
    );
    expect(
      service.parseMedicineLine(
        'DR. Name Dr. CHANDRA SEKHAR M.S., Mch DATE 05-May-26',
      ),
    ).toBeNull();
  });

  it('extracts every row and the Qty column from a rotated pharmacy table', () => {
    const result = service.extractCandidates({
      rawText: '',
      lines: [
        line('07', 60, 323, 95, 353),
        line('3004', 149, 324, 199, 346),
        line('HCQS 200 MG TAB', 224, 323, 415, 347),
        line("10'S", 650, 321, 700, 350),
        line('GPD2326010BMar/28', 736, 321, 958, 352),
        line('40.0', 1095, 321, 1148, 348),
        line('6.84', 1300, 321, 1353, 347),
        line('273.60', 1413, 322, 1486, 347),
        line('LEE', 61, 361, 119, 388),
        line('30049099LEERAB D', 127, 361, 335, 382),
        line('1X10', 650, 357, 720, 386),
        line('LGQ02/208/28Jul/27', 736, 355, 945, 386),
        line('20.0', 1094, 356, 1147, 383),
        line('9.38', 1297, 356, 1351, 383),
        line('187.60', 1414, 357, 1487, 382),
        line('PF-', 59, 396, 109, 426),
        line('30049099WYSOLONE5TAB', 127, 396, 415, 420),
        line("1X15'", 651, 394, 718, 421),
        line('NM1760', 736, 392, 820, 418),
        line('Dec/27', 875, 392, 956, 421),
        line('40.0', 1094, 392, 1146, 419),
        line('0.72', 1297, 392, 1350, 419),
        line('28.80', 1422, 392, 1485, 418),
        line('WW', 62, 435, 120, 462),
        line('3004', 150, 434, 200, 457),
        line('SAZO-500MG TAB', 225, 434, 409, 458),
        line('10S', 650, 430, 696, 458),
        line('ALT240783', 737, 429, 846, 453),
        line('Oct/27', 875, 428, 950, 455),
        line('40.0', 1093, 427, 1147, 454),
        line('5.29', 1297, 427, 1349, 454),
        line('211.60', 1409, 429, 1484, 454),
      ],
    });

    expect(result).toEqual([
      expect.objectContaining({
        rawName: 'HCQS 200MG',
        extractedStrength: '200MG',
        extractedPack: "10'S",
        quantity: 40,
      }),
      expect.objectContaining({
        rawName: 'LEERAB D',
        extractedPack: '1X10',
        quantity: 20,
      }),
      expect.objectContaining({
        rawName: 'WYSOLONE 5',
        extractedPack: '1X15',
        quantity: 40,
      }),
      expect.objectContaining({
        rawName: 'SAZO-500MG',
        extractedStrength: '500MG',
        extractedPack: '10S',
        quantity: 40,
      }),
    ]);
  });

  it('does not treat multiplied pack notation as purchased quantity', () => {
    const candidate = service.parseMedicineLine(
      "HAPIRAB D 1X10' LGP10/377J08 Mar/27",
    );

    expect(candidate).toEqual(
      expect.objectContaining({
        extractedPack: '1X10',
        quantity: undefined,
      }),
    );
  });
});

function line(
  text: string,
  left: number,
  top: number,
  right: number,
  bottom: number,
) {
  return {
    text,
    confidence: 0.99,
    bbox: [
      [right, bottom],
      [left, bottom],
      [left, top],
      [right, top],
    ] as [number, number][],
  };
}
