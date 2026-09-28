import { http } from '@/lib/api-client';

export interface DeviceRegistry {
  id: string;
  userId: string;
  deviceName: string;
  deviceId: string;
  deviceType:
    | 'BP_METER'
    | 'GLUCOSE_METER'
    | 'PULSE_OXIMETER'
    | 'SMARTWATCH'
    | 'SMART_CAP';
  trustLevel: 'UNVERIFIED' | 'SIMULATOR' | 'VERIFIED';
  protocol?: string;
  manufacturer?: string;
  model?: string;
  isPaired: boolean;
  lastSyncedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface RegisterDevicePayload {
  deviceName: string;
  deviceId: string;
  deviceType:
    | 'BP_METER'
    | 'GLUCOSE_METER'
    | 'PULSE_OXIMETER'
    | 'SMARTWATCH'
    | 'SMART_CAP';
}

export interface DeviceSyncResponse {
  syncedAt: string;
  deviceType: DeviceRegistry['deviceType'];
  deviceName: string;
  result: unknown;
}

export const devicesService = {
  registerDevice: (payload: RegisterDevicePayload) =>
    http.post<DeviceRegistry, RegisterDevicePayload>('/devices', payload),

  getDevices: () => http.get<DeviceRegistry[]>('/devices'),

  unregisterDevice: (deviceId: string) =>
    http.delete<any>(`/devices/${deviceId}`),

  syncReading: (deviceId: string, value: Record<string, unknown>) =>
    http.post<DeviceSyncResponse, { value: Record<string, unknown> }>(
      `/devices/${deviceId}/sync`,
      { value },
    ),
};
