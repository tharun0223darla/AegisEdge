export interface Hospital {
  id: string;
  name: string;
  address: string;
  latitude: number;
  longitude: number;
  distance_km: number;
  distance: string;
  phone?: string;
  emergency?: string;
  emergency_available: boolean;
  type: 'hospital' | 'clinic' | 'trauma_center' | 'pharmacy';
  icu_available?: boolean;
  ambulance_available?: boolean;
  rating?: number;
  opening_hours?: string;
  website?: string;
  map_url: string;
  directions_url: string;
  source: 'OpenStreetMap' | 'CuratedDirectory';
}

export interface NearbyHospitalsResponse {
  success: boolean;
  count: number;
  searchRadiusKm: number;
  userLocation: {
    latitude: number;
    longitude: number;
  };
  data: Hospital[];
  source: string;
}

export type DispatchStatus =
  | 'REQUESTED'
  | 'DISPATCHED'
  | 'ON_THE_WAY'
  | 'ARRIVED'
  | 'TRANSPORTING'
  | 'COMPLETED'
  | 'CANCELLED';

export interface AmbulanceTrackingSession {
  requestId: string;
  patientId?: string;
  status: DispatchStatus;
  emergencyType: string;
  notes?: string;
  destinationHospital?: string;
  patientLocation: {
    latitude: number;
    longitude: number;
    address?: string;
  };
  startLocation: {
    latitude: number;
    longitude: number;
  };
  currentLocation: {
    latitude: number;
    longitude: number;
  };
  driver: {
    name: string;
    phone: string;
    vehicleNumber: string;
    vehicleModel: string;
    avatarUrl?: string;
  };
  speedKmH: number;
  etaMinutes: number;
  distanceKmRemaining: number;
  createdAt: number;
  updatedAt: number;
  routePolyline?: [number, number][];
}

export interface RequestAmbulancePayload {
  latitude: number;
  longitude: number;
  address?: string;
  emergencyType?: string;
  notes?: string;
  destinationHospital?: string;
  contactPhone?: string;
}

export interface EmergencySosPayload {
  latitude: number;
  longitude: number;
  emergencyType?: string;
  symptoms?: string[];
  severity?: 'critical' | 'urgent' | 'standard';
}
