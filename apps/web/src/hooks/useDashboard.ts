import { useQuery } from '@tanstack/react-query';
import { dashboardService } from '@/services/dashboard.service';
import { notificationsService } from '@/services/notifications.service';
import { medicinesService } from '@/services/medicines.service';

/**
 * Centralised query hooks for the dashboard/analytics surface.
 * Keys are colocated so cache invalidation stays consistent.
 */
export const dashboardKeys = {
  all: ['dashboard'] as const,
  summary: () => [...dashboardKeys.all, 'summary'] as const,
  adherence: (days: number) => [...dashboardKeys.all, 'adherence', days] as const,
  statusBreakdown: () => [...dashboardKeys.all, 'status-breakdown'] as const,
};

export function useDashboardSummary() {
  return useQuery({
    queryKey: dashboardKeys.summary(),
    queryFn: () => dashboardService.summary(),
    staleTime: 60_000,
  });
}

export function useAdherenceTrend(days = 14) {
  return useQuery({
    queryKey: dashboardKeys.adherence(days),
    queryFn: () => dashboardService.adherenceTrend(days),
    staleTime: 60_000,
  });
}

export function useStatusBreakdown() {
  return useQuery({
    queryKey: dashboardKeys.statusBreakdown(),
    queryFn: () => dashboardService.statusBreakdown(),
    staleTime: 60_000,
  });
}

export function useRecentNotifications(limit = 5) {
  return useQuery({
    queryKey: ['notifications', 'recent', limit],
    queryFn: () => notificationsService.list({ limit }),
    staleTime: 30_000,
  });
}

/** Medicines whose stock is at or below their refill threshold. */
export function useLowStockMedicines() {
  return useQuery({
    queryKey: ['medicines', 'low-stock'],
    queryFn: () => medicinesService.list({ activeOnly: true }),
    staleTime: 60_000,
    select: (meds) =>
      meds.filter(
        (m) =>
          m.refillThreshold != null && m.stockQuantity <= (m.refillThreshold ?? 0),
      ),
  });
}
