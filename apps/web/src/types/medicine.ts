export type MedicineForm =
  | 'TABLET'
  | 'CAPSULE'
  | 'SYRUP'
  | 'INJECTION'
  | 'DROPS'
  | 'INHALER'
  | 'PATCH'
  | 'CREAM'
  | 'OINTMENT'
  | 'POWDER'
  | 'OTHER';

export type MedSource =
  | 'MANUAL'
  | 'BILL'
  | 'BARCODE'
  | 'PRESCRIPTION'
  | 'PACKAGE_IMAGE'
  | 'IMPORT';
export type EnrichmentStatus = 'NEEDS_SOURCE' | 'PARTIAL' | 'COMPLETE';

export type PatientExplanationStatus =
  | 'NEEDS_SOURCE'
  | 'GENERATED'
  | 'REVIEW_REQUIRED'
  | 'REVIEWED';

export interface PatientExplanation {
  id: string;
  language: string;
  status: PatientExplanationStatus;
  whyPrescribed?: string | null;
  howToTake?: string | null;
  sideEffects: string[];
  warnings?: string | null;
  storage?: string | null;
  sourceRefs?: Record<string, unknown>;
  unsafeOmittedFields?: string[];
  generatedBy?: string | null;
  modelVersion?: string | null;
  reviewedAt?: string | null;
  updatedAt?: string | null;
  disclaimer: string;
}
export type MedicineReviewType =
  | 'UNKNOWN_MANUAL'
  | 'UNKNOWN_BARCODE'
  | 'MISSING_IMAGE'
  | 'LOW_CONFIDENCE_MATCH'
  | 'MISSING_CLINICAL_DETAILS';
export type MedicineReviewStatus = 'OPEN' | 'LINKED' | 'VERIFIED' | 'REJECTED';
export type MedicineImportStatus =
  | 'STAGED'
  | 'COMMITTING'
  | 'COMMITTED'
  | 'DISCARDED'
  | 'FAILED';
export type MedicineImportRowAction =
  | 'CREATE'
  | 'UPDATE'
  | 'DUPLICATE_IN_FILE'
  | 'INVALID'
  | 'NOOP';

export interface SaltProfile {
  id: string;
  saltKey: string;
  displayName: string;
  ingredients: Array<Record<string, unknown>>;
  uses?: string | null;
  howToTake?: string | null;
  whenToTake?: string | null;
  sideEffects?: string[];
  warnings?: string | null;
  substitutes?: string[];
  storage?: string | null;
  sourceRefs?: Record<string, unknown>;
  enrichmentStatus?: EnrichmentStatus;
  isVerified?: boolean;
  language?: string;
  patientExplanations?: PatientExplanation[];
}

export interface MedicinePackage {
  id: string;
  medicineId: string;
  gtin?: string | null;
  barcodeType?: string | null;
  packSize?: string | null;
  stripImageUrl?: string | null;
  pillImageUrl?: string | null;
  mrpPrice?: string | null;
  priceCurrency?: string | null;
  priceSource?: string | null;
  priceLastSeenAt?: string | null;
  isVerified?: boolean;
  verifiedAt?: string | null;
}

export interface MedicineMasterSearchResult {
  id: string;
  brandName: string;
  genericName?: string | null;
  composition?: string | null;
  category?: string | null;
  manufacturer?: string | null;
  strength?: string | null;
  type?: string | null;
  isDiscontinued?: boolean;
  prescriptionRequired?: boolean | null;
  saltProfileId?: string | null;
  saltProfile?: SaltProfile | null;
  packages?: MedicinePackage[];
  score?: number;
  matchReason?: 'brand' | 'composition';
}

export interface MedicineEnrichment {
  status: 'AVAILABLE' | 'NEEDS_SOURCE';
  enrichmentStatus?: EnrichmentStatus;
  saltProfileId?: string | null;
  composition?: string | null;
  uses?: string | null;
  howToTake?: string | null;
  whenToTake?: string | null;
  sideEffects: string[];
  warnings?: string | null;
  substitutes: string[];
  storage?: string | null;
  patientExplanation?: PatientExplanation | null;
  stripImageUrl?: string | null;
  pillImageUrl?: string | null;
  sourceRefs?: Record<string, unknown>;
  unsafeOmittedFields?: string[];
  disclaimer: string;
}

