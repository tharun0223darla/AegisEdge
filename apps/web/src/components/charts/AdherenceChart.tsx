import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { ChartCard } from './ChartCard';
import { CHART_COLORS, axisTick, tooltipStyle } from './chart-theme';
import { formatDate } from '@/lib/date';
import type { AdherencePoint } from '@/types/dashboard';

interface AdherenceChartProps {
  data?: AdherencePoint[];
  isLoading?: boolean;
}

/** Adherence rate over time as a smooth area chart. */
export function AdherenceChart({ data, isLoading }: AdherenceChartProps) {
  const points = data ?? [];
  return (
    <ChartCard
      title="Adherence over time"
      description="Daily adherence rate"
      isLoading={isLoading}
      isEmpty={points.length === 0}
    >
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={points} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
          <defs>
            <linearGradient id="adherenceFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={CHART_COLORS.rate} stopOpacity={0.35} />
              <stop offset="100%" stopColor={CHART_COLORS.rate} stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke={CHART_COLORS.grid} vertical={false} />
          <XAxis dataKey="date" tickFormatter={(v) => formatDate(v)} tick={axisTick} tickLine={false} axisLine={false} minTickGap={24} />
          <YAxis domain={[0, 100]} tick={axisTick} tickLine={false} axisLine={false} width={36} unit="%" />
          <Tooltip contentStyle={tooltipStyle} labelFormatter={(v) => formatDate(v as string)} formatter={(val: number) => [`${val}%`, 'Adherence']} />
          <Area type="monotone" dataKey="adherencePercent" stroke={CHART_COLORS.rate} strokeWidth={2} fill="url(#adherenceFill)" />
        </AreaChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}
