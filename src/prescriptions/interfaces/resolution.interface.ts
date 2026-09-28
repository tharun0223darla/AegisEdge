export interface Resolution {
  candidateState: 'VERIFIED' | 'REVIEW' | 'UNKNOWN' | 'REJECTED';
  confidence: number;
  reasons: string[];
  candidate?: any;
}
