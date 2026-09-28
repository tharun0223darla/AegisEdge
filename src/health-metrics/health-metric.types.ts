export const HEALTH_METRIC_TYPES = [
  'BLOOD_PRESSURE',
  'BLOOD_GLUCOSE',
  'HEART_RATE',
  'OXYGEN_SATURATION',
  'SLEEP_HOURS',
] as const;

export type HealthMetricType = (typeof HEALTH_METRIC_TYPES)[number];

export type HealthMetricSource =
  | 'MANUAL'
  | 'BLUETOOTH_SIMULATED'
  | 'BLUETOOTH_REAL'
  | 'SMARTWATCH'
  | 'HEALTH_CONNECT'
  | 'DEVICE_VENDOR'
  | 'UNVERIFIED_DEVICE';

export type HealthMetricQuality =
  | 'USER_REPORTED'
  | 'DEVICE_REPORTED'
  | 'QUESTIONABLE';
export type HealthDeviceTrustLevel = 'UNVERIFIED' | 'SIMULATOR' | 'VERIFIED';

export interface HealthDeviceRecord {
  id: string;
  trustLevel: HealthDeviceTrustLevel;
}
