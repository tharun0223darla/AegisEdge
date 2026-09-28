import { OcrEvidence } from './ocr-evidence.interface';
import { Candidate } from './candidate.interface';
import { Resolution } from './resolution.interface';

export interface PipelineContext {
  fileHash: string;
  ocr: any;
  evidence: OcrEvidence[];
  candidates: Candidate[];
  validated: any[];
  resolved: Resolution[];
  final: any[];
}
