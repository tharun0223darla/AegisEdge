import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  vitalsService,
  CreateHealthMetricPayload,
  type HealthMetricType,
} from '@/services/vitals.service';

export function useVitals(type?: string, limit = 50) {
  return useQuery({
    queryKey: ['vitals', 'list', type, limit],
    queryFn: () => vitalsService.getReadings(type, limit),
  });
}

export function useAddVital() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: CreateHealthMetricPayload) =>
      vitalsService.addReading(payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['vitals', 'list'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    },
  });
}

export function useVitalTrend(type: HealthMetricType, days: number) {
  return useQuery({
    queryKey: ['vitals', 'trend', type, days],
    queryFn: () => vitalsService.getTrend(type, days),
  });
}
