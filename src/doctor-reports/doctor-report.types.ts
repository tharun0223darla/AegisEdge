import type { DoctorReportSection } from '@prisma/client';

export const DOCTOR_REPORT_SECTIONS: DoctorReportSection[] = [
  'MEDICATIONS',
  'ADHERENCE',
  'ALLERGIES',
  'SAFETY',
  'REFILLS',
  'VITALS',
];

export interface DoctorReportSnapshot {
  version: 1;
  generatedAt: string;
  range: { start: string; end: string };
  sections: DoctorReportSection[];
  patient: {
    displayName: string;
    contactEmail?: string | null;
    dateOfBirth: string | null;
    bloodGroup: string | null;
    conditions: string[];
  };
  medications?: {
    items: Array<{
      name: string;
      genericName: string | null;
      composition: string | null;
      form: string;
      strength: string | null;
      instructions: string | null;
      schedules: Array<{
        frequency: string;
        timesOfDay: string[];
        daysOfWeek: number[];
        dosesPerIntake: number;
        unit: string;
        startDate: string;
        endDate: string | null;
        timezone: string;
      }>;
      lastUpdatedAt: string;
    }>;
    total: number;
    truncated: boolean;
    lastUpdatedAt: string | null;
  };
  adherence?: {
    totalScheduled: number;
    taken: number;
    missed: number;
    skipped: number;
    snoozed: number;
    pending: number;
    recordedDoses: number;
    adherencePercent: number | null;
    byMedicine: Array<{
      name: string;
      taken: number;
      missed: number;
      skipped: number;
      recordedDoses: number;
      adherencePercent: number | null;
    }>;
    truncated: boolean;
    methodology: string;
    lastUpdatedAt: string | null;
  };
  allergies?: {
    items: Array<{
      substance: string;
      category: string;
      criticality: string;
      reaction: string | null;
      verificationStatus: string;
      source: string;
      lastUpdatedAt: string;
    }>;
    total: number;
    truncated: boolean;
    lastUpdatedAt: string | null;
  };
  safety?: {
    items: Array<{
      severity: string;
      status: string;
      title: string;
      summary: string;
      medicines: string[];
      lastDetectedAt: string;
    }>;
    total: number;
    truncated: boolean;
    lastUpdatedAt: string | null;
    disclaimer: string;
  };
  refills?: {
    items: Array<{
      medicineName: string;
      strength: string | null;
      remainingQuantity: number | null;
      unit: string | null;
      refillThreshold: number | null;
      status: 'OUT' | 'LOW' | 'ADEQUATE' | 'UNKNOWN';
      expectedFinishDate: string | null;
      refillReminderDate: string | null;
      lastUpdatedAt: string;
    }>;
    total: number;
    truncated: boolean;
    lastUpdatedAt: string | null;
  };
  vitals?: {
    items: Array<{
      metricType: string;
      value: unknown;
      unit: string;
      recordedAt: string;
      receivedAt: string;
      source: string;
      quality: string;
      qualityFlags: string[];
    }>;
    total: number;
    truncated: boolean;
    lastUpdatedAt: string | null;
    disclaimer: string;
  };
  limitations: string[];
  disclaimer: string;
}
