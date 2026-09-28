export interface MobileReminderItem {
  id: number;
  scheduleId: string;
  doseLogId: string;
  medicineId: string;
  medicineName: string;
  dosage: string;
  scheduledAt: string;
  doseScheduledAt: string;
  kind: 'PRIMARY' | 'FOLLOW_UP';
  title: string;
  body: string;
  actionUrl: string;
}

export interface MobileReminderPlan {
  generatedAt: string;
  horizonDays: number;
  reminders: MobileReminderItem[];
}

export type LocalReminderSyncMode =
  | 'native'
  | 'browser-tab'
  | 'denied'
  | 'unsupported';

export interface LocalReminderSyncResult {
  mode: LocalReminderSyncMode;
  scheduledCount: number;
  warning?: string;
}
