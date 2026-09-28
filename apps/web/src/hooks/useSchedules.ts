import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { notify } from '@/components/ui/Toast';
import {
  syncCurrentDeviceDoseReminders,
  syncLocalDoseReminders,
} from '@/lib/local-reminders';
import {
  schedulesService,
  type ScheduleListFilters,
} from '@/services/schedules.service';
import type {
  CreateSchedulePayload,
  UpdateSchedulePayload,
} from '@/types/schedule';

export const scheduleKeys = {
  all: ['schedules'] as const,
  list: (filters?: ScheduleListFilters) =>
    [...scheduleKeys.all, 'list', filters ?? {}] as const,
  detail: (id: string) => [...scheduleKeys.all, 'detail', id] as const,
};

export function useSchedules(filters?: ScheduleListFilters) {
  return useQuery({
    queryKey: scheduleKeys.list(filters),
    queryFn: () => schedulesService.list(filters),
    staleTime: 30_000,
  });
}

export function useCreateSchedule() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: CreateSchedulePayload) =>
      schedulesService.create(payload),
    onSuccess: async (schedule) => {
      try {
        const result = schedule.reminderPlan
          ? await syncLocalDoseReminders(schedule.reminderPlan)
          : await syncCurrentDeviceDoseReminders(14, true);
        if (result.mode === 'denied') {
          notify.error(
            result.warning ||
              'Schedule saved, but notification permission is disabled.',
          );
          return;
        }
        if (result.mode === 'unsupported') {
          notify.message(
            result.warning ||
              'Schedule saved, but this device cannot create offline reminders.',
          );
          return;
        }
        if (result.scheduledCount === 0) {
          notify.message(
            'Schedule saved, but no future reminder time was found. Choose a time at least 2 minutes ahead.',
          );
          return;
        }
        if (result.mode === 'native') {
          notify.success(
            `${result.scheduledCount} upcoming device reminder${result.scheduledCount === 1 ? '' : 's'} scheduled.`,
          );
        }
        if (result.warning) notify.message(result.warning);
      } catch {
        notify.error(
          'Schedule saved, but device reminder sync failed. Use Sync Device Reminders in Settings.',
        );
      } finally {
        void queryClient.invalidateQueries({ queryKey: scheduleKeys.all });
      }
    },
  });
}

export function useUpdateSchedule(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: UpdateSchedulePayload) =>
      schedulesService.update(id, payload),
    onSuccess: () => {
      void syncCurrentDeviceDoseReminders(14, true).catch(() => undefined);
      void queryClient.invalidateQueries({ queryKey: scheduleKeys.all });
    },
  });
}

export function useDeleteSchedule() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => schedulesService.remove(id),
    onSuccess: () => {
      void syncCurrentDeviceDoseReminders(14, true).catch(() => undefined);
      void queryClient.invalidateQueries({ queryKey: scheduleKeys.all });
    },
  });
}
