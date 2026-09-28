import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { ChartCard } from './ChartCard';
import { CHART_COLORS, axisTick, tooltipStyle } from './chart-theme';
import { formatDate } from '@/lib/date';
import type { AdherencePoint } from '@/types/dashboard';

interface WeeklyChartProps {
  data?: AdherencePoint[];
  isLoading?: boolean;
}

/** Taken vs missed for the most recent 7 data points. */
export function WeeklyChart({ data, isLoading }: WeeklyChartProps) {
  const points = (data ?? []).slice(-7);
  return (
    <ChartCard
      title="This week"
      description="Taken vs missed (last 7 days)"
      isLoading={isLoading}
      isEmpty={points.length === 0}
    >
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={points} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
          <CartesianGrid stroke={CHART_COLORS.grid} vertical={false} />
          <XAxis dataKey="date" tickFormatter={(v) => formatDate(v)} tick={axisTick} tickLine={false} axisLine={false} />
          <YAxis allowDecimals={false} tick={axisTick} tickLine={false} axisLine={false} width={28} />
          <Tooltip contentStyle={tooltipStyle} labelFormatter={(v) => formatDate(v as string)} cursor={{ fill: 'rgba(148,163,184,0.08)' }} />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <Bar dataKey="taken" name="Taken" fill={CHART_COLORS.taken} radius={[4, 4, 0, 0]} maxBarSize={28} />
          <Bar dataKey="missed" name="Missed" fill={CHART_COLORS.missed} radius={[4, 4, 0, 0]} maxBarSize={28} />
        </BarChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}
