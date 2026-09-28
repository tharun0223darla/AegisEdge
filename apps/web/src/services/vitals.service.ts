import { http } from '@/lib/api-client';

export interface HealthMetric {
  id: string;
  userId: string;
  metricType:
    | 'BLOOD_PRESSURE'
    | 'BLOOD_GLUCOSE'
    | 'HEART_RATE'
    | 'OXYGEN_SATURATION'
    | 'SLEEP_HOURS';
  value: Record<string, unknown>;
  unit: string;
  recordedAt: string;
  receivedAt: string;
  source:
    | 'MANUAL'
    | 'BLUETOOTH_SIMULATED'
    | 'BLUETOOTH_REAL'
    | 'SMARTWATCH'
    | 'HEALTH_CONNECT'
    | 'DEVICE_VENDOR'
    | 'UNVERIFIED_DEVICE';
  quality: 'USER_REPORTED' | 'DEVICE_REPORTED' | 'QUESTIONABLE';
  qualityFlags: string[];
  safetyAssessment?: Record<string, unknown>;
  createdAt: string;
}

export interface CreateHealthMetricPayload {
  metricType:
    | 'BLOOD_PRESSURE'
    | 'BLOOD_GLUCOSE'
    | 'HEART_RATE'
    | 'OXYGEN_SATURATION'
    | 'SLEEP_HOURS';
  value: Record<string, unknown>;
  recordedAt: string;
  unit?: string;
  clientRecordId?: string;
  timezoneOffsetMinutes?: number;
}

export type HealthMetricType = CreateHealthMetricPayload['metricType'];

export interface HealthMetricTrendPoint {
  date: string;
  count: number;
  questionableCount: number;
  average?: number;
  minimum?: number;
  maximum?: number;
  systolicAverage?: number;
  diastolicAverage?: number;
}

export interface HealthMetricTrend {
  metricType: HealthMetricType;
  days: number;
  qualityScope: 'ALL' | 'TRUSTED_ONLY';
  unit: string;
  totalReadings: number;
  questionableReadings: number;
  direction: 'RISING' | 'FALLING' | 'STABLE' | 'INSUFFICIENT_DATA';
  truncated: boolean;
  points: HealthMetricTrendPoint[];
}

export interface TestAlarmPayload {
  scenario:
    | 'SPO2_CRASH'
    | 'HYPERTENSION'
    | 'TACHYCARDIA'
    | 'GLUCOSE_CRASH'
    | 'FALL_IMPACT'
    | 'NEWS2_CRITICAL';
  value?: number;
  notes?: string;
}

export interface TestAlarmResult {
  success: boolean;
  scenario: string;
  patientName: string;
  parameterDesc: string;
  caregiversNotified: Array<{
    id: string;
    name: string;
    email: string;
    phone?: string | null;
  }>;
  message: string;
}

export interface DismissAlarmPayload {
  scenario: string;
  reason?: string;
}

export const vitalsService = {
  addReading: (payload: CreateHealthMetricPayload) =>
    http.post<HealthMetric, CreateHealthMetricPayload>(
      '/health-metrics',
      payload,
    ),

  getReadings: (type?: string, limit?: number) => {
    const params = new URLSearchParams();
    if (type) params.append('type', type);
    if (limit) params.append('limit', String(limit));
    return http.get<HealthMetric[]>(`/health-metrics?${params.toString()}`);
  },

  getTrend: (
    type: HealthMetricType,
    days: number,
    qualityScope: 'ALL' | 'TRUSTED_ONLY' = 'ALL',
  ) =>
    http.get<HealthMetricTrend>(
      `/health-metrics/trends?type=${encodeURIComponent(type)}&days=${days}` +
        `&quality=${qualityScope}`,
    ),

  testAlarm: (payload: TestAlarmPayload) =>
    http.post<TestAlarmResult, TestAlarmPayload>(
      '/health-metrics/test-alarm',
      payload,
    ),

  dismissAlarm: (payload: DismissAlarmPayload) =>
    http.post<{ success: boolean; message: string }, DismissAlarmPayload>(
      '/health-metrics/dismiss-alarm',
      payload,
    ),
};
