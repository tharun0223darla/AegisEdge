import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { medicationSafetyService } from '@/services/medication-safety.service';
import type {
  CreateAllergyInput,
  SafetyConditionStatus,
} from '@/types/medication-safety';

export const medicationSafetyKeys = {
  all: ['medication-safety'] as const,
  overview: () => [...medicationSafetyKeys.all, 'overview'] as const,
  caregiver: (patientId: string) =>
    [...medicationSafetyKeys.all, 'caregiver', patientId] as const,
};

export function useMedicationSafety() {
  return useQuery({
    queryKey: medicationSafetyKeys.overview(),
    queryFn: medicationSafetyService.overview,
    staleTime: 30_000,
  });
}

export function useCaregiverMedicationSafety(
  patientId: string,
  enabled: boolean,
) {
  return useQuery({
    queryKey: medicationSafetyKeys.caregiver(patientId),
    queryFn: () => medicationSafetyService.caregiverOverview(patientId),
    enabled: Boolean(patientId) && enabled,
    staleTime: 30_000,
  });
}

export function useMedicationSafetyActions() {
  const queryClient = useQueryClient();
  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: medicationSafetyKeys.all });

  return {
    reconcile: useMutation({
      mutationFn: medicationSafetyService.reconcile,
      onSuccess: refresh,
    }),
    updateProfile: useMutation({
      mutationFn: (input: {
        pregnancyStatus: SafetyConditionStatus;
        kidneyCondition: SafetyConditionStatus;
        liverCondition: SafetyConditionStatus;
      }) => medicationSafetyService.updateProfile(input),
      onSuccess: refresh,
    }),
    createAllergy: useMutation({
      mutationFn: (input: CreateAllergyInput) =>
        medicationSafetyService.createAllergy(input),
      onSuccess: refresh,
    }),
    removeAllergy: useMutation({
      mutationFn: medicationSafetyService.removeAllergy,
      onSuccess: refresh,
    }),
    acknowledge: useMutation({
      mutationFn: (input: { id: string; note?: string }) =>
        medicationSafetyService.acknowledge(input.id, input.note),
      onSuccess: refresh,
    }),
  };
}
