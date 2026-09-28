export type VaccineCategory =
  | 'INFANT'
  | 'CHILD'
  | 'ADOLESCENT'
  | 'ADULT'
  | 'SENIOR'
  | 'SPECIAL_TRAVEL';

export type VaccinationStatus =
  | 'PENDING'
  | 'UPCOMING'
  | 'DUE_SOON'
  | 'OVERDUE'
  | 'COMPLETED'
  | 'SKIPPED';

export type CenterType =
  | 'GOVERNMENT_PHC'
  | 'PRIVATE_HOSPITAL'
  | 'PEDIATRIC_CLINIC'
  | 'IMMUNIZATION_CENTRE';

export type AdministrationRoute =
  | 'Intramuscular (IM)'
  | 'Oral (PO)'
  | 'Subcutaneous (SC)'
  | 'Intradermal (ID)'
  | 'Intramuscular (IM) / Intradermal (ID)'
  | 'Nasal Spray';

export interface VaccineCatalogItem {
  id: string;
  name: string;
  code: string;
  shortDescription: string;
  fullDescription: string;
  category: VaccineCategory;
  diseasePrevented: string[];
  targetAgeDescription: string;
  recommendedAgeMonthsMin: number;
  recommendedAgeMonthsMax: number;
  dosesCount: number;
  doseNumber: number;
  totalDosesInSeries: number;
  isMandatory: boolean;
  isUipGovernmentFree: boolean;
  estimatedCostInr: {
    government: number;
    privateMin: number;
    privateMax: number;
  };
  administrationRoute: AdministrationRoute;
  recommendedSites: string[];
  commonSideEffects: string[];
  precautionsAndContraindications: string[];
  boosterRecommendations?: string;
  storageTempCelsius?: string;
  manufacturerBrands?: string[];
}

export interface FamilyMemberProfile {
  id: string;
  name: string;
  relationship: 'Self' | 'Spouse' | 'Child' | 'Father' | 'Mother' | 'Other';
  dateOfBirth: string;
  gender: 'MALE' | 'FEMALE' | 'OTHER';
  bloodGroup?: string;
  allergies?: string[];
  preExistingConditions?: string[];
}

export interface VaccinationRecord {
  id: string;
  userId: string;
  memberId: string;
  memberName: string;
  vaccineId: string;
  vaccineName: string;
  vaccineCode: string;
  doseNumber: number;
  totalDoses: number;
  targetAgeMonths: number;
  dueDate: string;
  status: VaccinationStatus;
  administeredDate?: string;
  administeredBy?: string;
  clinicOrCenterName?: string;
  centerLocation?: string;
  batchNumber?: string;
  brandName?: string;
  adverseReactions?: string;
  certificateUrl?: string;
  certificateHash?: string;
  reminderEnabled: boolean;
  reminderDaysBefore: number[];
  notes?: string;
  isCustom: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface VaccinationScheduleResponse {
  familyProfiles: FamilyMemberProfile[];
  activeMemberId: string;
  summary: {
    totalScheduled: number;
    completedCount: number;
    dueSoonCount: number;
    overdueCount: number;
    upcomingCount: number;
    completionPercentage: number;
  };
  records: VaccinationRecord[];
}

export interface VaccinationCenter {
  id: string;
  name: string;
  type: CenterType;
  address: string;
  city: string;
  state: string;
  pincode?: string;
  latitude: number;
  longitude: number;
  distanceKm?: number;
  distanceText?: string;
  contactPhone: string;
  emergencyPhone?: string;
  email?: string;
  openingHours: string;
  operatingDays: string;
  isGovtFreeUip: boolean;
  vaccinesAvailable: string[];
  walkInAllowed: boolean;
  appointmentRequired: boolean;
  rating: number;
  reviewsCount: number;
  mapUrl: string;
  directionsUrl: string;
  source: 'OpenStreetMap' | 'CuratedDirectory';
}

export interface VaccineAppointment {
  id: string;
  userId: string;
  memberId: string;
  memberName: string;
  vaccineId: string;
  vaccineName: string;
  doseNumber: number;
  centerId: string;
  centerName: string;
  centerAddress: string;
  appointmentDate: string;
  timeSlot: string;
  status: 'CONFIRMED' | 'RESCHEDULED' | 'COMPLETED' | 'CANCELLED';
  bookingRef: string;
  notes?: string;
  createdAt: string;
}

export interface VaccinationPassport {
  passportNumber: string;
  verificationHash: string;
  issuedAt: string;
  patient: {
    name: string;
    relationship: string;
    dateOfBirth: string;
    ageYears: number;
    bloodGroup?: string;
    emergencyContact?: string;
  };
  summary: {
    totalScheduled: number;
    completedCount: number;
    dueSoonCount: number;
    overdueCount: number;
    completionPercentage: number;
  };
  immunizationHistory: {
    vaccineName: string;
    doseNumber: number;
    totalDoses: number;
    administeredDate: string;
    batchNumber?: string;
    centerName?: string;
    doctorName?: string;
    verified: boolean;
  }[];
  upcomingImmunizations: {
    vaccineName: string;
    doseNumber: number;
    dueDate: string;
    status: VaccinationStatus;
  }[];
}
