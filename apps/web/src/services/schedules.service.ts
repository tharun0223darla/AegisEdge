import { http } from '@/lib/api-client';
import type {
  CreateSchedulePayload,
  Schedule,
  TodayDose,
  UpdateSchedulePayload,
} from '@/types/schedule';

export interface ScheduleListFilters {
  medicineId?: string;
  isActive?: boolean;
}

/** Shape returned by the paginated backend endpoint GET /schedules */
interface PaginatedSchedules {
  data: Schedule[];
  meta: { total: number; page: number; limit: number; totalPages: number };
}

export const schedulesService = {
  /** Returns flat Schedule[] by extracting the paginated data.data field. */
  list: async (filters?: ScheduleListFilters): Promise<Schedule[]> => {
    const result = await http.get<PaginatedSchedules>('/schedules', { params: filters });
    return result?.data ?? [];
  },

  get: (id: string) => http.get<Schedule>(`/schedules/${id}`),

  today: () =>
    http.get<TodayDose[]>('/schedules/today', {
      params: {
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
      },
    }),

  create: (payload: CreateSchedulePayload) =>
    http.post<Schedule, CreateSchedulePayload>('/schedules', {
      ...payload,
      timezone:
        payload.timezone ??
        Intl.DateTimeFormat().resolvedOptions().timeZone ??
        'UTC',
    }),

  update: (id: string, payload: UpdateSchedulePayload) =>
    http.patch<Schedule, UpdateSchedulePayload>(`/schedules/${id}`, payload),

  remove: (id: string) => http.delete<{ success: true }>(`/schedules/${id}`),

  toggleActive: (id: string, isActive: boolean) =>
    http.patch<Schedule>(`/schedules/${id}`, { isActive }),
};