export interface Medicine {
  id: string;
  userId: string;
  medicineMasterId?: string | null;
  medicinePackageId?: string | null;
  captureReviewKey?: string | null;
  name: string;
  genericName?: string | null;
  brandName?: string | null;
  form: MedicineForm;
  strength?: string | null;
  unit?: string | null;
  stockQuantity: number;
  refillThreshold?: number | null;
  source?: MedSource;
  userStripImageUrl?: string | null;
  stripReferenceReady?: boolean;
  visualConfirmed?: boolean;
  notes?: string | null;
  isActive: boolean;
  master?: MedicineMasterSearchResult | null;
  package?: MedicinePackage | null;
  enrichment?: MedicineEnrichment;
  createdAt: string;
  updatedAt: string;
}

export interface CreateMedicinePayload {
  medicineMasterId?: string;
  medicinePackageId?: string;
  name: string;
  genericName?: string;
  brandName?: string;
  form: MedicineForm;
  strength?: string;
  unit?: string;
  stockQuantity?: number;
  refillThreshold?: number;
  source?: MedSource;
  userStripImageUrl?: string;
  userStripOcrText?: string;
  userStripOcrEngine?: string;
  visualConfirmed?: boolean;
  notes?: string;
}

export interface PackageImageCaptureResult {
  image: {
    fileName: string;
    storedName: string;
    mimeType: string;
    fileSize: number;
    imageUrl: string;
  };
  ocr: {
    success: boolean;
    source: 'ML_KIT' | 'SERVER_OCR' | 'NO_RESULT';
    fallbackReason?: string | null;
    confidence: number;
    wordsCount: number;
    rawText?: string | null;
    engine?: 'mlkit' | 'paddleocr' | 'tesseract' | 'google-vision';
    diagnostics?: {
      textLength: number;
      blockCount: number;
      lineCount: number;
      elementCount: number;
      processingMs: number;
    };
    error?: string | null;
  };
  candidate: null | {
    rawName: string;
    source: 'PACKAGE_IMAGE';
    imageUrl: string;
    extractedStrength?: string;
    extractedPack?: string;
    ocrLine?: string;
    fullText?: string;
    allLines?: string[];
    composition?: {
      displayName: string;
      ingredients: string[];
      rawLine: string;
      sourceLines: string[];
      confidence: number;
      searchTerms: string[];
    };
    ocrConfidence: number;
    weak: boolean;
    reason?: string;
    isAutoCorrected?: boolean;
    originalOcrText?: string;
    resolverOutcome: {
      kind: 'STRONG' | 'POSSIBLE' | 'UNKNOWN';
      needsConfirm: true;
      match?: { masterId: string; score: number };
      matches?: Array<{ masterId: string; score: number }>;
    };
    masterMatches: MedicineMasterSearchResult[];
  };
  reviewRequired: boolean;
  message: string;
}

export type UpdateMedicinePayload = Partial<CreateMedicinePayload> & {
  isActive?: boolean;
};

export interface StripVerificationResult {
  medicineId: string;
  expectedMedicine: string;
  hasStoredStrip: boolean;
  hasStoredOcrReference: boolean;
  status: 'MATCH' | 'MISMATCH' | 'UNCERTAIN';
  score: number;
  reason: string;
  matchedEvidence: string[];
  ocrConfidence: number;
  engine?: string;
  safetyNotice: string;
}

