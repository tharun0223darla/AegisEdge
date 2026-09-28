import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { billsService, prescriptionsService } from '@/services/prescriptions.service';
import type { ConfirmBillPayload } from '@/types/prescription';

export const prescriptionKeys = {
  all: ['prescriptions'] as const,
  list: () => [...prescriptionKeys.all, 'list'] as const,
  detail: (id: string) => [...prescriptionKeys.all, 'detail', id] as const,
  visionLatest: (id: string) =>
    [...prescriptionKeys.all, 'vision-latest', id] as const,
  visionJob: (prescriptionId: string, jobId: string) =>
    [...prescriptionKeys.all, 'vision-job', prescriptionId, jobId] as const,
};

export const billKeys = {
  all: ['bills'] as const,
  list: () => [...billKeys.all, 'list'] as const,
  detail: (id: string) => [...billKeys.all, 'detail', id] as const,
};

export function usePrescriptions() {
  return useQuery({
    queryKey: prescriptionKeys.list(),
    queryFn: () => prescriptionsService.list(),
    staleTime: 30_000,
  });
}

export function usePrescription(id: string | undefined) {
  return useQuery({
    queryKey: prescriptionKeys.detail(id ?? ''),
    queryFn: () => prescriptionsService.get(id as string),
    enabled: Boolean(id),
  });
}

export function useUploadPrescription() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ file, onProgress }: { file: File; onProgress?: (pct: number) => void }) =>
      prescriptionsService.upload(file, onProgress),
    onSuccess: () => qc.invalidateQueries({ queryKey: prescriptionKeys.all }),
  });
}


export function useLatestPrescriptionVisionJob(
  id: string | undefined,
) {
  return useQuery({
    queryKey: prescriptionKeys.visionLatest(id ?? ''),
    queryFn: () =>
      prescriptionsService.getLatestVisionReviewJob(id as string),
    enabled: Boolean(id),
    retry: false,
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status === 'QUEUED' || status === 'PROCESSING'
        ? 3_000
        : false;
    },
  });
}

export function useStartPrescriptionVisionReview(id: string) {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: () => prescriptionsService.startVisionReview(id),
    onSuccess: (job) => {
      qc.setQueryData(
        prescriptionKeys.visionLatest(id),
        job,
      );
    },
  });
}

export function useConfirmPrescription(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: {
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
    }) => prescriptionsService.confirm(id, payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: prescriptionKeys.all });
      qc.invalidateQueries({ queryKey: prescriptionKeys.detail(id) });
      qc.invalidateQueries({ queryKey: ['medicines'] }); // Refresh medicine list as well!
    },
  });
}

export function useDeletePrescription() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => prescriptionsService.remove(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: prescriptionKeys.all }),
  });
}

export function useBills() {
  return useQuery({
    queryKey: billKeys.list(),
    queryFn: () => billsService.list(),
    staleTime: 30_000,
  });
}

export function useUploadBill() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ file, onProgress, nativeOcr }: {
      file: File;
      onProgress?: (pct: number) => void;
      nativeOcr?: import('@/services/native-text-ocr.service').NativeOcrResult | null;
    }) => billsService.upload(file, onProgress, nativeOcr),
    onSuccess: () => qc.invalidateQueries({ queryKey: billKeys.all }),
  });
}

export function useConfirmBill() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: ConfirmBillPayload }) =>
      billsService.confirm(id, payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: billKeys.all });
      qc.invalidateQueries({ queryKey: ['medicines'] });
    },
  });
}
