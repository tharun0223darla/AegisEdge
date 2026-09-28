/** Shared chart palette + helpers so all Recharts components stay visually consistent. */

export const CHART_COLORS = {
  taken: '#22c55e',
  missed: '#ef4444',
  snoozed: '#f59e0b',
  skipped: '#94a3b8',
  rate: '#6366f1',
  grid: 'rgba(148, 163, 184, 0.12)',
  axis: 'rgba(148, 163, 184, 0.6)',
} as const;

export const STATUS_COLORS: Record<string, string> = {
  TAKEN: CHART_COLORS.taken,
  MISSED: CHART_COLORS.missed,
  SNOOZED: CHART_COLORS.snoozed,
  SKIPPED: CHART_COLORS.skipped,
};

export const tooltipStyle = {
  background: 'rgba(17, 24, 39, 0.92)',
  border: '1px solid rgba(148, 163, 184, 0.2)',
  borderRadius: 12,
  fontSize: 12,
  color: '#e5e7eb',
  boxShadow: '0 10px 30px rgba(0,0,0,0.35)',
} as const;

export const axisTick = { fontSize: 11, fill: CHART_COLORS.axis } as const;