export interface MedicineDataReview {
  id: string;
  type: MedicineReviewType;
  status: MedicineReviewStatus;
  normalizedKey?: string | null;
  source?: MedSource | null;
  strength?: string | null;
  form?: MedicineForm | null;
  rawName?: string | null;
  gtin?: string | null;
  userStripImageUrl?: string | null;
  billLine?: string | null;
  demandCount?: number;
  payload?: Record<string, unknown> | null;
  notes?: string | null;
  adminNotes?: string | null;
  submittedBy?: { id: string; email: string; role: string } | null;
  reviewedBy?: { id: string; email: string; role: string } | null;
  medicineMaster?: MedicineMasterSearchResult | null;
  medicinePackage?: MedicinePackage | null;
  saltProfile?: SaltProfile | null;
  reviewedAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export type AdminClinicalSourceType =
  | 'ADMIN'
  | 'WEB_ASSISTED'
  | 'NFI_IPC'
  | 'CDSCO'
  | 'DailyMed'
  | 'openFDA'
  | 'MedlinePlus';

export interface WebSourceAssistResult {
  configured: boolean;
  provider: 'Tavily';
  query: string;
  generatedAt: string;
  message: string;
  sources: Array<{
    title: string;
    url: string;
    host: string;
    tier: 'OFFICIAL' | 'MEDICAL_REFERENCE' | 'IDENTITY_ONLY' | 'REJECTED';
    reason: string;
    score?: number;
    snippet?: string;
    relevanceScore?: number;
    usableForClinicalFields: boolean;
  }>;
  evidence: Array<{
    field: 'uses' | 'howToTake' | 'sideEffects' | 'warnings' | 'storage';
    sourceTitle: string;
    sourceUrl: string;
    snippet: string;
  }>;
  draft: {
    uses?: string;
    howToTake?: string;
    sideEffects?: string[];
    warnings?: string;
    storage?: string;
    sourceNote?: string;
    unsafeDoseFields?: string[];
  };
  warnings: string[];
  cached?: boolean;
  cacheId?: string;
  cacheExpiresAt?: string | null;
}
export interface AdminClinicalDetailsPayload {
  uses?: string;
  howToTake?: string;
  sideEffects?: string[];
  warnings?: string;
  storage?: string;
  sourceType?: AdminClinicalSourceType;
  sourceTitle: string;
  sourceUrl?: string;
  sourceNote?: string;
  adminNotes?: string;
}
export interface ResolveMedicineReviewPayload {
  status?: Exclude<MedicineReviewStatus, 'OPEN'>;
  medicineMasterId?: string;
  medicinePackageId?: string;
  package?: {
    medicineMasterId: string;
    gtin?: string;
    barcodeType?: string;
    packSize?: string;
    stripImageUrl?: string;
    pillImageUrl?: string;
  };
  adminNotes?: string;
}

export interface ClinicalDetailsRequestResult {
  queued: boolean;
  alreadyAvailable: boolean;
  reviewId?: string;
  demandCount?: number;
  missingFields?: string[];
  message: string;
}
export interface MedicineImportBatch {
  id: string;
  originalFileName?: string | null;
  datasetName?: string | null;
  datasetVersion?: string | null;
  status: MedicineImportStatus;
  totalRows: number;
  validRows: number;
  invalidRows: number;
  duplicateRows: number;
  createRows: number;
  updateRows: number;
  saltsToCreate: number;
  saltsToReuse: number;
  committedRows: number;
  skippedRows: number;
  report?: Record<string, unknown> | null;
  committedAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface MedicineImportStagingRow {
  id: string;
  rowNumber: number;
  action: MedicineImportRowAction;
  brandName?: string | null;
  composition?: string | null;
  manufacturer?: string | null;
  strength?: string | null;
  packSize?: string | null;
  gtin?: string | null;
  saltKey?: string | null;
  saltDisplayName?: string | null;
  dedupeKey?: string | null;
  validationErrors: string[];
  warnings: string[];
  duplicateInFile: boolean;
}

export interface MedicineImportPreview {
  batch: MedicineImportBatch;
  actionCounts: Partial<Record<MedicineImportRowAction, number>>;
  sampleRows: MedicineImportStagingRow[];
}

export interface MedicineImportCommitResult {
  batchId: string;
  committedRows: number;
  skippedRows: number;
  createdMasters: number;
  updatedMasters: number;
  createdSalts: number;
  reusedSalts: number;
}
