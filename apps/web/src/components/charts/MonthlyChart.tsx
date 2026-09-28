import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { ChartCard } from './ChartCard';
import { CHART_COLORS, axisTick, tooltipStyle } from './chart-theme';
import type { AdherencePoint } from '@/types/dashboard';

interface MonthlyChartProps {
  data?: AdherencePoint[];
  isLoading?: boolean;
}

interface WeekBucket {
  label: string;
  adherencePercent: number;
}

/** Aggregates daily adherence points into weekly buckets for a monthly view. */
function toWeeklyBuckets(points: AdherencePoint[]): WeekBucket[] {
  const buckets: WeekBucket[] = [];
  for (let i = 0; i < points.length; i += 7) {
    const chunk = points.slice(i, i + 7);
    if (chunk.length === 0) continue;
    const avg = chunk.reduce((sum, p) => sum + p.adherencePercent, 0) / chunk.length;
    buckets.push({ label: `Wk ${buckets.length + 1}`, adherencePercent: Math.round(avg) });
  }
  return buckets;
}

export function MonthlyChart({ data, isLoading }: MonthlyChartProps) {
  const buckets = toWeeklyBuckets(data ?? []);
  return (
    <ChartCard
      title="Monthly overview"
      description="Average adherence per week"
      isLoading={isLoading}
      isEmpty={buckets.length === 0}
    >
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={buckets} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
          <CartesianGrid stroke={CHART_COLORS.grid} vertical={false} />
          <XAxis dataKey="label" tick={axisTick} tickLine={false} axisLine={false} />
          <YAxis domain={[0, 100]} tick={axisTick} tickLine={false} axisLine={false} width={32} unit="%" />
          <Tooltip contentStyle={tooltipStyle} formatter={(val: number) => [`${val}%`, 'Adherence']} cursor={{ fill: 'rgba(148,163,184,0.08)' }} />
          <Bar dataKey="adherencePercent" name="Adherence" fill={CHART_COLORS.rate} radius={[4, 4, 0, 0]} maxBarSize={40} />
        </BarChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}
