import { OcrEvidence } from './ocr-evidence.interface';

export type CandidateGeneratorSource =
  | 'regex'
  | 'dictionary'
  | 'llm'
  | 'layout';
export type TraceabilityStatus = 'RESOLVED' | 'UNRESOLVED';
export type GeneratorExecutionStatus = 'success' | 'partial' | 'failed';

export interface CandidateEvidenceRef {
  evidenceId: string; // signature of the evidence line: engine|variant|lineNumber|text|bbox
  lineNumber: number;
  text: string;
  charStart?: number;
  charEnd?: number;
  bbox?: number[];
  normalizedBbox?: number[];
  polygon?: number[][];
  pageIndex?: number;
  engine?: string;
  variant?: string;
}

export interface CandidateMention {
  id: string;
  /** Exact OCR mention text. */
  rawText: string;
  /** Canonical dictionary/LLM name when available. */
  canonicalName?: string;
  normalized: string;
  evidenceRef?: CandidateEvidenceRef;
  sourceGenerator: CandidateGeneratorSource;
  traceabilityStatus: TraceabilityStatus;
  dosage?: string | null;
  frequency?: string | null;
  timesOfDay?: string[];
  durationDays?: number | null;
  quantity?: number | null;
  instructions?: string | null;
  confidence: number;
  variantName?: string;
  matchDetails?: {
    source?: string;
    method?: string;
    matchedValue?: string;
    similarity?: number;
    editDistance?: number;
  };
}

export interface CandidateCluster {
  id: string;
  normalizedName: string;
  primaryName: string;
  mentionIds: string[]; // Clustering may only reference mention IDs
  dosage?: string | null;
  frequency?: string | null;
  timesOfDay?: string[];
  durationDays?: number | null;
  quantity?: number | null;
  instructions?: string | null;
  maxEvidenceScore: number;
  generators: CandidateGeneratorSource[];
  variants: string[];
  evidenceIds: string[];
  attributeConflicts: string[];
}

export interface GeneratorExecution {
  generatorName: string;
  status: GeneratorExecutionStatus;
  startTimestamp: string;
  completionTimestamp: string;
  duration: number; // ms
  inputEvidenceCount: number;
  outputMentionCount: number;
  errorCode?: string;
  errorReason?: string;
}

export interface CandidateGenerationContext {
  extractionRunId: string;
  documentId: string;
  userId: string;
  dictionaryMetadata?: {
    userMeds: any[];
    masterMeds: any[];
    corrections: any[];
  };
  /** Run-scoped cache keyed by a content hash of an LLM evidence chunk. */
  llmLineCache?: Map<string, any>;
}

export interface CandidateGenerationResult {
  schemaVersion: string;
  extractionRunId: string;
  documentId: string;
  mentions: CandidateMention[];
  clusters: CandidateCluster[];
  executions: GeneratorExecution[];
  isPartial: boolean;
  partialReason?: string;
}

export interface ProcessCandidatesDto {
  userId: string;
  generationResult: CandidateGenerationResult;
  layoutConfidence?: number;
  evidence?: OcrEvidence[];
}
