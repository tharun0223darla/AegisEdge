import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { notify } from '@/components/ui/Toast';
import {
  submitDoseAction,
  type DoseActionSubmission,
} from '@/lib/dose-action-queue';
import { syncCurrentDeviceDoseReminders } from '@/lib/local-reminders';
import { extractErrorMessage } from '@/lib/api-client';
import {
  doseLogsService,
  type DoseLogFilters,
} from '@/services/dose-logs.service';
import { schedulesService } from '@/services/schedules.service';
import { careService } from '@/services/care.service';
import { useAuthStore } from '@/store/auth.store';
import type { CreateDoseLogPayload } from '@/types/dose-log';
import type { DoseBarrierReason } from '@/types/dose-log';

export const doseLogKeys = {
  all: ['doseLogs'] as const,
  list: (filters?: DoseLogFilters) =>
    [...doseLogKeys.all, 'list', filters ?? {}] as const,
};

export function useDoseLogs(filters?: DoseLogFilters) {
  return useQuery({
    queryKey: doseLogKeys.list(filters),
    queryFn: () => doseLogsService.list(filters).then((res) => res),
    staleTime: 15_000,
  });
}

export function useTodayDoses() {
  return useQuery({
    queryKey: [...doseLogKeys.all, 'today'],
    queryFn: async () => {
      await doseLogsService.reconcile();
      return schedulesService.today();
    },
    staleTime: 15_000,
  });
}

export function useDoseAction() {
  const queryClient = useQueryClient();
  const userId = useAuthStore((state) => state.user?.id);

  return useMutation<DoseActionSubmission, Error, CreateDoseLogPayload>({
    mutationFn: (payload) => {
      if (!userId) throw new Error('Sign in before recording a dose');
      return submitDoseAction(userId, payload);
    },
    onSuccess: async (result, payload) => {
      if (result.queued) {
        notify.message(
          'Saved on this device. It will sync when the connection returns.',
        );
      } else {
        notify.success(
          payload.status === 'TAKEN'
            ? 'Dose marked as taken.'
            : payload.status === 'SNOOZED'
              ? 'Reminder snoozed for 10 minutes.'
              : 'Dose skipped.',
        );
      }
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: doseLogKeys.all }),
        queryClient.invalidateQueries({ queryKey: ['schedules'] }),
        queryClient.invalidateQueries({ queryKey: ['dashboard'] }),
        queryClient.invalidateQueries({ queryKey: ['medicines'] }),
        queryClient.invalidateQueries({ queryKey: ['refills'] }),
      ]);
      void syncCurrentDeviceDoseReminders(14, true).catch(() => undefined);
    },
  });
}

export function useDoseHelpRequest() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (doseLogId: string) => careService.requestDoseHelp(doseLogId),
    onSuccess: async (result) => {
      if (result.eligibleCaregivers === 0) {
        notify.message(
          'No caregiver is currently authorized for dose help requests. Open Care Circle to grant access.',
        );
      } else if (result.alreadyRequested && result.newlyQueued === 0) {
        notify.message('A caregiver check-in has already been requested.');
      } else {
        notify.success('Caregiver check-in requested.');
      }
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: doseLogKeys.all }),
        queryClient.invalidateQueries({ queryKey: ['care'] }),
      ]);
    },
    onError: (error) => {
      notify.error(
        extractErrorMessage(error, 'Unable to request a caregiver check-in.'),
      );
    },
  });
}

export function useDoseBarrierSummary(days = 30) {
  return useQuery({
    queryKey: [...doseLogKeys.all, 'barriers', days],
    queryFn: () => doseLogsService.barrierSummary(days),
    staleTime: 30_000,
  });
}

export function useRecordDoseBarrier() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      doseLogId,
      reason,
    }: {
      doseLogId: string;
      reason: DoseBarrierReason;
    }) => doseLogsService.recordBarrier(doseLogId, reason),
    onSuccess: async () => {
      notify.success('Reason saved.');
      await queryClient.invalidateQueries({ queryKey: doseLogKeys.all });
    },
    onError: (error) => {
      notify.error(extractErrorMessage(error, 'Unable to save the reason.'));
    },
  });
}
