export type NotificationType =
  | 'DOSE_REMINDER'
  | 'MISSED_DOSE'
  | 'REFILL_DUE'
  | 'SYSTEM'
  | 'INFO';

export interface AppNotification {
  id: string;
  type: NotificationType;
  title: string;
  message?: string;
  body?: string;
  isRead: boolean;
  createdAt: string;
  link?: string | null;
  metadata?: Record<string, unknown> | null;
}
