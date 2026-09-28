import type { AuditLogsService } from '../audit-logs/audit-logs.service';
import type { OcrService } from '../ocr/ocr.service';
import type { PrismaService } from '../prisma/prisma.service';
import type {
  MedicineCandidate,
  ResolverOutcome,
} from '../medicines/capture/medicine-candidate';
import type { MedicineResolverService } from '../medicines/capture/medicine-resolver.service';
import type { MedicinesService } from '../medicines/medicines.service';
import type {
  BillCaptureService,
  BillLineCandidate,
} from './bill-capture.service';
import { BillsService } from './bills.service';

type TestMasterMatch = {
  id: string;
  brandName: string;
  composition: string;
  strength: string;
  score: number;
};

type ResolvedBillCandidate = BillLineCandidate & {
  source: 'BILL';
  confidence: number;
  resolverOutcome: ResolverOutcome;
  masterMatches: TestMasterMatch[];
};

type BillResolutionAccess = {
  resolveBillCandidates: (
    candidates: BillLineCandidate[],
  ) => Promise<ResolvedBillCandidate[]>;
};

describe('BillsService medicine resolution', () => {
  function buildService(searchResults: Record<string, TestMasterMatch[]>) {
    const medicinesService = {
      searchMaster: jest.fn((term: string) =>
        Promise.resolve(searchResults[term] ?? []),
      ),
    };
    const resolver = {
      classify: jest.fn((candidate: MedicineCandidate): ResolverOutcome => {
        const best = candidate.possibleMasterMatches?.[0];
        return best && best.score >= 0.9
          ? { kind: 'STRONG', match: best, needsConfirm: true }
          : { kind: 'UNKNOWN', needsConfirm: true };
      }),
    };
    const billCapture = {
      buildMasterSearchTerms: jest.fn((candidate: BillLineCandidate) => [
        candidate.rawName,
      ]),
    };
    const service = new BillsService(
      {} as unknown as PrismaService,
      {} as unknown as OcrService,
      {} as unknown as AuditLogsService,
      medicinesService as unknown as MedicinesService,
      resolver as unknown as MedicineResolverService,
      billCapture as unknown as BillCaptureService,
    );
    return {
      service: service as unknown as BillResolutionAccess,
      resolver,
    };
  }

  it('does not promote an unrelated high-scoring database result', async () => {
    const unrelated = {
      id: 'wrong-master',
      brandName: 'Acidban DSR',
      composition: 'Pantoprazole + Domperidone',
      strength: '40mg + 30mg',
      score: 0.99,
    };
    const { service, resolver } = buildService({
      'HP KIT': [unrelated],
    });

    const [result] = await service.resolveBillCandidates([
      { rawName: 'HP KIT', billLine: 'HP KIT COMBIPACK 1' },
    ]);

    expect(resolver.classify).toHaveBeenCalledWith(
      expect.objectContaining({ possibleMasterMatches: [] }),
    );
    expect(result.resolverOutcome.kind).toBe('UNKNOWN');
    expect(result.confidence).toBe(0);
    expect(result.masterMatches).toEqual([unrelated]);
  });

  it('accepts a close OCR brand only when its printed strength agrees', async () => {
    const correct = {
      id: 'correct-master',
      brandName: 'Novelyxa 40',
      composition: 'Fictizole 40mg',
      strength: '40mg',
      score: 0.97,
    };
    const wrongStrength = {
      id: 'wrong-strength',
      brandName: 'Novelyxa 80',
      composition: 'Fictizole 80mg',
      strength: '80mg',
      score: 0.99,
    };
    const { service, resolver } = buildService({
      'NOVELYA 40MG': [wrongStrength, correct],
    });

    const [result] = await service.resolveBillCandidates([
      {
        rawName: 'NOVELYA 40MG',
        billLine: 'NOVELYA 40MG TAB 10S 1 90.00',
        extractedStrength: '40MG',
      },
    ]);

    expect(resolver.classify).toHaveBeenCalledWith(
      expect.objectContaining({
        possibleMasterMatches: [{ masterId: 'correct-master', score: 0.97 }],
      }),
    );
    expect(result.resolverOutcome.kind).toBe('STRONG');
    expect(result.masterMatches[0].id).toBe('correct-master');
  });
});
