import { http } from '@/lib/api-client';
import type {
  AdminClinicalDetailsPayload,
  ClinicalDetailsRequestResult,
  CreateMedicinePayload,
  Medicine,
  MedicineDataReview,
  MedicineImportCommitResult,
  MedicineImportPreview,
  MedicineMasterSearchResult,
  MedicinePackage,
  PackageImageCaptureResult,
  ResolveMedicineReviewPayload,
  StripVerificationResult,
  UpdateMedicinePayload,
  WebSourceAssistResult,
} from '@/types/medicine';
import {
  appendNativeOcrFields,
  type NativeOcrResult,
} from './native-text-ocr.service';

export interface MedicineListFilters {
  search?: string;
  isActive?: boolean;
  activeOnly?: boolean;
  form?: string;
  page?: number;
  limit?: number;
}

/** Shape returned by the paginated backend endpoint GET /medicines */
interface PaginatedMedicines {
  data: Medicine[];
  meta: { total: number; page: number; limit: number; totalPages: number };
}

interface PaginatedMedicineReviews {
  data: MedicineDataReview[];
  meta: { total: number; page: number; limit: number; totalPages: number };
}
const MASTER_SEARCH_CACHE_TTL_MS = 5 * 60 * 1000;
const masterSearchCache = new Map<
  string,
  { expiresAt: number; results: MedicineMasterSearchResult[] }
>();

function masterSearchCacheKey(query: string, limit: number) {
  return `${query.trim().toLocaleLowerCase()}::${limit}`;
}


