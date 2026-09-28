import { useState } from 'react';
import { PageHeader } from '@/components/shared/PageHeader';
import { Select } from '@/components/ui/Select';
import {
  AdherenceChart,
  WeeklyChart,
  MonthlyChart,
  DoseTrendChart,
  MedicineAnalyticsChart,
  VitalsTrendChart,
} from '@/components/charts';
import { useAdherenceTrend, useStatusBreakdown } from '@/hooks/useDashboard';
import { useVitalTrend } from '@/hooks/useVitals';
import type { HealthMetricType } from '@/services/vitals.service';

const RANGE_OPTIONS = [
  { value: '7', label: 'Last 7 days' },
  { value: '14', label: 'Last 14 days' },
  { value: '30', label: 'Last 30 days' },
];

const VITAL_OPTIONS = [
  { value: 'BLOOD_PRESSURE', label: 'Blood pressure' },
  { value: 'BLOOD_GLUCOSE', label: 'Blood glucose' },
  { value: 'HEART_RATE', label: 'Heart rate' },
  { value: 'OXYGEN_SATURATION', label: 'Oxygen saturation' },
  { value: 'SLEEP_HOURS', label: 'Sleep' },
];

export default function AnalyticsPage() {
  const [days, setDays] = useState(14);
  const [vitalType, setVitalType] = useState<HealthMetricType>('HEART_RATE');
  const trend = useAdherenceTrend(days);
  const breakdown = useStatusBreakdown();
  const vitalTrend = useVitalTrend(vitalType, days);

  return (
    <div>
      <PageHeader
        title="Analytics"
        description="Track your adherence trends and dose outcomes."
        actions={
          <Select
            aria-label="Date range"
            options={RANGE_OPTIONS}
            value={String(days)}
            onChange={(e) => setDays(Number(e.target.value))}
            className="max-w-[160px]"
          />
        }
      />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="lg:col-span-2 space-y-3">
          <div className="flex justify-end">
            <Select
              aria-label="Vital type"
              options={VITAL_OPTIONS}
              value={vitalType}
              onChange={(event) =>
                setVitalType(event.target.value as HealthMetricType)
              }
              className="max-w-[200px]"
            />
          </div>
          <VitalsTrendChart
            data={vitalTrend.data}
            isLoading={vitalTrend.isLoading}
          />
        </div>
        <div className="lg:col-span-2">
          <AdherenceChart data={trend.data} isLoading={trend.isLoading} />
        </div>
        <WeeklyChart data={trend.data} isLoading={trend.isLoading} />
        <MonthlyChart data={trend.data} isLoading={trend.isLoading} />
        <DoseTrendChart data={trend.data} isLoading={trend.isLoading} />
        <MedicineAnalyticsChart
          data={breakdown.data}
          isLoading={breakdown.isLoading}
        />
      </div>
    </div>
  );
}
