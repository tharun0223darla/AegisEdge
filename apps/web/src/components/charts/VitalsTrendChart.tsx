import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { ChartCard } from './ChartCard';
import { CHART_COLORS, axisTick, tooltipStyle } from './chart-theme';
import { formatDate } from '@/lib/date';
import type {
  HealthMetricTrend,
  HealthMetricType,
} from '@/services/vitals.service';

const LABELS: Record<HealthMetricType, string> = {
  BLOOD_PRESSURE: 'Blood pressure',
  BLOOD_GLUCOSE: 'Blood glucose',
  HEART_RATE: 'Heart rate',
  OXYGEN_SATURATION: 'Oxygen saturation',
  SLEEP_HOURS: 'Sleep',
};

interface VitalsTrendChartProps {
  data?: HealthMetricTrend;
  isLoading?: boolean;
}

export function VitalsTrendChart({ data, isLoading }: VitalsTrendChartProps) {
  const points = data?.points ?? [];
  const direction = data?.direction
    ? data.direction === 'INSUFFICIENT_DATA'
      ? 'More days are needed for a direction'
      : `Direction: ${data.direction.toLowerCase()}`
    : undefined;
  const quality = data?.questionableReadings
    ? `${data.questionableReadings} unverified reading${data.questionableReadings === 1 ? '' : 's'}`
    : 'No unverified readings';

  return (
    <ChartCard
      title={data ? `${LABELS[data.metricType]} trend` : 'Vital trend'}
      description={
        data
          ? `${direction}. ${quality}. Values are descriptive, not a diagnosis.`
          : undefined
      }
      isLoading={isLoading}
      isEmpty={points.length === 0}
      emptyLabel="No readings in this date range"
      height={300}
    >
      <ResponsiveContainer width="100%" height="100%">
        <LineChart
          data={points}
          margin={{ top: 8, right: 12, left: -8, bottom: 0 }}
        >
          <CartesianGrid stroke={CHART_COLORS.grid} vertical={false} />
          <XAxis
            dataKey="date"
            tickFormatter={(value) => formatDate(value)}
            tick={axisTick}
            tickLine={false}
            axisLine={false}
            minTickGap={24}
          />
          <YAxis
            tick={axisTick}
            tickLine={false}
            axisLine={false}
            width={48}
            unit={data?.unit}
          />
          <Tooltip
            contentStyle={tooltipStyle}
            labelFormatter={(value) => formatDate(value as string)}
          />
          {data?.metricType === 'BLOOD_PRESSURE' ? (
            <>
              <Line
                type="monotone"
                dataKey="systolicAverage"
                name="Systolic"
                stroke="#ef4444"
                strokeWidth={2}
                dot={false}
              />
              <Line
                type="monotone"
                dataKey="diastolicAverage"
                name="Diastolic"
                stroke="#38bdf8"
                strokeWidth={2}
                dot={false}
              />
            </>
          ) : (
            <Line
              type="monotone"
              dataKey="average"
              name="Daily average"
              stroke={CHART_COLORS.rate}
              strokeWidth={2}
              dot={false}
            />
          )}
        </LineChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}
