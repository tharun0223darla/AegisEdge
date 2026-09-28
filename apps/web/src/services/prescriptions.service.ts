import { http, apiClient } from '@/lib/api-client';
import type {
  Bill,
  BillUploadResult,
  ConfirmBillPayload,
  Prescription,
  PrescriptionVisionJob,
} from '@/types/prescription';
import {
  appendNativeOcrFields,
  type NativeOcrResult,
} from './native-text-ocr.service';

interface PaginatedPrescriptions {
  data: Prescription[];
  meta: { total: number; page: number; limit: number; totalPages: number };
}

interface PaginatedBills {
  data: Bill[];
  meta: { total: number; page: number; limit: number; totalPages: number };
}

export const prescriptionsService = {
  list: async (): Promise<Prescription[]> => {
    const res = await http.get<PaginatedPrescriptions>('/prescriptions');
    return res?.data ?? [];
  },

  get: (id: string) => http.get<Prescription>(`/prescriptions/${id}`),

  upload: async (
    file: File,
    onProgress?: (pct: number) => void,
  ): Promise<{
    extractionMode?: 'VISION_JOB_QUEUED' | string;
    visionJob?: PrescriptionVisionJob;
    message?: string;
    prescription: Prescription;
    ocr: {
      success: boolean;
      status?: 'QUEUED' | 'PROCESSING' | 'COMPLETED' | 'FAILED' | string;
      confidence: number;
      wordsCount: number;
      rawText: string | null;
      error?: string | null;
      safetyNotice?: string;
      message?: string;
    };
    extractedMedicines: any[];
    reviewRequired?: boolean;
    failureStage?: string | null;
  }> => {
    const fd = new FormData();
    fd.append('file', file);
    const { data } = await apiClient.post<any>('/prescriptions/upload', fd, {
      headers: { 'Content-Type': 'multipart/form-data' },
      timeout: 300_000,
      onUploadProgress: (e) => {
        if (e.total && onProgress)
          onProgress(Math.round((e.loaded / e.total) * 100));
      },
    });
    return data.data;
  },

  startVisionReview: (id: string) =>
    http.post<PrescriptionVisionJob>(`/prescriptions/${id}/vision-review`),

  getLatestVisionReviewJob: (id: string) =>
    http.get<PrescriptionVisionJob>(`/prescriptions/${id}/vision-review`),

  getVisionReviewJob: (prescriptionId: string, jobId: string) =>
    http.get<PrescriptionVisionJob>(
      `/prescriptions/${prescriptionId}/vision-review/${jobId}`,
    ),

  confirm: (
    id: string,
    payload: {
      medicines: {
        extractedMedicineId?: string;
        medicineName: string;
        dosage?: string;
        brandName?: string;
        frequency: string;
        timesOfDay: string[];
        durationDays?: number;
        totalQuantity?: number;
        instructions?: string;
        createSchedule?: boolean;
      }[];
      doctorName?: string;
      prescribedAt?: string;
    },
  ) => http.post<any>(`/prescriptions/${id}/confirm`, payload),

  remove: (id: string) =>
    http.delete<{ success: true }>(`/prescriptions/${id}`),
};

export const billsService = {
  list: async (): Promise<Bill[]> => {
    const res = await http.get<PaginatedBills>('/bills');
    return res?.data ?? [];
  },
  get: (id: string) => http.get<Bill>(`/bills/${id}`),
  upload: async (
    file: File,
    onProgress?: (pct: number) => void,
    nativeOcr?: NativeOcrResult | null,
  ) => {
    const fd = new FormData();
    fd.append('file', file);
    appendNativeOcrFields(fd, nativeOcr);
    const { data } = await apiClient.post<{ data: BillUploadResult }>(
      '/bills/upload',
      fd,
      {
        headers: { 'Content-Type': 'multipart/form-data' },
        timeout: 120_000,
        onUploadProgress: (e) => {
          if (e.total && onProgress)
            onProgress(Math.round((e.loaded / e.total) * 100));
        },
      },
    );
    return data.data;
  },
  confirm: (id: string, payload: ConfirmBillPayload) =>
    http.post<{
      billId: string;
      status: 'CONFIRMED';
      medicines: Array<{
        medicineName: string;
        medicineId: string | null;
        quantityUpdated: boolean;
        refillLogId: string | null;
        expectedFinishDate: string | null;
        refillReminderDate: string | null;
        reviewQueued?: boolean;
      }>;
      message: string;
    }>(`/bills/${id}/confirm`, payload),
  remove: (id: string) => http.delete<{ success: true }>(`/bills/${id}`),
};
