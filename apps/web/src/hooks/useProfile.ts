import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { patientService, type UpdatePatientProfilePayload } from '@/services/patient.service';

export const profileKeys = {
  me: ['profile', 'me'] as const,
};

export function useProfile() {
  return useQuery({
    queryKey: profileKeys.me,
    queryFn: () => patientService.getProfile(),
    staleTime: 60_000,
  });
}

export function useCreateProfile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: UpdatePatientProfilePayload) => patientService.createProfile(payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: profileKeys.me });
      qc.invalidateQueries({ queryKey: ['auth', 'me'] });
    },
  });
}

export function useUpdateProfile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: UpdatePatientProfilePayload) => patientService.updateProfile(payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: profileKeys.me });
      qc.invalidateQueries({ queryKey: ['auth', 'me'] });
    },
  });
}
