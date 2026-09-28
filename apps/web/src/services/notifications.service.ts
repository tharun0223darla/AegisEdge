import { http } from '@/lib/api-client';
import type { AppNotification } from '@/types/notification';

export interface PhoneNotificationTestResult {
  notificationId: string;
  channel: 'SMS';
  sentAt: string;
  delivery: {
    provider: string;
    status: 'SENT' | 'SKIPPED' | 'FAILED';
    recipientMasked?: string;
    providerMessageId?: string;
    reason?: string;
    error?: string;
  } | null;
}

export interface NotificationPreferences {
  emailEnabled: boolean;
  missedDoseEmails: boolean;
  refillEmails: boolean;
  includeMedicineNames: boolean;
  updatedAt: string;
}

export type UpdateNotificationPreferences = Partial<
  Pick<
    NotificationPreferences,
    | 'emailEnabled'
    | 'missedDoseEmails'
    | 'refillEmails'
    | 'includeMedicineNames'
  >
>;

export interface EmailNotificationTestResult {
  notificationId: string | null;
  channel: 'EMAIL';
  sentAt?: string;
  delivery: {
    provider: string | null;
    status: 'PENDING' | 'PROCESSING' | 'SENT' | 'SKIPPED' | 'FAILED';
    recipientMasked?: string | null;
    providerMessageId?: string | null;
    lastErrorCode?: string | null;
    reason?: string;
  } | null;
}

export const notificationsService = {
  list: (params?: { unreadOnly?: boolean; limit?: number }) =>
    http.get<AppNotification[]>('/notifications', { params }),

  unreadCount: () => http.get<{ count: number }>('/notifications/unread-count'),

  markRead: (id: string) =>
    http.patch<AppNotification>(`/notifications/${id}/read`),

  markAllRead: () => http.post<{ success: true }>('/notifications/read-all'),

  sendPhoneTest: () =>
    http.post<PhoneNotificationTestResult>('/notifications/test-phone'),

  preferences: () =>
    http.get<NotificationPreferences>('/notifications/preferences'),

  updatePreferences: (input: UpdateNotificationPreferences) =>
    http.patch<NotificationPreferences>('/notifications/preferences', input),

  sendEmailTest: () =>
    http.post<EmailNotificationTestResult>('/notifications/test-email'),
};
