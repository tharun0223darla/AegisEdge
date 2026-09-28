import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { notificationsService } from '@/services/notifications.service';

export const notificationKeys = {
  all: ['notifications'] as const,
  list: (params?: { unreadOnly?: boolean; limit?: number }) =>
    [...notificationKeys.all, 'list', params ?? {}] as const,
  unreadCount: () => [...notificationKeys.all, 'unreadCount'] as const,
};

export function useNotifications(params?: {
  unreadOnly?: boolean;
  limit?: number;
}) {
  return useQuery({
    queryKey: notificationKeys.list(params),
    queryFn: () => notificationsService.list(params),
    staleTime: 10_000,
  });
}

export function useNotificationUnreadCount() {
  return useQuery({
    queryKey: notificationKeys.unreadCount(),
    queryFn: () => notificationsService.unreadCount(),
    staleTime: 10_000,
    refetchInterval: 30_000,
  });
}

export function useMarkNotificationRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => notificationsService.markRead(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: notificationKeys.all });
    },
  });
}

export function useMarkAllNotificationsRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => notificationsService.markAllRead(),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: notificationKeys.all });
    },
  });
}
export function useSendPhoneNotificationTest() {
  return useMutation({
    mutationFn: () => notificationsService.sendPhoneTest(),
  });
}

export function useSendEmailNotificationTest() {
  return useMutation({
    mutationFn: () => notificationsService.sendEmailTest(),
  });
}
