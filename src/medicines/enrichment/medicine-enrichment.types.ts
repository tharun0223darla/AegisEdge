export type ClinicalField =
  | 'uses'
  | 'howToTake'
  | 'sideEffects'
  | 'warnings'
  | 'storage';

export interface ClinicalSourceRef {
  sourceType:
    | 'openFDA'
    | 'RxNorm'
    | 'DailyMed'
    | 'MedlinePlus'
    | 'ADMIN'
    | 'NFI_IPC'
    | 'CDSCO'
    | string;
  provider: string;
  field?: ClinicalField;
  sourceField?: string;
  ingredient?: string;
  normalizedIngredient?: string;
  rxCui?: string;
  title: string;
  url: string;
  fetchedAt: string;
  setId?: string;
  effectiveTime?: string;
}

export interface RxNormResolution {
  ingredient: string;
  normalizedIngredient: string;
  aliasesTried?: string[];
  rxCui?: string;
  sourceRef: ClinicalSourceRef;
}

export interface OpenFdaLabelResult {
  ingredient: string;
  normalizedIngredient: string;
  aliasesTried?: string[];
  rxCui?: string;
  label: Record<string, unknown>;
  fetchedAt: string;
  sourceUrl: string;
}

export interface DailyMedLabelResult {
  ingredient: string;
  normalizedIngredient: string;
  aliasesTried?: string[];
  rxCui?: string;
  setId: string;
  title?: string;
  xml: string;
  fetchedAt: string;
  sourceUrl: string;
}

export interface MedlinePlusLinkResult {
  ingredient: string;
  normalizedIngredient: string;
  rxCui: string;
  title: string;
  url: string;
  summary?: string;
  fetchedAt: string;
  sourceUrl: string;
}
export interface LabelSectionMapping {
  uses?: string;
  howToTake?: string;
  sideEffects?: string[];
  warnings?: string;
  storage?: string;
  sourceRefs: Record<string, ClinicalSourceRef[] | undefined>;
}

export interface SaltEnrichmentResult {
  saltProfileId: string;
  saltKey: string;
  displayName: string;
  status: 'COMPLETE' | 'PARTIAL' | 'NEEDS_SOURCE';
  fields: LabelSectionMapping;
  ingredients: RxNormResolution[];
  dryRun: boolean;
}
