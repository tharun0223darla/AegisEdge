import { api } from '@/lib/api-client';
import type {
  AmbulanceTrackingSession,
  EmergencySosPayload,
  Hospital,
  NearbyHospitalsResponse,
  RequestAmbulancePayload,
} from '@/types/emergency';

export const emergencyService = {
  /**
   * Search nearby hospitals and emergency facilities via GPS or coordinates
   */
  async getNearbyHospitals(params: {
    latitude: number;
    longitude: number;
    radius?: number;
    category?: 'all' | 'emergency' | 'hospital' | 'clinic' | 'pharmacy';
  }): Promise<NearbyHospitalsResponse> {
    const res = await api.get('/emergency/hospitals/nearby', { params });
    const payload = res.data?.data ?? res.data;
    return payload;
  },

  /**
   * Dispatch an ambulance request
   */
  async requestAmbulance(
    payload: RequestAmbulancePayload,
  ): Promise<{ success: boolean; message: string; data: AmbulanceTrackingSession }> {
    const res = await api.post('/emergency/ambulance/request', payload);
    const inner = res.data?.data ?? res.data;
    return inner;
  },

  /**
   * Get live ambulance tracking session and telemetry
   */
  async getAmbulanceStatus(
    requestId: string,
  ): Promise<{ success: boolean; data: AmbulanceTrackingSession }> {
    const res = await api.get(`/emergency/ambulance/${requestId}`);
    const inner = res.data?.data ?? res.data;
    return inner;
  },

  /**
   * Cancel an active ambulance request
   */
  async cancelAmbulance(
    requestId: string,
  ): Promise<{ success: boolean; message: string; data: AmbulanceTrackingSession }> {
    const res = await api.post(`/emergency/ambulance/${requestId}/cancel`);
    const inner = res.data?.data ?? res.data;
    return inner;
  },

  /**
   * Trigger one-touch Emergency SOS
   */
  async triggerSos(payload: EmergencySosPayload): Promise<{
    success: boolean;
    sosId: string;
    ambulance: AmbulanceTrackingSession;
    helplines: Record<string, string>;
  }> {
    const res = await api.post('/emergency/sos', payload);
    const inner = res.data?.data ?? res.data;
    return inner;
  },
};
