import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { careService } from '@/services/care.service';
import type { CarePermission, CreateCareInvitationInput } from '@/types/care';

export const careKeys = {
  all: ['care'] as const,
  circle: () => [...careKeys.all, 'circle'] as const,
  supported: () => [...careKeys.all, 'supported'] as const,
  accessLog: () => [...careKeys.all, 'access-log'] as const,
  dashboard: (patientId: string) =>
    [...careKeys.all, 'dashboard', patientId] as const,
};

export function useCareCircle(enabled = true) {
  return useQuery({
    queryKey: careKeys.circle(),
    queryFn: careService.circle,
    enabled,
  });
}

export function useSupportedPeople(enabled = true) {
  return useQuery({
    queryKey: careKeys.supported(),
    queryFn: careService.supportedPeople,
    enabled,
  });
}

export function useCareAccessLog(enabled = true) {
  return useQuery({
    queryKey: careKeys.accessLog(),
    queryFn: careService.accessLog,
    enabled,
  });
}

export function useCareDashboard(patientId: string) {
  return useQuery({
    queryKey: careKeys.dashboard(patientId),
    queryFn: () => careService.dashboard(patientId),
    enabled: Boolean(patientId),
    staleTime: 30_000,
  });
}

export function useCareActions() {
  const queryClient = useQueryClient();
  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: careKeys.all });

  return {
    createInvitation: useMutation({
      mutationFn: (input: CreateCareInvitationInput) =>
        careService.createInvitation(input),
      onSuccess: refresh,
    }),
    revokeInvitation: useMutation({
      mutationFn: careService.revokeInvitation,
      onSuccess: refresh,
    }),
    updatePermissions: useMutation({
      mutationFn: (input: { id: string; permissions: CarePermission[] }) =>
        careService.updatePermissions(input.id, input.permissions),
      onSuccess: refresh,
    }),
    revokeRelationship: useMutation({
      mutationFn: careService.revokeRelationship,
      onSuccess: refresh,
    }),
  };
}
