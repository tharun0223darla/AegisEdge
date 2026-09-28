import {
  CartesianGrid,
  Line,
  LineChart,
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

interface DoseTrendChartProps {
  data?: AdherencePoint[];
  isLoading?: boolean;
}

/** Taken vs missed counts as trend lines. */
export function DoseTrendChart({ data, isLoading }: DoseTrendChartProps) {
  const points = data ?? [];
  return (
    <ChartCard
      title="Dose trend"
      description="Taken and missed doses over time"
      isLoading={isLoading}
      isEmpty={points.length === 0}
    >
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={points} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
          <CartesianGrid stroke={CHART_COLORS.grid} vertical={false} />
          <XAxis dataKey="date" tickFormatter={(v) => formatDate(v)} tick={axisTick} tickLine={false} axisLine={false} minTickGap={24} />
          <YAxis allowDecimals={false} tick={axisTick} tickLine={false} axisLine={false} width={28} />
          <Tooltip contentStyle={tooltipStyle} labelFormatter={(v) => formatDate(v as string)} />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <Line type="monotone" dataKey="taken" name="Taken" stroke={CHART_COLORS.taken} strokeWidth={2} dot={false} />
          <Line type="monotone" dataKey="missed" name="Missed" stroke={CHART_COLORS.missed} strokeWidth={2} dot={false} />
        </LineChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}