export const medicinesService = {
  /** Returns flat Medicine[] by extracting the paginated data.data field. */
  list: async (filters?: MedicineListFilters): Promise<Medicine[]> => {
    const result = await http.get<PaginatedMedicines>('/medicines', { params: filters });
    // The backend returns { data: Medicine[], meta: {...} }
    // Our unwrap() already removed the ResponseInterceptor envelope,
    // so result here is the PaginatedMedicines object.
    return result?.data ?? [];
  },

  get: (id: string) => http.get<Medicine>(`/medicines/${id}`),

  requestClinicalDetails: (id: string) =>
    http.post<ClinicalDetailsRequestResult>(`/medicines/${id}/request-details`),

  searchMaster: async (q: string, limit = 8, signal?: AbortSignal) => {
    const cacheKey = masterSearchCacheKey(q, limit);
    const cached = masterSearchCache.get(cacheKey);

    if (cached && cached.expiresAt > Date.now()) {
      return cached.results;
    }

    const results = await http.get<MedicineMasterSearchResult[]>('/medicines/master/search', {
      params: { q, limit },
      signal,
    });
    masterSearchCache.set(cacheKey, { expiresAt: Date.now() + MASTER_SEARCH_CACHE_TTL_MS, results });
    return results;
  },

  getMaster: (id: string) => http.get<MedicineMasterSearchResult>(`/medicines/master/${id}`),

  requestMasterClinicalDetails: (id: string, medicinePackageId?: string | null) =>
    http.post<ClinicalDetailsRequestResult>(
      `/medicines/master/${id}/request-details`,
      medicinePackageId ? { medicinePackageId } : undefined,
    ),

  lookupBarcode: (gtin: string) =>
    http.get<{
      found: boolean;
      gtin: string;
      master?: MedicineMasterSearchResult;
      package?: MedicinePackage;
      packages?: Array<{
        master: MedicineMasterSearchResult;
        package: MedicinePackage;
      }>;
      message?: string;
    }>(
      `/medicines/master/barcode/${encodeURIComponent(gtin)}`,
    ),

  reportUnknownBarcode: (gtin: string, userStripImageUrl?: string) =>
    http.post<{ queued: boolean; gtin: string; message: string }>(
      `/medicines/master/barcode/${encodeURIComponent(gtin)}/review`,
      userStripImageUrl ? { userStripImageUrl } : undefined,
    ),

  capturePackageImage: (input: {
    file: File;
    nativeOcr?: NativeOcrResult | null;
    onProgress?: (pct: number) => void;
  }) => {
    const formData = new FormData();
    formData.append('file', input.file);
    appendNativeOcrFields(formData, input.nativeOcr);

    return http.post<PackageImageCaptureResult, FormData>(
      '/medicines/package-image/capture',
      formData,
      {
        headers: { 'Content-Type': 'multipart/form-data' },
        timeout: 120_000,
        onUploadProgress: (event) => {
          if (event.total && input.onProgress) {
            input.onProgress(Math.round((event.loaded / event.total) * 100));
          }
        },
      },
    );
  },

  verifyStripText: (id: string, input: {
    ocrText: string;
    ocrConfidence?: number;
    engine?: string;
  }) => http.post<StripVerificationResult>(`/medicines/${id}/verify-strip`, input),

  verifyStripImage: (id: string, file: File) => {
    const formData = new FormData();
    formData.append('file', file);
    return http.post<StripVerificationResult, FormData>(
      `/medicines/${id}/verify-strip-image`,
      formData,
      {
        headers: { 'Content-Type': 'multipart/form-data' },
        timeout: 120_000,
      },
    );
  },

  create: (payload: CreateMedicinePayload) =>
    http.post<Medicine, CreateMedicinePayload>('/medicines', payload),

  update: (id: string, payload: UpdateMedicinePayload) =>
    http.patch<Medicine, UpdateMedicinePayload>(`/medicines/${id}`, payload),

  remove: (id: string, permanent = true) =>
    http.delete<{ success: true }>(`/medicines/${id}`, {
      params: { permanent: String(permanent) },
    }),

  restore: (id: string) =>
    http.patch<Medicine>(`/medicines/${id}`, { isActive: true }),

  adjustStock: (id: string, delta: number) =>
    http.patch<Medicine>(`/medicines/${id}/stock`, { delta }),

  listReviews: (status = 'OPEN', page = 1, limit = 20, type?: string) =>
    http.get<PaginatedMedicineReviews>('/medicines/admin/reviews', {
      params: { status, page, limit, ...(type ? { type } : {}) },
    }),

  resolveReview: (id: string, payload: ResolveMedicineReviewPayload) =>
    http.patch<MedicineDataReview, ResolveMedicineReviewPayload>(
      `/medicines/admin/reviews/${id}/resolve`,
      payload,
    ),

  updateReviewClinicalDetails: (id: string, payload: AdminClinicalDetailsPayload) =>
    http.patch<MedicineDataReview, AdminClinicalDetailsPayload>(
      `/medicines/admin/reviews/${id}/clinical-details`,
      payload,
    ),

  assistReviewWebSources: (id: string, refresh = false) =>
    http.post<WebSourceAssistResult, { refresh: boolean }>(
      `/medicines/admin/reviews/${id}/web-source-assist`,
      { refresh },
      { timeout: 120_000 },
    ),

  uploadImport: (input: {
    file: File;
    datasetName?: string;
    datasetVersion?: string;
  }) => {
    const formData = new FormData();
    formData.append('file', input.file);
    if (input.datasetName) formData.append('datasetName', input.datasetName);
    if (input.datasetVersion) formData.append('datasetVersion', input.datasetVersion);

    return http.post<MedicineImportPreview, FormData>(
      '/medicines/admin/imports/upload',
      formData,
      { headers: { 'Content-Type': 'multipart/form-data' }, timeout: 120_000 },
    );
  },

  listImports: (page = 1, limit = 20) =>
    http.get<{
      data: MedicineImportPreview['batch'][];
      meta: { total: number; page: number; limit: number; totalPages: number };
    }>('/medicines/admin/imports', { params: { page, limit } }),

  previewImport: (batchId: string) =>
    http.get<MedicineImportPreview>(`/medicines/admin/imports/${batchId}/preview`),

  commitImport: (batchId: string, batchSize = 1000) =>
    http.post<MedicineImportCommitResult>(
      `/medicines/admin/imports/${batchId}/commit`,
      undefined,
      { params: { batchSize }, timeout: 120_000 },
    ),

  discardImport: (batchId: string) =>
    http.post<MedicineImportPreview['batch']>(
      `/medicines/admin/imports/${batchId}/discard`,
    ),
};
