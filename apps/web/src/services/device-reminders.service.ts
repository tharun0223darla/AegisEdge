import { http } from '@/lib/api-client';
import type { MobileReminderPlan } from '@/types/mobile-reminder';

export const deviceRemindersService = {
  getPlan: (days = 14) => http.get<MobileReminderPlan>('/schedules/mobile-reminders', { params: { days } }),
};