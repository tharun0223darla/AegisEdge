import { Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';
import { ChartCard } from './ChartCard';
import { STATUS_COLORS, tooltipStyle } from './chart-theme';
import type { StatusBreakdown } from '@/types/dashboard';

interface MedicineAnalyticsChartProps {
  data?: StatusBreakdown[];
  isLoading?: boolean;
}

const STATUS_LABEL: Record<string, string> = {
  TAKEN: 'Taken',
  MISSED: 'Missed',
  SNOOZED: 'Snoozed',
  SKIPPED: 'Skipped',
};

/** Distribution of dose outcomes as a donut chart. */
export function MedicineAnalyticsChart({ data, isLoading }: MedicineAnalyticsChartProps) {
  const totals = (data ?? []).reduce(
    (acc, curr) => {
      acc.TAKEN += curr.taken ?? 0;
      acc.MISSED += curr.missed ?? 0;
      acc.SNOOZED += curr.snoozed ?? 0;
      acc.SKIPPED += curr.skipped ?? 0;
      return acc;
    },
    { TAKEN: 0, MISSED: 0, SNOOZED: 0, SKIPPED: 0 }
  );

  const breakdown = [
    { status: 'TAKEN', count: totals.TAKEN },
    { status: 'MISSED', count: totals.MISSED },
    { status: 'SNOOZED', count: totals.SNOOZED },
    { status: 'SKIPPED', count: totals.SKIPPED },
  ].filter((d) => d.count > 0);
  return (
    <ChartCard
      title="Dose outcomes"
      description="Distribution by status"
      isLoading={isLoading}
      isEmpty={breakdown.length === 0}
    >
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie
            data={breakdown}
            dataKey="count"
            nameKey="status"
            innerRadius={60}
            outerRadius={95}
            paddingAngle={2}
            stroke="none"
          >
            {breakdown.map((entry) => (
              <Cell key={entry.status} fill={STATUS_COLORS[entry.status] ?? '#94a3b8'} />
            ))}
          </Pie>
          <Tooltip contentStyle={tooltipStyle} formatter={(val: number, name: string) => [val, STATUS_LABEL[name] ?? name]} />
          <Legend wrapperStyle={{ fontSize: 12 }} formatter={(value) => STATUS_LABEL[value as string] ?? value} />
        </PieChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}
