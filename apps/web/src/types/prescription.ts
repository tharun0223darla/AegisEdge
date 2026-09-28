export interface ExtractedMedicine {
  id: string;
  userId: string;
  prescriptionId?: string | null;
  billId?: string | null;
  medicineName: string;
  brandName?: string | null;
  genericName?: string | null;
  strength?: string | null;
  verificationStatus?: 'VERIFIED' | 'VERIFY_REQUIRED' | 'NEEDS_REVIEW' | null;
  reasons?: string[] | null;
  verificationSource?: string | null;
  dosage?: string | null;
  frequency?: string | null;
  timesOfDay: string[];
  durationDays?: number | null;
  quantity?: number | null;
  instructions?: string | null;
  confidenceScore?: number | null;
  isConfirmed: boolean;
  confirmedAt?: string | null;
  createdMedicineId?: string | null;
  createdScheduleId?: string | null;
  createdAt: string;
  updatedAt: string;
  capture?: BillCaptureCandidate | null;
}

export interface BillCaptureCandidate {
  rawName: string;
  source: 'BILL';
  billLine: string;
  extractedStrength?: string;
  extractedPack?: string;
  quantity?: number;
  confidence: number;
  resolverOutcome: {
    kind: 'STRONG' | 'POSSIBLE' | 'UNKNOWN';
    needsConfirm: true;
    match?: { masterId: string; score: number };
    matches?: Array<{ masterId: string; score: number }>;
  };
  masterMatches: Array<{
    id: string;
    brandName: string;
    composition?: string | null;
    genericName?: string | null;
    manufacturer?: string | null;
    strength?: string | null;
    type?: string | null;
    score?: number;
  }>;
}

export interface Prescription {
  id: string;
  userId: string;
  fileName: string;
  storedName: string;
  mimeType: string;
  fileSize: number;
  fileUrl?: string | null;
  rawOcrText?: string | null;
  status: 'UPLOADED' | 'OCR_PROCESSING' | 'OCR_PROCESSED' | 'CONFIRMED' | 'FAILED';
  doctorName?: string | null;
  prescribedAt?: string | null;
  notes?: string | null;
  confirmedAt?: string | null;
  extractedMedicines?: ExtractedMedicine[];
  createdAt: string;
  updatedAt: string;
}

export interface Bill {
  id: string;
  userId: string;
  fileName?: string;
  mimeType?: string;
  fileSize?: number;
  fileUrl?: string | null;
  rawOcrText?: string | null;
  pharmacyName?: string | null;
  purchaseDate?: string | null;
  totalAmount?: number | null;
  status?: 'UPLOADED' | 'OCR_PROCESSING' | 'OCR_PROCESSED' | 'CONFIRMED' | 'FAILED';
  notes?: string | null;
  confirmedAt?: string | null;
  extractedMedicines?: ExtractedMedicine[];
  _count?: { extractedMedicines?: number };
  createdAt: string;
  updatedAt?: string;
}

export interface BillUploadResult {
  bill: Bill;
  ocr: {
    success: boolean;
    confidence: number;
    wordsCount: number;
    rawText?: string | null;
    error?: string | null;
    safetyNotice: string;
  };
  extractedMedicines: ExtractedMedicine[];
  billCandidates: BillCaptureCandidate[];
}

export interface ConfirmBillMedicinePayload {
  extractedMedicineId?: string;
  medicineId?: string;
  medicineMasterId?: string;
  medicinePackageId?: string;
  medicineName: string;
  billLine?: string;
  strength?: string;
  form?: 'TABLET' | 'CAPSULE' | 'SYRUP' | 'INJECTION' | 'DROPS' | 'INHALER' | 'PATCH' | 'CREAM' | 'OINTMENT' | 'POWDER' | 'OTHER';
  unit?: string;
  quantityPurchased: number;
  dailyUsage?: number;
  pricePerUnit?: number;
  notes?: string;
}

export interface ConfirmBillPayload {
  medicines: ConfirmBillMedicinePayload[];
  pharmacyName?: string;
  purchaseDate?: string;
  totalAmount?: number;
}

export interface RefillLog {
  id: string;
  medicineId: string;
  medicine?: { id: string; name: string };
  quantity: number;
  source?: 'BILL' | 'MANUAL' | 'OTHER';
  refilledAt: string;
}

export interface StockSummaryItem {
  medicineId: string;
  medicineName: string;
  stockQuantity: number;
  refillThreshold?: number | null;
  estimatedDaysLeft?: number | null;
  status: 'OK' | 'LOW' | 'CRITICAL' | 'OUT';
}


export type PrescriptionVisionJobStatus =
  | 'QUEUED'
  | 'PROCESSING'
  | 'COMPLETED'
  | 'FAILED'
  | 'CANCELLED';

export interface PrescriptionVisionEvidence {
  name_image: string | null;
  context_image: string | null;
}

export interface PrescriptionVisionMedicineCandidate {
  line_number: number | null;
  dosage_form: string | null;
  medicine_raw: string | null;
  formulation_suffix: string | null;
  strength: string | null;
  quantity: string | null;
  schedule_raw: string | null;
  morning: boolean | null;
  afternoon: boolean | null;
  evening: boolean | null;
  exact_time: string | null;
  food_timing: string | null;
}

export interface PrescriptionVisionRow {
  row: number;
  column: number;
  ocr_anchor_text: string | null;
  ocr_confidence: number | null;
  medicine: PrescriptionVisionMedicineCandidate;
  field_status: Record<string, 'candidate' | 'uncertain' | 'absent'>;
  readable_candidate: boolean;
  review_required: true;
  uncertain_fields: string[];
  evidence: PrescriptionVisionEvidence;
}

export interface PrescriptionVisionPayload {
  status: 'human_review_required';
  auto_confirmed_count: 0;
  row_count: number;
  rows: PrescriptionVisionRow[];
}

export interface PrescriptionVisionJob {
  id: string;
  prescriptionId: string;
  status: PrescriptionVisionJobStatus;
  progress: number;
  stage?: string | null;
  attemptCount: number;
  resultJson?: PrescriptionVisionPayload | null;
  errorCode?: string | null;
  errorMessage?: string | null;
  startedAt?: string | null;
  heartbeatAt?: string | null;
  completedAt?: string | null;
  createdAt: string;
  updatedAt: string;
}
