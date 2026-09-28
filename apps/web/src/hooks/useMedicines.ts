import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { medicinesService, type MedicineListFilters } from '@/services/medicines.service';
import type { CreateMedicinePayload, UpdateMedicinePayload } from '@/types/medicine';

export const medicineKeys = {
  all: ['medicines'] as const,
  list: (filters?: MedicineListFilters) => [...medicineKeys.all, 'list', filters ?? {}] as const,
  detail: (id: string) => [...medicineKeys.all, 'detail', id] as const,
};

export function useMedicines(filters?: MedicineListFilters) {
  return useQuery({
    queryKey: medicineKeys.list(filters),
    queryFn: () => medicinesService.list(filters),
    staleTime: 30_000,
  });
}

export function useMedicine(id: string | undefined) {
  return useQuery({
    queryKey: medicineKeys.detail(id ?? ''),
    queryFn: () => medicinesService.get(id as string),
    enabled: Boolean(id),
  });
}

export function useCreateMedicine() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: CreateMedicinePayload) => medicinesService.create(payload),
    onSuccess: () => qc.invalidateQueries({ queryKey: medicineKeys.all }),
  });
}

export function useUpdateMedicine(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: UpdateMedicinePayload) => medicinesService.update(id, payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: medicineKeys.all });
      qc.invalidateQueries({ queryKey: medicineKeys.detail(id) });
    },
  });
}

export function useDeleteMedicine() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: string | { id: string; permanent?: boolean }) => {
      const id = typeof args === 'string' ? args : args.id;
      const permanent = typeof args === 'string' ? true : (args.permanent ?? true);
      return medicinesService.remove(id, permanent);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: medicineKeys.all });
      qc.invalidateQueries({ queryKey: ['schedules'] });
      qc.invalidateQueries({ queryKey: ['doseLogs'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
    },
  });
}

export function useRestoreMedicine() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => medicinesService.restore(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: medicineKeys.all });
      qc.invalidateQueries({ queryKey: ['schedules'] });
      qc.invalidateQueries({ queryKey: ['doseLogs'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
    },
  });
}
