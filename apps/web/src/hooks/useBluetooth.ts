import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  devicesService,
  RegisterDevicePayload,
} from '@/services/devices.service';

export function useDevices() {
  return useQuery({
    queryKey: ['devices', 'list'],
    queryFn: () => devicesService.getDevices(),
  });
}

export function useBluetooth() {
  const queryClient = useQueryClient();
  const [isScanning, setIsScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const registerMutation = useMutation({
    mutationFn: (payload: RegisterDevicePayload) =>
      devicesService.registerDevice(payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['devices', 'list'] });
    },
  });

  const unregisterMutation = useMutation({
    mutationFn: (deviceId: string) => devicesService.unregisterDevice(deviceId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['devices', 'list'] });
    },
  });

  const syncMutation = useMutation({
    mutationFn: ({
      deviceId,
      value,
    }: {
      deviceId: string;
      value: Record<string, unknown>;
    }) => devicesService.syncReading(deviceId, value),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['devices', 'list'] });
      queryClient.invalidateQueries({ queryKey: ['vitals', 'list'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    },
  });

  const scanAndConnect = async (
    deviceType:
      | 'BP_METER'
      | 'GLUCOSE_METER'
      | 'PULSE_OXIMETER'
      | 'SMARTWATCH'
      | 'SMART_CAP',
  ) => {
    setIsScanning(true);
    setError(null);
    try {
      if (!(navigator as any).bluetooth) {
        throw new Error(
          'Web Bluetooth is not supported in this browser. Try Chrome/Edge or use the Simulator.',
        );
      }

      // Configure BLE scan filters based on device type
      const optionalServices = ['battery_service'];
      let namePrefix = 'MediTrack';

      if (deviceType === 'SMARTWATCH') {
        optionalServices.push('heart_rate');
        namePrefix = 'SmartBand';
      } else if (deviceType === 'BP_METER') {
        optionalServices.push('blood_pressure');
        namePrefix = 'BP-Monitor';
      } else if (deviceType === 'PULSE_OXIMETER') {
        optionalServices.push('pulse_oximeter');
        namePrefix = 'PulseOx';
      }

      const device = await (navigator as any).bluetooth.requestDevice({
        filters: [{ namePrefix }],
        optionalServices,
      });

      // Register the paired device in the database
      await registerMutation.mutateAsync({
        deviceName: device.name || `${deviceType} BLE Device`,
        deviceId: device.id,
        deviceType,
      });

      return device;
    } catch (err: any) {
      console.error(err);
      setError(err.message || 'Bluetooth connection cancelled.');
      throw err;
    } finally {
      setIsScanning(false);
    }
  };

  return {
    scanAndConnect,
    unregisterDevice: unregisterMutation.mutateAsync,
    syncReading: syncMutation.mutateAsync,
    isScanning,
    isSyncing: syncMutation.isPending,
    isUnpairing: unregisterMutation.isPending,
    error,
  };
}
