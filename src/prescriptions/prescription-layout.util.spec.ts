import {
  matchDosageFormAnchor,
  reconstructPrescriptionRows,
} from './prescription-layout.util';
import { OcrEvidence } from './interfaces/ocr-evidence.interface';

function evidence(
  text: string,
  lineNumber: number,
  bbox: number[],
  confidence = 90,
): OcrEvidence {
  return {
    text,
    lineNumber,
    bbox,
    confidence,
    engine: 'paddleocr',
    variant: 'original',
    sourceImage: 'test-prescription',
  };
}

describe('prescription layout reconstruction', () => {
  it('normalizes observed dosage-form OCR substitutions only at row anchors', () => {
    expect(matchDosageFormAnchor('Pal. Ultrafen-ply')).toMatchObject({
      dosageForm: 'Tablet',
      normalizedText: 'Tablet Ultrafen-ply',
    });
    expect(matchDosageFormAnchor('2 Inb. Relentu')).toMatchObject({
      dosageForm: 'Tablet',
    });
    expect(matchDosageFormAnchor('byp mefial - P')).toMatchObject({
      dosageForm: 'Syrup',
    });
    expect(matchDosageFormAnchor('Amoxicillin 500mg Cap #21')).toMatchObject({
      dosageForm: 'Capsule',
      normalizedText: 'Capsule Amoxicillin 500mg #21',
    });
    expect(matchDosageFormAnchor('Ad: knee cap')).toBeNull();
    expect(matchDosageFormAnchor('Temp chart')).toBeNull();
  });

  it('joins strength and schedule fragments with the nearest medicine row', () => {
    const rows = reconstructPrescriptionRows([
      evidence('Patient name: Test', 1, [20, 20, 300, 50]),
      evidence('1. Tab Cinacalcet', 2, [200, 200, 520, 260], 98),
      evidence('30 mg', 3, [560, 205, 650, 250], 94),
      evidence('1-0-1', 4, [700, 210, 790, 250], 92),
      evidence('After food', 5, [820, 205, 980, 255], 90),
      evidence('2. Cap Ferric Maltol', 6, [200, 310, 560, 370], 97),
      evidence('30 mg', 7, [600, 315, 690, 360], 94),
      evidence('1-1-0', 8, [730, 315, 820, 360], 92),
      evidence('Advice: review after 2 weeks', 9, [100, 600, 700, 660]),
    ]);

    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ dosageForm: 'Tablet' });
    expect(rows[0].evidence.text).toBe(
      'Tablet Cinacalcet 30 mg 1-0-1 After food',
    );
    expect(rows[1].evidence.text).toBe('Capsule Ferric Maltol 30 mg 1-1-0');
  });

  it('does not turn headers, advice, or body-part notes into medicine rows', () => {
    const rows = reconstructPrescriptionRows([
      evidence('Trauma Center', 1, [10, 10, 300, 50]),
      evidence('Pain right knee', 2, [100, 100, 500, 160]),
      evidence('Physiotherapy and exercise', 3, [100, 200, 700, 260]),
      evidence('knee cap', 4, [100, 300, 400, 360]),
    ]);
    expect(rows).toEqual([]);
  });

  it('reconstructs the observed dense and sparse prescription anchors', () => {
    const rows = reconstructPrescriptionRows([
      evidence('Pal. Ultrafen-ply', 1, [466, 640, 1018, 758], 77),
      evidence('50ng 2+0+1', 2, [894, 702, 1215, 788], 75),
      evidence('2 Inb. Relentu', 3, [402, 774, 859, 874], 75),
      evidence('0+0+1', 4, [1036, 824, 1226, 884], 82),
      evidence('Ad: knee cap', 5, [365, 1281, 890, 1394], 90),
      evidence('byp mefial - P', 6, [622, 947, 1383, 1169], 93),
      evidence('4ml', 7, [1491, 949, 1779, 1105], 92),
      evidence('Temp chart', 8, [503, 1269, 1300, 1489], 89),
      evidence('Pub.', 9, [481, 1661, 638, 1749], 89),
      evidence('Dlracal-D-0+2t', 10, [641, 1660, 1204, 1758], 77),
      evidence('Capi', 11, [469, 1755, 660, 1828], 85),
      evidence('Oneprong 2+0+0', 12, [640, 1741, 1190, 1829], 77),
    ]);

    expect(rows.map((row) => row.evidence.text)).toEqual([
      'Tablet Ultrafen-ply 50ng 2+0+1',
      'Tablet Relentu 0+0+1',
      'Syrup mefial - P 4ml',
      'Tablet Dlracal-D-0+2t',
      'Capsule Oneprong 2+0+0',
    ]);
  });
});
