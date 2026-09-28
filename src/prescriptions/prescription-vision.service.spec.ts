import { OcrService } from '../ocr/ocr.service';
import { CandidateGenerationService } from './candidate-generation.service';
import { PrescriptionVisionService } from './prescription-vision.service';

describe('PrescriptionVisionService portable path', () => {
  const originalEnv = process.env;

  afterEach(() => {
    process.env = originalEnv;
    jest.restoreAllMocks();
  });

  it('returns database-backed candidates only as human-review rows', async () => {
    process.env = {
      ...originalEnv,
      PRESCRIPTION_VISION_MODE: 'sidecar',
    };
    const ocrService = {
      extractText: jest.fn().mockResolvedValue({
        success: true,
        rawText: 'Tab Amoxicillin 500 mg',
        confidence: 88,
        wordsCount: 3,
        selectedVariant: 'contrast',
        modelVersion: 'PP-OCRv6',
        lines: [
          {
            text: 'Tab Amoxicillin 500 mg',
            confidence: 0.88,
            bbox: [
              [1, 1],
              [100, 1],
              [100, 20],
              [1, 20],
            ],
          },
        ],
      }),
    };
    const context = {
      extractionRunId: 'run-1',
      documentId: 'rx-1',
      userId: 'user-1',
    };
    const candidateGeneration = {
      createRunContext: jest.fn().mockResolvedValue(context),
      generateAllCandidates: jest
        .fn()
        .mockImplementation((evidence: Array<{ id: string }>) =>
          Promise.resolve({
            mentions: [
              {
                id: 'mention-1',
                rawText: 'Amoxicillin',
                canonicalName: 'Amoxicillin',
                normalized: 'amoxicillin',
                sourceGenerator: 'dictionary',
                traceabilityStatus: 'RESOLVED',
                confidence: 0.88,
                evidenceRef: {
                  evidenceId: evidence[0].id,
                  lineNumber: 1,
                  text: 'Tablet Amoxicillin 500 mg',
                },
                matchDetails: {
                  method: 'exact',
                  similarity: 1,
                },
              },
            ],
            clusters: [
              {
                id: 'cluster-1',
                primaryName: 'Amoxicillin',
                normalizedName: 'amoxicillin',
                mentionIds: ['mention-1'],
                dosage: '500 mg',
                quantity: null,
                frequency: 'twice daily',
                instructions: null,
                maxEvidenceScore: 0.88,
                generators: ['dictionary'],
                variants: ['contrast'],
                evidenceIds: [evidence[0].id],
                attributeConflicts: [],
              },
            ],
          }),
        ),
    };
    const service = new PrescriptionVisionService(
      ocrService as unknown as OcrService,
      candidateGeneration as unknown as CandidateGenerationService,
    );

    const result = await service.run({
      userId: 'user-1',
      prescriptionId: 'rx-1',
      imagePath: __filename,
    });

    expect(ocrService.extractText).toHaveBeenCalledWith(__filename, {
      documentType: 'prescription',
    });
    expect(result).toMatchObject({
      status: 'human_review_required',
      auto_confirmed_count: 0,
      row_count: 1,
    });
    expect(result.rows[0]).toMatchObject({
      review_required: true,
      medicine: {
        dosage_form: 'Tablet',
        medicine_raw: 'Amoxicillin',
        strength: '500 mg',
        schedule_raw: 'twice daily',
      },
    });
  });

  it('does not send headers and advice into medicine candidate generation', async () => {
    process.env = {
      ...originalEnv,
      PRESCRIPTION_VISION_MODE: 'sidecar',
    };
    const ocrService = {
      extractText: jest.fn().mockResolvedValue({
        success: true,
        rawText:
          'Patient: Real\nAdvice: knee cap\nTab Diclofenac 50 mg 1-0-1\nCap Bognt2000',
        selectedVariant: 'original',
        lines: [
          {
            text: 'Patient: Real',
            confidence: 0.99,
            bbox: [
              [10, 10],
              [200, 10],
              [200, 40],
              [10, 40],
            ],
          },
          {
            text: 'Advice: knee cap',
            confidence: 0.95,
            bbox: [
              [10, 100],
              [250, 100],
              [250, 140],
              [10, 140],
            ],
          },
          {
            text: 'Tab Diclofenac',
            confidence: 0.96,
            bbox: [
              [100, 200],
              [400, 200],
              [400, 250],
              [100, 250],
            ],
          },
          {
            text: '50 mg 1-0-1',
            confidence: 0.92,
            bbox: [
              [430, 205],
              [650, 205],
              [650, 250],
              [430, 250],
            ],
          },
          {
            text: 'Cap Bognt2000',
            confidence: 0.9,
            bbox: [
              [100, 300],
              [400, 300],
              [400, 350],
              [100, 350],
            ],
          },
        ],
      }),
    };
    let generatedEvidence: Array<{ id: string; text: string }> = [];
    const candidateGeneration = {
      createRunContext: jest.fn().mockResolvedValue({}),
      generateAllCandidates: jest
        .fn()
        .mockImplementation((evidence: Array<{ id: string; text: string }>) => {
          generatedEvidence = evidence;
          return Promise.resolve({
            mentions: [
              {
                id: 'diclofenac',
                rawText: 'Diclofenae',
                canonicalName: 'Diclofenac',
                normalized: 'diclofenac',
                sourceGenerator: 'dictionary',
                traceabilityStatus: 'RESOLVED',
                confidence: 0.95,
                matchDetails: { method: 'fuzzy', similarity: 0.9 },
              },
              {
                id: 'bognt',
                rawText: 'Bognt2000',
                canonicalName: 'Bognt2000',
                normalized: 'bognt2000',
                sourceGenerator: 'regex',
                traceabilityStatus: 'RESOLVED',
                confidence: 0.9,
              },
            ],
            clusters: [
              {
                id: 'diclofenac-cluster',
                primaryName: 'Diclofenae',
                normalizedName: 'diclofenae',
                mentionIds: ['diclofenac'],
                dosage: '50mg',
                frequency: null,
                quantity: null,
                instructions: null,
                maxEvidenceScore: 0.95,
                generators: ['dictionary'],
                variants: ['original'],
                evidenceIds: [evidence[0].id],
                attributeConflicts: [],
              },
              {
                id: 'bognt-cluster',
                primaryName: 'Bognt2000',
                normalizedName: 'bognt2000',
                mentionIds: ['bognt'],
                dosage: null,
                frequency: null,
                quantity: null,
                instructions: null,
                maxEvidenceScore: 0.9,
                generators: ['regex'],
                variants: ['original'],
                evidenceIds: [evidence[1].id],
                attributeConflicts: [],
              },
            ],
          });
        }),
    };
    const service = new PrescriptionVisionService(
      ocrService as unknown as OcrService,
      candidateGeneration as unknown as CandidateGenerationService,
    );

    const result = await service.run({
      userId: 'user-1',
      prescriptionId: 'rx-1',
      imagePath: __filename,
    });

    expect(generatedEvidence).toHaveLength(2);
    expect(generatedEvidence[0].text).toBe('Tablet Diclofenac 50 mg 1-0-1');
    expect(generatedEvidence[1].text).toBe('Capsule Bognt2000');
    expect(result.rows).toHaveLength(2);
    expect(result.rows[0]).toMatchObject({
      readable_candidate: true,
      medicine: {
        medicine_raw: 'Diclofenac',
        strength: '50mg',
        schedule_raw: '1-0-1',
        morning: true,
        afternoon: false,
        evening: true,
      },
    });
    expect(result.rows[1]).toMatchObject({
      readable_candidate: false,
      field_status: { medicine_raw: 'uncertain' },
      medicine: { medicine_raw: 'Bognt2000' },
    });
  });

  it('returns zero rows when OCR quality is insufficient', async () => {
    process.env = {
      ...originalEnv,
      PRESCRIPTION_VISION_MODE: 'sidecar',
    };
    const ocrService = {
      extractText: jest.fn().mockResolvedValue({
        success: false,
        rawText: '',
        confidence: 0,
        wordsCount: 0,
        source: 'NO_RESULT',
        fallbackReason: 'low_average_confidence',
        lines: [],
      }),
    };
    const candidateGeneration = {
      createRunContext: jest.fn(),
      generateAllCandidates: jest.fn(),
    };
    const service = new PrescriptionVisionService(
      ocrService as unknown as OcrService,
      candidateGeneration as unknown as CandidateGenerationService,
    );

    const result = await service.run({
      userId: 'user-1',
      prescriptionId: 'rx-1',
      imagePath: __filename,
    });

    expect(result).toMatchObject({
      status: 'human_review_required',
      auto_confirmed_count: 0,
      row_count: 0,
      rows: [],
    });
    expect(candidateGeneration.generateAllCandidates).not.toHaveBeenCalled();
  });

  it('keeps an unmatched anchored OCR row disabled for manual review', async () => {
    process.env = { ...originalEnv, PRESCRIPTION_VISION_MODE: 'sidecar' };
    const ocrService = {
      extractText: jest.fn().mockResolvedValue({
        success: true,
        rawText: 'Tab Handwrittenex 20 mg 1-0-1',
        selectedVariant: 'original',
        modelVersion: 'PP-OCRv6',
        lines: [
          {
            text: 'Tab Handwrittenex 20 mg 1-0-1',
            confidence: 0.72,
            bbox: [
              [10, 10],
              [400, 10],
              [400, 50],
              [10, 50],
            ],
          },
        ],
      }),
    };
    const candidateGeneration = {
      createRunContext: jest.fn().mockResolvedValue({}),
      generateAllCandidates: jest
        .fn()
        .mockResolvedValue({ mentions: [], clusters: [] }),
    };
    const service = new PrescriptionVisionService(
      ocrService as unknown as OcrService,
      candidateGeneration as unknown as CandidateGenerationService,
    );

    const result = await service.run({
      userId: 'user-1',
      prescriptionId: 'rx-unmatched',
      imagePath: __filename,
    });

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({
      readable_candidate: false,
      field_status: { medicine_raw: 'uncertain' },
      medicine: {
        medicine_raw: 'Handwrittenex',
        schedule_raw: '1-0-1',
      },
    });
  });

  it('recovers unanchored medicine lines only with strong database support', async () => {
    process.env = { ...originalEnv, PRESCRIPTION_VISION_MODE: 'sidecar' };
    const ocrService = {
      extractText: jest.fn().mockResolvedValue({
        success: true,
        rawText: 'Patient: Test\nCocaine Hydrochloride\nSig: locally',
        selectedVariant: 'original',
        modelVersion: 'PP-OCRv6',
        lines: [
          {
            text: 'Patient: Test',
            confidence: 0.95,
            bbox: [
              [1, 1],
              [200, 1],
              [200, 20],
              [1, 20],
            ],
          },
          {
            text: 'Cocaine Hydrochloride',
            confidence: 0.84,
            bbox: [
              [1, 40],
              [300, 40],
              [300, 70],
              [1, 70],
            ],
          },
          {
            text: 'Sig: locally',
            confidence: 0.8,
            bbox: [
              [1, 80],
              [200, 80],
              [200, 100],
              [1, 100],
            ],
          },
        ],
      }),
    };
    const candidateGeneration = {
      createRunContext: jest.fn().mockResolvedValue({}),
      generateAllCandidates: jest
        .fn()
        .mockImplementation((evidence: Array<{ id: string; text: string }>) => {
          const medicineEvidence = evidence.find(
            (item) => item.text === 'Cocaine Hydrochloride',
          );
          if (!medicineEvidence) {
            throw new Error('Expected medicine evidence in fallback test.');
          }
          return {
            mentions: [
              {
                id: 'cocaine-mention',
                rawText: 'Cocaine Hydrochloride',
                canonicalName: 'Cocaine Hydrochloride',
                sourceGenerator: 'dictionary',
                matchDetails: { method: 'exact', similarity: 1 },
              },
            ],
            clusters: [
              {
                id: 'cocaine-cluster',
                primaryName: 'Cocaine Hydrochloride',
                mentionIds: ['cocaine-mention'],
                dosage: null,
                quantity: null,
                frequency: null,
                instructions: null,
                maxEvidenceScore: 0.84,
                evidenceIds: [medicineEvidence.id],
              },
            ],
          };
        }),
    };
    const service = new PrescriptionVisionService(
      ocrService as unknown as OcrService,
      candidateGeneration as unknown as CandidateGenerationService,
    );

    const result = await service.run({
      userId: 'user-1',
      prescriptionId: 'rx-unanchored',
      imagePath: __filename,
    });

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({
      readable_candidate: true,
      medicine: { medicine_raw: 'Cocaine Hydrochloride' },
    });
  });
});
