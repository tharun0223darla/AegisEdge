export interface Candidate {
  rawText: string;
  normalized: string;
  sourceLine: number;
  evidenceScore: number;
  sourceGenerator?: string;
  dosage?: string | null;
  frequency?: string | null;
  timesOfDay?: string[];
  durationDays?: number | null;
  quantity?: number | null;
  instructions?: string | null;
}
