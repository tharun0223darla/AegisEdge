import type { MobileReminderPlan } from './mobile-reminder';

export type Frequency =
  | 'DAILY'
  | 'TWICE_DAILY'
  | 'THREE_TIMES_DAILY'
  | 'FOUR_TIMES_DAILY'
  | 'WEEKLY'
  | 'AS_NEEDED'
  | 'CUSTOM';

export interface Schedule {
  id: string;
  medicineId: string;
  medicine?: {
    id: string;
    name: string;
    form: string;
    strength?: string | null;
  };
  frequency: Frequency;
  /** "HH:mm" strings in 24-hour format. */
  timesOfDay: string[];
  daysOfWeek?: number[] | null;
  startDate: string;
  endDate?: string | null;
  dosesPerIntake: number;
  unit: string;
  timezone: string;
  notes?: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  reminderPlan?: MobileReminderPlan;
}

export interface CreateSchedulePayload {
  medicineId: string;
  frequency: Frequency;
  timesOfDay: string[];
  daysOfWeek?: number[];
  startDate: string;
  endDate?: string;
  dosesPerIntake?: number;
  unit?: string;
  notes?: string;
  isActive?: boolean;
  timezone?: string;
}

export type UpdateSchedulePayload = Partial<CreateSchedulePayload>;

export type TodayDose = import('./dose-log').DoseLog;
