import { http } from '@/lib/api-client';
import type {
  CreateDoseLogPayload,
  DoseBarrierReason,
  DoseBarrierSummary,
  DoseLog,
  DoseStatus,
} from '@/types/dose-log';

export interface DoseLogFilters {
  scheduleId?: string;
  medicineId?: string;
  status?: DoseStatus | '';
  from?: string;
  to?: string;
  limit?: number;
  page?: number;
}

export interface PaginatedDoseLogs {
  data: DoseLog[];
  meta: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  };
}

export const doseLogsService = {
  list: (filters?: DoseLogFilters) =>
    http.get<PaginatedDoseLogs>('/dose-logs', { params: filters }),

  create: (payload: CreateDoseLogPayload) =>
    http.post<DoseLog, CreateDoseLogPayload>('/dose-logs', payload),

  reconcile: () =>
    http.post<{ markedMissed: number }>('/dose-logs/reconcile', {}),

  barrierSummary: (days = 30) =>
    http.get<DoseBarrierSummary>('/dose-logs/barriers/summary', {
      params: { days },
    }),

  recordBarrier: (doseLogId: string, reason: DoseBarrierReason) =>
    http.patch<DoseLog>(`/dose-logs/${doseLogId}/barrier`, { reason }),

  /** Convenience action used by the "Today" feed. */
  markStatus: (
    scheduleId: string,
    scheduledAt: string,
    status: DoseStatus,
    notes?: string,
  ) =>
    http.post<DoseLog>('/dose-logs', {
      scheduleId,
      scheduledAt,
      status,
      notes,
    }),
};
