import { Test, TestingModule } from '@nestjs/testing';
import { RegexCandidateGenerator } from './regex-candidate-generator.service';
import { DictionaryCandidateGenerator } from './dictionary-candidate-generator.service';
import { LlmCandidateAdapter } from './llm-candidate-adapter.service';
import { CandidateClusteringService } from './candidate-clustering.service';
import { CandidateGenerationService } from './candidate-generation.service';
import { ExtractionService } from '../extraction/extraction.service';
import { PrismaService } from '../prisma/prisma.service';
import { OcrEvidence } from './interfaces/ocr-evidence.interface';
import {
  CandidateMention,
  CandidateCluster,
} from './interfaces/candidate-generation.interface';

describe('Candidate Generation Pipeline Redesign (Release 3)', () => {
  let regexGenerator: RegexCandidateGenerator;
  let dictionaryGenerator: DictionaryCandidateGenerator;
  let llmAdapter: LlmCandidateAdapter;
  let clusteringService: CandidateClusteringService;
  let orchestratorService: CandidateGenerationService;
  let extractionService: ExtractionService;

  const mockPrisma = {
    medicine: {
      findMany: jest.fn(),
    },
    medicineMaster: {
      findMany: jest.fn(),
    },
    saltProfile: {
      findMany: jest.fn(),
    },
    medicineCorrection: {
      findMany: jest.fn(),
    },
  };

  const mockExtractionService = {
    isEnabled: true,
    extract: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RegexCandidateGenerator,
        DictionaryCandidateGenerator,
        LlmCandidateAdapter,
        CandidateClusteringService,
        CandidateGenerationService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: ExtractionService, useValue: mockExtractionService },
      ],
    }).compile();

    regexGenerator = module.get<RegexCandidateGenerator>(
      RegexCandidateGenerator,
    );
    dictionaryGenerator = module.get<DictionaryCandidateGenerator>(
      DictionaryCandidateGenerator,
    );
    llmAdapter = module.get<LlmCandidateAdapter>(LlmCandidateAdapter);
    clusteringService = module.get<CandidateClusteringService>(
      CandidateClusteringService,
    );
    orchestratorService = module.get<CandidateGenerationService>(
      CandidateGenerationService,
    );
    extractionService = module.get<ExtractionService>(ExtractionService);

    jest.clearAllMocks();
  });

  describe('Regex Candidate Generator', () => {
    it('should parse multi-word medicine names and Stage 3 fallback name parsing', () => {
      const evidence: OcrEvidence[] = [
        {
          text: 'Tab Amoxicillin Clavulanate 500mg BD',
          confidence: 90,
          lineNumber: 1,
          bbox: [10, 20, 100, 30],
          engine: 'tesseract',
          variant: 'ORIGINAL',
          sourceImage: 'test.png',
        },
      ];
      const mentions = regexGenerator.generateCandidates(evidence);
      expect(mentions.length).toBe(1);
      expect(mentions[0].rawText).toBe('Amoxicillin Clavulanate');
      expect(mentions[0].canonicalName).toBe('Amoxicillin Clavulanate');
      expect(mentions[0].dosage).toBe('500mg');
      expect(mentions[0].frequency).toBe('TWICE_DAILY');
    });

    it('should parse combined strengths', () => {
      const evidence: OcrEvidence[] = [
        {
          text: 'Co-Amoxiclav 500/125mg once daily',
          confidence: 85,
          lineNumber: 1,
          bbox: [10, 20, 100, 30],
          engine: 'tesseract',
          variant: 'ORIGINAL',
          sourceImage: 'test.png',
        },
      ];
      const mentions = regexGenerator.generateCandidates(evidence);
      expect(mentions.length).toBe(1);
      expect(mentions[0].rawText).toBe('Co-Amoxiclav');
      expect(mentions[0].dosage).toBe('500/125mg');
      expect(mentions[0].frequency).toBe('DAILY');
    });

    it('should parse quantity, frequency, and duration patterns', () => {
      const evidence: OcrEvidence[] = [
        {
          text: 'Paracetamol 650mg BD for 10 days qty 30',
          confidence: 95,
          lineNumber: 2,
          bbox: [10, 40, 100, 50],
          engine: 'tesseract',
          variant: 'ORIGINAL',
          sourceImage: 'test.png',
        },
      ];
      const mentions = regexGenerator.generateCandidates(evidence);
      expect(mentions.length).toBe(1);
      expect(mentions[0].rawText).toBe('Paracetamol');
      expect(mentions[0].dosage).toBe('650mg');
      expect(mentions[0].frequency).toBe('TWICE_DAILY');
      expect(mentions[0].durationDays).toBe(10);
      expect(mentions[0].quantity).toBe(30);
    });
  });

  describe('Dictionary Candidate Generator & Fuzzy Logic', () => {
    const mockMetadata = {
      userMeds: [
        {
          name: 'Lipitor',
          brandName: 'Lipitor',
          genericName: 'Atorvastatin',
          strength: '10mg',
        },
      ],
      masterMeds: [
        {
          brandName: 'Amoxicillin',
          genericName: 'Amoxicillin',
          strength: '500mg',
          category: 'Antibiotic',
          composition: 'Amoxicillin',
        },
        {
          brandName: 'Atorvastatin Calcium',
          genericName: 'Atorvastatin',
          strength: '20mg',
          category: 'Statin',
          composition: 'Atorvastatin',
        },
      ],
      corrections: [
        { rawExtractedName: 'Paraceta', correctedName: 'Paracetamol' },
      ],
    };

    it('should query MasterMed, user history, correction aliases separately', () => {
      const evidence: OcrEvidence[] = [
        {
          text: 'lipitor amoxicillin paraceta',
          confidence: 90,
          lineNumber: 1,
          bbox: [0, 0, 100, 10],
          engine: 'tesseract',
          variant: 'ORIGINAL',
          sourceImage: 'test.png',
        },
      ];

      const mentions = dictionaryGenerator.generateCandidates(
        evidence,
        mockMetadata,
      );

      // Verify Lipitor matched user meds
      const lipitorMatch = mentions.find((m) => m.canonicalName === 'Lipitor');
      expect(lipitorMatch).toBeDefined();
      expect(lipitorMatch?.matchDetails?.source).toBe('PREVIOUS_MEDICINES');

      // Verify Amoxicillin matched master database
      const amoxMatch = mentions.find((m) => m.canonicalName === 'Amoxicillin');
      expect(amoxMatch).toBeDefined();
      expect(amoxMatch?.matchDetails?.source).toBe('MEDICINE_MASTER');

      // Verify Paraceta matched user correction
      const paracetaMatch = mentions.find(
        (m) => m.canonicalName === 'Paracetamol',
      );
      expect(paracetaMatch).toBeDefined();
      expect(paracetaMatch?.matchDetails?.source).toBe('USER_CORRECTION');
    });

    it('should perform length-aware fuzzy matching correctly', () => {
      // 1. Length < 4 should NOT match fuzzily
      const evidenceShort: OcrEvidence[] = [
        {
          text: 'Amo',
          confidence: 90,
          lineNumber: 1,
          bbox: [0, 0, 10, 10],
          engine: 'tesseract',
          variant: 'ORIGINAL',
          sourceImage: 'test.png',
        },
      ];
      const shortMentions = dictionaryGenerator.generateCandidates(
        evidenceShort,
        mockMetadata,
      );
      expect(
        shortMentions.find((m) => m.rawText === 'Amoxicillin'),
      ).toBeUndefined();

      // 2. Length 4 to 6: max 1 edit (e.g. "Amoxi" -> "Amoxicillin" is a prefix match; "Lipitir" -> "Lipitor" length 7, edit distance 1)
      const evidenceFuzzy: OcrEvidence[] = [
        {
          text: 'Lipitir',
          confidence: 95,
          lineNumber: 1,
          bbox: [0, 0, 10, 10],
          engine: 'tesseract',
          variant: 'ORIGINAL',
          sourceImage: 'test.png',
        },
      ];
      const fuzzyMentions = dictionaryGenerator.generateCandidates(
        evidenceFuzzy,
        mockMetadata,
      );
      const fuzzyLipitor = fuzzyMentions.find(
        (m) => m.canonicalName === 'Lipitor',
      );
      expect(fuzzyLipitor).toBeDefined();
      expect(fuzzyLipitor?.matchDetails?.method).toBe('fuzzy');
      expect(fuzzyLipitor?.matchDetails?.editDistance).toBe(1);
    });

    it('should generate 1-to-4 token n-grams from evidence lines', () => {
      const evidence: OcrEvidence[] = [
        {
          text: 'Atorvastatin Calcium Brand New',
          confidence: 90,
          lineNumber: 1,
          bbox: [0, 0, 100, 10],
          engine: 'tesseract',
          variant: 'ORIGINAL',
          sourceImage: 'test.png',
        },
      ];
      const mentions = dictionaryGenerator.generateCandidates(
        evidence,
        mockMetadata,
      );
      const masterMatch = mentions.find(
        (m) =>
          m.canonicalName === 'Atorvastatin Calcium' &&
          m.matchDetails?.method === 'exact',
      );
      expect(masterMatch).toBeDefined();
      expect(masterMatch?.matchDetails?.method).toBe('exact');
      expect(masterMatch?.matchDetails?.matchedValue).toBe(
        'Atorvastatin Calcium',
      );
    });

    it('should index canonical salt ingredients and standard medicine names', () => {
      const evidence: OcrEvidence[] = [
        {
          text: 'Ferrie Maltol',
          confidence: 82,
          lineNumber: 1,
          bbox: [0, 0, 100, 10],
          engine: 'paddleocr',
          variant: 'contrast',
          sourceImage: 'test.png',
        },
        {
          text: 'Cocaine hydrochlor',
          confidence: 78,
          lineNumber: 2,
          bbox: [0, 20, 100, 30],
          engine: 'paddleocr',
          variant: 'contrast',
          sourceImage: 'test.png',
        },
      ];
      const mentions = dictionaryGenerator.generateCandidates(evidence, {
        ...mockMetadata,
        saltProfiles: [
          {
            displayName: 'Ferric Maltol 30mg',
            ingredients: [{ name: 'Ferric Maltol', strength: '30mg' }],
          },
        ],
      });

      expect(
        mentions.find(
          (mention) =>
            mention.canonicalName === 'Ferric Maltol' &&
            mention.matchDetails?.source === 'SALT_PROFILE',
        ),
      ).toMatchObject({ matchDetails: { method: 'fuzzy' } });
      expect(
        mentions.find((mention) => mention.canonicalName === 'Cocaine'),
      ).toMatchObject({ matchDetails: { method: 'exact' } });
    });

    it('should isolate history queries strictly by userId', async () => {
      mockPrisma.medicine.findMany.mockResolvedValue([
        {
          name: 'TargetMed',
          brandName: 'TargetMed',
          genericName: 'TargetGeneric',
          strength: '10mg',
        },
      ]);
      mockPrisma.medicineMaster.findMany.mockResolvedValue([]);
      mockPrisma.saltProfile.findMany.mockResolvedValue([]);
      mockPrisma.medicineCorrection.findMany.mockResolvedValue([]);

      const userId = 'user-abc-123';
      const metadata = await dictionaryGenerator.loadDictionaryMetadata(userId);

      expect(mockPrisma.medicine.findMany).toHaveBeenCalledWith({
        where: { userId },
        select: {
          name: true,
          brandName: true,
          genericName: true,
          strength: true,
        },
      });
      expect(mockPrisma.saltProfile.findMany).toHaveBeenCalledWith({
        select: { displayName: true, ingredients: true },
      });
      expect(metadata.userMeds.length).toBe(1);
      expect(metadata.userMeds[0].name).toBe('TargetMed');
    });
  });

  describe('LLM Candidate Adapter', () => {
    const mockEvidence: OcrEvidence[] = [
      {
        text: 'Lipitor 10mg once daily',
        confidence: 90,
        lineNumber: 1,
        bbox: [10, 10, 100, 20],
        engine: 'tesseract',
        variant: 'ORIGINAL',
        sourceImage: 'test.png',
      },
    ];

    it('should map structured LLM response to mentions and resolve evidence reference', () => {
      const llmOutput = [
        {
          medicineName: 'Lipitor',
          confidenceScore: 0.95,
          dosage: '10mg',
          frequency: 'DAILY',
          timesOfDay: ['08:00'],
          durationDays: 30,
          quantity: 30,
          instructions: 'Take one daily',
          needsReview: false,
          sourceText: 'Lipitor 10mg',
          fieldConfidence: {},
        },
      ];

      const mentions = llmAdapter.mapLlmToMentions(
        llmOutput,
        mockEvidence,
        'ORIGINAL',
      );
      expect(mentions.length).toBe(1);
      expect(mentions[0].rawText).toBe('Lipitor 10mg');
      expect(mentions[0].canonicalName).toBe('Lipitor');
      expect(mentions[0].traceabilityStatus).toBe('RESOLVED');
      expect(mentions[0].evidenceRef?.lineNumber).toBe(1);
    });

    it('should mark mentions with missing evidence references as UNRESOLVED', () => {
      const llmOutput = [
        {
          medicineName: 'NonExistentDrug',
          confidenceScore: 0.8,
          dosage: '250mg',
          frequency: 'DAILY',
          timesOfDay: [],
          needsReview: false,
          fieldConfidence: {},
        },
      ];

      const mentions = llmAdapter.mapLlmToMentions(
        llmOutput,
        mockEvidence,
        'ORIGINAL',
      );
      expect(mentions.length).toBe(1);
      expect(mentions[0].rawText).toBe('NonExistentDrug');
      expect(mentions[0].traceabilityStatus).toBe('UNRESOLVED');
      expect(mentions[0].evidenceRef).toBeUndefined();
    });
  });

  describe('Candidate Clustering Service', () => {
    it('should group mentions across generators, compatible locations, and variants non-destructively', () => {
      const mentions: CandidateMention[] = [
        {
          id: 'm1',
          rawText: 'Amoxicillin',
          normalized: 'amoxicillin',
          sourceGenerator: 'regex',
          traceabilityStatus: 'RESOLVED',
          confidence: 0.9,
          variantName: 'ORIGINAL',
          dosage: '500mg',
          frequency: 'DAILY',
          evidenceRef: {
            evidenceId: 'ev1',
            lineNumber: 1,
            text: 'Amoxicillin 500mg DAILY',
            bbox: [10, 10, 50, 20],
          },
        },
        {
          id: 'm2',
          rawText: 'Amoxicillin',
          normalized: 'amoxicillin',
          sourceGenerator: 'dictionary',
          traceabilityStatus: 'RESOLVED',
          confidence: 0.85,
          variantName: 'ENHANCED',
          dosage: '500mg',
          frequency: 'DAILY',
          evidenceRef: {
            evidenceId: 'ev2',
            lineNumber: 1,
            text: 'Amoxicillin 500mg DAILY',
            bbox: [11, 10, 49, 21], // highly overlapping bbox
          },
        },
      ];

      const clusters = clusteringService.cluster(mentions);
      expect(clusters.length).toBe(1);
      expect(clusters[0].primaryName).toBe('Amoxicillin');
      expect(clusters[0].mentionIds).toContain('m1');
      expect(clusters[0].mentionIds).toContain('m2');
      expect(clusters[0].generators).toContain('regex');
      expect(clusters[0].generators).toContain('dictionary');
      expect(clusters[0].variants).toContain('ORIGINAL');
      expect(clusters[0].variants).toContain('ENHANCED');
    });

    it('should keep conflicting strengths and schedules in separate clusters', () => {
      const mentions: CandidateMention[] = [
        {
          id: 'm1',
          rawText: 'Amoxicillin',
          normalized: 'amoxicillin',
          sourceGenerator: 'regex',
          traceabilityStatus: 'RESOLVED',
          confidence: 0.9,
          dosage: '500mg',
          frequency: 'DAILY',
          evidenceRef: {
            evidenceId: 'ev1',
            lineNumber: 1,
            text: 'Amoxicillin 500mg',
          },
        },
        {
          id: 'm2',
          rawText: 'Amoxicillin',
          normalized: 'amoxicillin',
          sourceGenerator: 'regex',
          traceabilityStatus: 'RESOLVED',
          confidence: 0.9,
          dosage: '250mg', // conflicting strength
          frequency: 'DAILY',
          evidenceRef: {
            evidenceId: 'ev2',
            lineNumber: 1,
            text: 'Amoxicillin 250mg',
          },
        },
      ];

      const clusters = clusteringService.cluster(mentions);
      expect(clusters.length).toBe(2);
    });
  });

  describe('Isolated Execution & Reliability', () => {
    it('should isolate failures/timeouts in one generator so others can complete and return isPartial true', async () => {
      // Mock dictionary generator to throw an error
      jest
        .spyOn(dictionaryGenerator, 'generateCandidates')
        .mockImplementation(() => {
          throw new Error('Database connection failed');
        });

      mockExtractionService.extract.mockResolvedValue({
        available: false,
        medicines: [],
      });

      const evidence: OcrEvidence[] = [
        {
          text: 'Amoxicillin 500mg BD',
          confidence: 90,
          lineNumber: 1,
          bbox: [10, 20, 100, 30],
          engine: 'tesseract',
          variant: 'ORIGINAL',
          sourceImage: 'test.png',
        },
      ];

      const context = {
        extractionRunId: 'run-123',
        documentId: 'doc-456',
        userId: 'user-789',
        dictionaryMetadata: { userMeds: [], masterMeds: [], corrections: [] },
      };

      const result = await orchestratorService.generateAllCandidates(
        evidence,
        context,
        'ORIGINAL',
      );

      expect(result.isPartial).toBe(true);
      expect(result.partialReason).toContain('dictionary:GENERATOR_ERROR');
      expect(result.mentions.length).toBeGreaterThan(0); // regex generator still succeeded!
      expect(
        result.executions.find((e) => e.generatorName === 'dictionary')?.status,
      ).toBe('failed');
      expect(
        result.executions.find((e) => e.generatorName === 'regex')?.status,
      ).toBe('success');
    });
  });
});
