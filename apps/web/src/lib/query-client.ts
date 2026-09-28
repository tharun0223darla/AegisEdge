import { QueryClient } from '@tanstack/react-query';
import axios from 'axios';

/**
 * Global TanStack Query client with sane defaults:
 * - Don't refetch on window focus (mobile annoyance).
 * - Retry once for transient failures, never for 4xx auth/validation.
 * - Reasonable staleness so dashboards feel snappy without hammering the API.
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: 5 * 60_000,
      refetchOnWindowFocus: false,
      retry: (failureCount, error) => {
        if (axios.isAxiosError(error)) {
          const status = error.response?.status ?? 0;
          if (status >= 400 && status < 500) return false;
        }
        return failureCount < 1;
      },
    },
    mutations: {
      retry: false,
    },
  },
});

/** Strongly-typed query key factory — co-located here so it stays canonical. */
export const queryKeys = {
  auth: {
    me: ['auth', 'me'] as const,
  },
  medicines: {
    all: ['medicines'] as const,
    list: (filters?: Record<string, unknown>) => ['medicines', 'list', filters ?? {}] as const,
    detail: (id: string) => ['medicines', 'detail', id] as const,
  },
  schedules: {
    all: ['schedules'] as const,
    list: (filters?: Record<string, unknown>) => ['schedules', 'list', filters ?? {}] as const,
    today: ['schedules', 'today'] as const,
    detail: (id: string) => ['schedules', 'detail', id] as const,
  },
  doseLogs: {
    all: ['dose-logs'] as const,
    list: (filters?: Record<string, unknown>) => ['dose-logs', 'list', filters ?? {}] as const,
  },
  dashboard: {
    summary: ['dashboard', 'summary'] as const,
    adherence: (days: number) => ['dashboard', 'adherence', days] as const,
    breakdown: ['dashboard', 'breakdown'] as const,
  },
  notifications: {
    all: ['notifications'] as const,
    unreadCount: ['notifications', 'unread-count'] as const,
  },
  prescriptions: {
    all: ['prescriptions'] as const,
    detail: (id: string) => ['prescriptions', 'detail', id] as const,
  },
  bills: {
    all: ['bills'] as const,
    detail: (id: string) => ['bills', 'detail', id] as const,
  },
  refills: {
    stock: ['refills', 'stock'] as const,
    history: ['refills', 'history'] as const,
  },
} as const;
