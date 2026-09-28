import React, { useState } from 'react';
import { useBluetooth, useDevices } from '@/hooks/useBluetooth';
import { http } from '@/lib/api-client';

function isFailedSmartCapResult(
  value: unknown,
): value is { success: false; message: string } {
  return (
    typeof value === 'object' &&
    value !== null &&
    'success' in value &&
    value.success === false &&
    'message' in value &&
    typeof value.message === 'string'
  );
}

export const VitalsSimulator: React.FC = () => {
  const { data: devices, refetch: refetchDevices } = useDevices();
  const { syncReading, isSyncing } = useBluetooth();

  const [selectedDevice, setSelectedDevice] = useState<string>('');
  const [deviceType, setDeviceType] = useState<
    'BP_METER' | 'GLUCOSE_METER' | 'PULSE_OXIMETER' | 'SMARTWATCH' | 'SMART_CAP'
  >('BP_METER');
  const [deviceName, setDeviceName] = useState('');

  // Mock data states
  const [systolic, setSystolic] = useState(120);
  const [diastolic, setDiastolic] = useState(80);
  const [glucose, setGlucose] = useState(100);
  const [mealStatus, setMealStatus] = useState<
    'FASTING' | 'POST_MEAL' | 'RANDOM'
  >('RANDOM');
  const [heartRate, setHeartRate] = useState(72);
  const [oxygenSaturation, setOxygenSaturation] = useState(98);
  const [sleepHours, setSleepHours] = useState(8);

  const [syncStatus, setSyncStatus] = useState<string | null>(null);

  const handlePair = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!deviceName) return;
    try {
      const generatedId = `sim-${deviceType.toLowerCase()}-${Math.floor(Math.random() * 1000)}`;
      await http.post('/devices', {
        deviceName,
        deviceId: generatedId,
        deviceType,
      });
      setSyncStatus(`Paired ${deviceName} successfully!`);
      setDeviceName('');
      refetchDevices();
    } catch {
      setSyncStatus('Failed to pair simulated device.');
    }
  };

  const handleSync = async () => {
    if (!selectedDevice) {
      setSyncStatus('Please select a paired device first.');
      return;
    }

    const device = devices?.find((d) => d.deviceId === selectedDevice);
    if (!device) return;

    let payload: Record<string, unknown> = {};

    switch (device.deviceType) {
      case 'BP_METER':
        payload = { systolic, diastolic };
        break;
      case 'GLUCOSE_METER':
        payload = { glucose, mealStatus };
        break;
      case 'PULSE_OXIMETER':
        payload = { oxygenSaturation };
        break;
      case 'SMARTWATCH':
        payload = { heartRate, sleepHours };
        break;
      case 'SMART_CAP':
        payload = { status: 'OPEN' };
        break;
    }

    try {
      setSyncStatus('Syncing telemetry data...');
      const res = await syncReading({
        deviceId: device.deviceId,
        value: payload,
      });

      if (
        device.deviceType === 'SMART_CAP' &&
        isFailedSmartCapResult(res.result)
      ) {
        setSyncStatus(`⚠️ Sync alert: ${res.result.message}`);
      } else {
        setSyncStatus(`✅ Successfully synced data for ${device.deviceName}!`);
      }
    } catch (err: any) {
      setSyncStatus(`❌ Sync failed: ${err.message || 'Unknown error'}`);
    }
  };

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-2xl text-slate-100">
      <h3 className="text-xl font-bold mb-4 flex items-center gap-2 text-indigo-400">
        🔌 BLE Vitals & IoT Simulator
      </h3>
      <p className="text-slate-400 text-sm mb-6">
        Simulate Bluetooth connection and GATT telemetry syncing for blood
        pressure, blood glucose, smart watches, and medicine caps.
      </p>

      {/* Pairing Module */}
      <form
        onSubmit={handlePair}
        className="mb-6 bg-slate-950 p-4 rounded-xl border border-slate-850"
      >
        <h4 className="text-sm font-semibold mb-3 text-slate-300">
          Pair New Simulated Device
        </h4>
        <div className="flex flex-wrap gap-3 mb-3">
          <input
            type="text"
            placeholder="Device Name (e.g. My BP Cuff)"
            value={deviceName}
            onChange={(e) => setDeviceName(e.target.value)}
            className="bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-indigo-500 flex-1"
          />
          <select
            value={deviceType}
            onChange={(e) => setDeviceType(e.target.value as any)}
            className="bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-sm text-slate-300 focus:outline-none"
          >
            <option value="BP_METER">BP Meter</option>
            <option value="GLUCOSE_METER">Sugar Meter</option>
            <option value="PULSE_OXIMETER">Pulse Oximeter</option>
            <option value="SMARTWATCH">Smart Watch</option>
            <option value="SMART_CAP">Smart Pill Cap</option>
          </select>
          <button
            type="submit"
            className="bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg px-4 py-2 text-sm font-medium transition"
          >
            Pair
          </button>
        </div>
      </form>

      {/* Sync Module */}
      <div className="bg-slate-950 p-4 rounded-xl border border-slate-850">
        <h4 className="text-sm font-semibold mb-3 text-slate-300">
          Sync Telemetry Data
        </h4>
        <div className="mb-4">
          <label className="block text-xs text-slate-400 mb-1">
            Select Connected Device
          </label>
          <select
            value={selectedDevice}
            onChange={(e) => setSelectedDevice(e.target.value)}
            className="w-full bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none"
          >
            <option value="">-- No Device Selected --</option>
            {devices?.map((d) => (
              <option key={d.deviceId} value={d.deviceId}>
                {d.deviceName} ({d.deviceType.replace('_', ' ')})
              </option>
            ))}
          </select>
        </div>

        {/* Dynamic Inputs Based on Chosen Device */}
        {selectedDevice && (
          <div className="space-y-3 mb-4 border-t border-slate-850 pt-3">
            {devices?.find((d) => d.deviceId === selectedDevice)?.deviceType ===
              'BP_METER' && (
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-slate-400 mb-1">
                    Systolic (mmHg)
                  </label>
                  <input
                    type="number"
                    value={systolic}
                    onChange={(e) => setSystolic(Number(e.target.value))}
                    className="w-full bg-slate-900 border border-slate-800 rounded-lg px-3 py-1.5 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs text-slate-400 mb-1">
                    Diastolic (mmHg)
                  </label>
                  <input
                    type="number"
                    value={diastolic}
                    onChange={(e) => setDiastolic(Number(e.target.value))}
                    className="w-full bg-slate-900 border border-slate-800 rounded-lg px-3 py-1.5 text-sm"
                  />
                </div>
              </div>
            )}

            {devices?.find((d) => d.deviceId === selectedDevice)?.deviceType ===
              'GLUCOSE_METER' && (
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-slate-400 mb-1">
                    Glucose (mg/dL)
                  </label>
                  <input
                    type="number"
                    value={glucose}
                    onChange={(e) => setGlucose(Number(e.target.value))}
                    className="w-full bg-slate-900 border border-slate-800 rounded-lg px-3 py-1.5 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs text-slate-400 mb-1">
                    Meal Status
                  </label>
                  <select
                    value={mealStatus}
                    onChange={(e) => setMealStatus(e.target.value as any)}
                    className="w-full bg-slate-900 border border-slate-800 rounded-lg px-3 py-1.5 text-sm"
                  >
                    <option value="RANDOM">Random</option>
                    <option value="FASTING">Fasting</option>
                    <option value="POST_MEAL">Post Meal</option>
                  </select>
                </div>
              </div>
            )}

            {devices?.find((d) => d.deviceId === selectedDevice)?.deviceType ===
              'PULSE_OXIMETER' && (
              <div>
                <label className="block text-xs text-slate-400 mb-1">
                  Oxygen saturation (%)
                </label>
                <input
                  type="number"
                  min="1"
                  max="100"
                  value={oxygenSaturation}
                  onChange={(e) => setOxygenSaturation(Number(e.target.value))}
                  className="w-full bg-slate-900 border border-slate-800 rounded-lg px-3 py-1.5 text-sm"
                />
              </div>
            )}

            {devices?.find((d) => d.deviceId === selectedDevice)?.deviceType ===
              'SMARTWATCH' && (
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-slate-400 mb-1">
                    Heart Rate (bpm)
                  </label>
                  <input
                    type="number"
                    value={heartRate}
                    onChange={(e) => setHeartRate(Number(e.target.value))}
                    className="w-full bg-slate-900 border border-slate-800 rounded-lg px-3 py-1.5 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs text-slate-400 mb-1">
                    Sleep Hours
                  </label>
                  <input
                    type="number"
                    value={sleepHours}
                    onChange={(e) => setSleepHours(Number(e.target.value))}
                    className="w-full bg-slate-900 border border-slate-800 rounded-lg px-3 py-1.5 text-sm"
                  />
                </div>
              </div>
            )}

            {devices?.find((d) => d.deviceId === selectedDevice)?.deviceType ===
              'SMART_CAP' && (
              <div className="p-3 bg-indigo-950/40 rounded-lg border border-indigo-900/30 text-xs text-indigo-200">
                🚀 Simulating Cap Opening will automatically mark the closest
                pending schedule due today as **TAKEN** and update inventory.
              </div>
            )}

            <button
              onClick={handleSync}
              disabled={isSyncing}
              className="w-full mt-3 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg py-2 text-sm font-semibold transition disabled:opacity-50"
            >
              {isSyncing ? 'Syncing...' : 'Sync Telemetry Vitals'}
            </button>
          </div>
        )}
      </div>

      {syncStatus && (
        <div className="mt-4 p-3 bg-slate-950 rounded-lg border border-slate-800 text-sm text-slate-300">
          {syncStatus}
        </div>
      )}
    </div>
  );
};
