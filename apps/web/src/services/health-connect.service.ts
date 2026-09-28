import { Capacitor, registerPlugin } from '@capacitor/core';
import { http } from '@/lib/api-client';

export type HealthConnectMetricType =
  | 'BLOOD_PRESSURE'
  | 'BLOOD_GLUCOSE'
  | 'HEART_RATE'
  | 'OXYGEN_SATURATION';

export type WearableIntegrationState =
  | 'HEALTH_CONNECT_AVAILABLE'
  | 'HEALTH_CONNECT_NO_RECORDS'
  | 'STANDARD_BLE_SUPPORTED'
  | 'PROPRIETARY_WATCH_UNSUPPORTED'
  | 'MANUAL_ENTRY_REQUIRED';

export interface HealthConnectBuildIdentity {
  versionName: string;
  versionCode: number;
  commitSha: string;
  dirty: boolean;
}

export interface HealthConnectMetricDiagnostics {
  metricType: HealthConnectMetricType;
  permissionGranted: boolean;
  sourceRecordCount: number;
  outputRecordCount: number;
  pageCount: number;
  originCount: number;
  truncated: boolean;
  stopReason?: string;
  errorCode?: string;
}

export interface WearableDiagnostics {
  route: 'HEALTH_CONNECT' | 'STANDARD_BLE' | 'UNSUPPORTED' | 'MANUAL';
  healthConnectRecordCount: number;
  deniedTypeCount: number;
  failedMetricCount: number;
  pageCount: number;
  success: boolean;
  durationMs: number;
  unsupportedReason?: string;
  metrics: HealthConnectMetricDiagnostics[];
  build?: HealthConnectBuildIdentity;
}

export interface HealthConnectStatus {
  availability: 'AVAILABLE' | 'UPDATE_REQUIRED' | 'UNAVAILABLE';
  permissions: {
    heartRate: boolean;
    oxygenSaturation: boolean;
    bloodPressure: boolean;
    bloodGlucose: boolean;
  };
  allGranted: boolean;
  build?: HealthConnectBuildIdentity;
}

interface HealthConnectRecord {
  metricType: HealthConnectMetricType;
  value: Record<string, unknown>;
  recordedAt: string;
  unit: string;
  clientRecordId: string;
  originPackage: string;
  timezoneOffsetMinutes?: number;
}

interface HealthConnectReadResult {
  records: HealthConnectRecord[];
  deniedTypes: HealthConnectMetricType[];
  lookbackHours: number;
  truncated: boolean;
  integrationState: WearableIntegrationState;
  metricDiagnostics: HealthConnectMetricDiagnostics[];
  diagnostics: WearableDiagnostics;
}

interface HealthConnectPlugin {
  getStatus(): Promise<HealthConnectStatus>;
  requestReadPermissions(): Promise<HealthConnectStatus>;
  openSettings(): Promise<void>;
  readRecords(options: {
    lookbackHours: number;
  }): Promise<HealthConnectReadResult>;
}

interface ImportBatchResult {
  received: number;
  imported: number;
  duplicates: number;
  rejected: number;
  results: Array<{
    clientRecordId: string;
    status: 'IMPORTED' | 'DUPLICATE' | 'REJECTED';
    metricId?: string;
    reason?: string;
  }>;
}

export interface HealthConnectSyncResult {
  read: number;
  imported: number;
  duplicates: number;
  rejected: number;
  deniedTypes: HealthConnectMetricType[];
  truncated: boolean;
  metricDiagnostics: HealthConnectMetricDiagnostics[];
  integrationState: WearableIntegrationState;
  diagnostics: WearableDiagnostics;
}

const HealthConnect = registerPlugin<HealthConnectPlugin>('HealthConnect');
const IMPORT_BATCH_SIZE = 200;

const emptyStatus = (): HealthConnectStatus => ({
  availability: 'UNAVAILABLE',
  permissions: {
    heartRate: false,
    oxygenSaturation: false,
    bloodPressure: false,
    bloodGlucose: false,
  },
  allGranted: false,
});

const fallbackMetricDiagnostics = (
  deniedTypes: HealthConnectMetricType[],
): HealthConnectMetricDiagnostics[] =>
  (
    [
      'HEART_RATE',
      'OXYGEN_SATURATION',
      'BLOOD_PRESSURE',
      'BLOOD_GLUCOSE',
    ] as const
  ).map((metricType) => ({
    metricType,
    permissionGranted: !deniedTypes.includes(metricType),
    sourceRecordCount: 0,
    outputRecordCount: 0,
    pageCount: 0,
    originCount: 0,
    truncated: false,
  }));

export const healthConnectService = {
  isSupported: () =>
    Capacitor.isNativePlatform() &&
    Capacitor.getPlatform() === 'android' &&
    Capacitor.isPluginAvailable('HealthConnect'),

  getStatus: async () => {
    if (!healthConnectService.isSupported()) return emptyStatus();
    return HealthConnect.getStatus();
  },

  requestReadPermissions: () => HealthConnect.requestReadPermissions(),

  openSettings: () => HealthConnect.openSettings(),

  sync: async (lookbackHours = 24): Promise<HealthConnectSyncResult> => {
    const readResult = await HealthConnect.readRecords({ lookbackHours });
    const integrationState =
      readResult.integrationState ??
      (readResult.records.length > 0
        ? 'HEALTH_CONNECT_AVAILABLE'
        : 'HEALTH_CONNECT_NO_RECORDS');
    const metricDiagnostics =
      readResult.metricDiagnostics ??
      readResult.diagnostics?.metrics ??
      fallbackMetricDiagnostics(readResult.deniedTypes);
    const diagnostics = readResult.diagnostics ?? {
      route: 'HEALTH_CONNECT',
      healthConnectRecordCount: readResult.records.length,
      deniedTypeCount: readResult.deniedTypes.length,
      failedMetricCount: 0,
      pageCount: 0,
      success: true,
      durationMs: 0,
      unsupportedReason:
        readResult.records.length === 0
          ? 'HEALTH_CONNECT_RETURNED_ZERO_RECORDS'
          : undefined,
      metrics: metricDiagnostics,
    };
    const summary: HealthConnectSyncResult = {
      read: readResult.records.length,
      imported: 0,
      duplicates: 0,
      rejected: 0,
      deniedTypes: readResult.deniedTypes,
      truncated: readResult.truncated,
      metricDiagnostics,
      integrationState,
      diagnostics,
    };

    for (
      let offset = 0;
      offset < readResult.records.length;
      offset += IMPORT_BATCH_SIZE
    ) {
      const records = readResult.records.slice(
        offset,
        offset + IMPORT_BATCH_SIZE,
      );
      const batch = await http.post<
        ImportBatchResult,
        { records: HealthConnectRecord[] }
      >('/health-metrics/health-connect/import', { records });
      summary.imported += batch.imported;
      summary.duplicates += batch.duplicates;
      summary.rejected += batch.rejected;
    }

    return summary;
  },
};
