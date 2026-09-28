export type SafetyConditionStatus = 'UNKNOWN' | 'NO' | 'YES' | 'NOT_APPLICABLE';
export type AllergyCategory = 'ALLERGY' | 'INTOLERANCE';
export type AllergyCriticality = 'LOW' | 'HIGH' | 'UNABLE_TO_ASSESS';
export type AllergyClinicalStatus =
  | 'ACTIVE'
  | 'INACTIVE'
  | 'RESOLVED'
  | 'ENTERED_IN_ERROR';
export type SafetyVerificationStatus =
  | 'UNVERIFIED'
  | 'CONFIRMED'
  | 'REFUTED'
  | 'ENTERED_IN_ERROR';
export type MedicationSafetyRule =
  | 'EXACT_DUPLICATE'
  | 'DUPLICATE_INGREDIENT'
  | 'ALLERGY_CONFLICT'
  | 'OVERLAPPING_SCHEDULE'
  | 'UNKNOWN_COMPOSITION';
export type MedicationSafetySeverity = 'INFO' | 'WARNING' | 'HIGH';
export type MedicationSafetyFindingStatus =
  | 'OPEN'
  | 'ACKNOWLEDGED'
  | 'RESOLVED'
  | 'DISMISSED';

export interface PatientSafetyProfile {
  id: string;
  userId: string;
  pregnancyStatus: SafetyConditionStatus;
  kidneyCondition: SafetyConditionStatus;
  liverCondition: SafetyConditionStatus;
  source: string;
  verificationStatus: SafetyVerificationStatus;
  lastReviewedAt: string | null;
}

export interface AllergyIntolerance {
  id: string;
  substanceRaw: string;
  normalizedSubstance: string;
  category: AllergyCategory;
  criticality: AllergyCriticality;
  reaction: string | null;
  clinicalStatus: AllergyClinicalStatus;
  verificationStatus: SafetyVerificationStatus;
  source: string;
}

export interface MedicationSafetyFinding {
  id: string;
  rule: MedicationSafetyRule;
  severity: MedicationSafetySeverity;
  status: MedicationSafetyFindingStatus;
  title: string;
  summary: string;
  triggerIngredients: string[];
  evidence: Record<string, unknown>;
  sourceRefs: Array<Record<string, unknown>>;
  firstDetectedAt: string;
  lastDetectedAt: string;
  acknowledgedAt: string | null;
  medicines: Array<{
    id: string;
    name: string;
    strength: string | null;
    form: string;
  }>;
}

export interface MedicationSafetyOverview {
  profile: PatientSafetyProfile;
  allergies: AllergyIntolerance[];
  findings: MedicationSafetyFinding[];
  medicines: Array<{
    id: string;
    name: string;
    genericName: string | null;
    strength: string | null;
    form: string;
    medicineMasterId: string | null;
    schedules: Array<{ id: string }>;
  }>;
  summary: {
    activeMedicines: number;
    activeAllergies: number;
    open: number;
    acknowledged: number;
    high: number;
  };
  evaluatedAt: string;
  disclaimer: string;
  readOnly?: boolean;
}

export interface CreateAllergyInput {
  substance: string;
  category: AllergyCategory;
  criticality: AllergyCriticality;
  reaction?: string;
}
