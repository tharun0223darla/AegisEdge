export type CandidateSource = 'MANUAL' | 'BILL' | 'BARCODE' | 'PACKAGE_IMAGE';

export type MedicineCandidateMatch = {
  masterId: string;
  score: number;
};

export type MedicineCandidate = {
  rawName: string;
  source: CandidateSource;
  possibleMasterMatches?: MedicineCandidateMatch[];
  confidence?: number;
  extractedStrength?: string;
  extractedPack?: string;
  imageUrl?: string;
  barcode?: string;
  billLine?: string;
};

export type ResolverOutcome =
  | {
      kind: 'STRONG';
      match: MedicineCandidateMatch;
      needsConfirm: true;
    }
  | {
      kind: 'POSSIBLE';
      matches: MedicineCandidateMatch[];
      needsConfirm: true;
    }
  | {
      kind: 'UNKNOWN';
      needsConfirm: true;
    };
