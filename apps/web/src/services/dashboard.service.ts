import { http } from '@/lib/api-client';
import type {
  AdherencePoint,
  DashboardSummary,
  StatusBreakdown,
} from '@/types/dashboard';

/** Shape returned by GET /dashboard/trends */
interface TrendsResponse {
  days: number;
  dataPoints: number;
  averageAdherencePercent: number;
  progressIndicator: unknown;
  trend: AdherencePoint[];
}

/** Shape returned by GET /dashboard/adherence */
interface AdherenceDashboardResponse {
  summary: unknown;
  adherence: { percent: number; progressIndicator: unknown; disclaimer: string };
  streak: unknown;
  dailyBreakdown: StatusBreakdown[];
  medicines: StatusBreakdown[];
}

export const dashboardService = {
  summary: () => http.get<DashboardSummary>('/dashboard/summary'),

  /** Returns the trend array from /dashboard/trends */
  adherenceTrend: async (days = 14): Promise<AdherencePoint[]> => {
    const res = await http.get<TrendsResponse>('/dashboard/trends', { params: { days } });
    return res?.trend ?? [];
  },

  /** Returns per-medicine breakdown from /dashboard/adherence */
  statusBreakdown: async (): Promise<StatusBreakdown[]> => {
    const res = await http.get<AdherenceDashboardResponse>('/dashboard/adherence');
    return res?.medicines ?? [];
  },
};
