import { useEffect } from 'react';
import {
  MapContainer,
  TileLayer,
  Marker,
  Popup,
  Circle,
  Polyline,
  useMap,
} from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type { Hospital, AmbulanceTrackingSession } from '@/types/emergency';
import { Phone, Navigation, ExternalLink } from 'lucide-react';

// ── Custom DivIcons for Leaflet ───────────────────────────────

const userLocationIcon = L.divIcon({
  className: 'custom-user-marker',
  html: `
    <div style="position: relative; display: flex; align-items: center; justify-content: center; width: 36px; height: 36px;">
      <div style="position: absolute; inset: 0; border-radius: 9999px; background-color: rgba(59, 130, 246, 0.4); animation: ping 1.5s cubic-bezier(0, 0, 0.2, 1) infinite;"></div>
      <div style="position: relative; width: 28px; height: 28px; border-radius: 9999px; background: #2563eb; border: 3px solid white; display: flex; align-items: center; justify-content: center; box-shadow: 0 4px 12px rgba(37,99,235,0.5); color: white; font-size: 14px;">
        📍
      </div>
    </div>
  `,
  iconSize: [36, 36],
  iconAnchor: [18, 18],
  popupAnchor: [0, -18],
});

const ambulanceLiveIcon = L.divIcon({
  className: 'custom-ambulance-marker',
  html: `
    <div style="position: relative; display: flex; align-items: center; justify-content: center; width: 50px; height: 50px;">
      <div style="position: absolute; inset: 0; border-radius: 9999px; background-color: rgba(239, 68, 68, 0.4); animation: ping 1.2s cubic-bezier(0, 0, 0.2, 1) infinite;"></div>
      <div style="position: relative; width: 44px; height: 44px; border-radius: 9999px; background: #ef4444; border: 3px solid #ffffff; display: flex; align-items: center; justify-content: center; box-shadow: 0 6px 18px rgba(239,68,68,0.6); font-size: 22px;">
        🚑
      </div>
    </div>
  `,
  iconSize: [50, 50],
  iconAnchor: [25, 25],
  popupAnchor: [0, -25],
});

const hospitalIcon = L.divIcon({
  className: 'custom-hospital-marker',
  html: `
    <div style="width: 32px; height: 32px; border-radius: 8px; background: #059669; border: 2px solid white; display: flex; align-items: center; justify-content: center; box-shadow: 0 4px 10px rgba(5,150,105,0.4); font-size: 16px;">
      🏥
    </div>
  `,
  iconSize: [32, 32],
  iconAnchor: [16, 16],
  popupAnchor: [0, -16],
});

const emergencyHospitalIcon = L.divIcon({
  className: 'custom-emg-hospital-marker',
  html: `
    <div style="position: relative; width: 36px; height: 36px; border-radius: 10px; background: #dc2626; border: 2.5px solid white; display: flex; align-items: center; justify-content: center; box-shadow: 0 4px 14px rgba(220,38,38,0.5); font-size: 18px;">
      🚨
    </div>
  `,
  iconSize: [36, 36],
  iconAnchor: [18, 18],
  popupAnchor: [0, -18],
});

function MapRecenter({ center }: { center: [number, number] }) {
  const map = useMap();
  useEffect(() => {
    map.flyTo(center, map.getZoom(), { duration: 1.2 });
  }, [center, map]);
  return null;
}

interface EmergencyMapProps {
  userLocation: { latitude: number; longitude: number };
  hospitals?: Hospital[];
  selectedHospital?: Hospital | null;
  onSelectHospital?: (hospital: Hospital) => void;
  ambulanceSession?: AmbulanceTrackingSession | null;
  searchRadiusKm?: number;
  className?: string;
}

export function EmergencyMap({
  userLocation,
  hospitals = [],
  selectedHospital,
  onSelectHospital,
  ambulanceSession,
  searchRadiusKm,
  className = 'h-[500px] w-full rounded-2xl overflow-hidden border border-border shadow-xl',
}: EmergencyMapProps) {
  const center: [number, number] = ambulanceSession?.currentLocation
    ? [ambulanceSession.currentLocation.latitude, ambulanceSession.currentLocation.longitude]
    : selectedHospital
      ? [selectedHospital.latitude, selectedHospital.longitude]
      : [userLocation.latitude, userLocation.longitude];

  // Route points if ambulance tracking is active
  const routePoints: [number, number][] = ambulanceSession
    ? [
        [ambulanceSession.currentLocation.latitude, ambulanceSession.currentLocation.longitude],
        [ambulanceSession.patientLocation.latitude, ambulanceSession.patientLocation.longitude],
      ]
    : [];

  return (
    <div className={className}>
      <MapContainer
        center={center}
        zoom={ambulanceSession ? 14 : 13}
        scrollWheelZoom={true}
        className="h-full w-full"
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />

        <MapRecenter center={center} />

        {/* User / Patient Pin */}
        <Marker
          position={[userLocation.latitude, userLocation.longitude]}
          icon={userLocationIcon}
        >
          <Popup className="emergency-map-popup">
            <div className="p-1 font-sans text-xs">
              <div className="font-bold text-blue-600">📍 Your Location (Patient)</div>
              <div className="text-gray-500 mt-0.5">
                {ambulanceSession?.patientLocation.address || 'Live GPS Coordinates'}
              </div>
            </div>
          </Popup>
        </Marker>

        {/* Search Radius Circle if Hospitals mode */}
        {searchRadiusKm && !ambulanceSession && (
          <Circle
            center={[userLocation.latitude, userLocation.longitude]}
            radius={searchRadiusKm * 1000}
            pathOptions={{
              color: '#3b82f6',
              fillColor: '#3b82f6',
              fillOpacity: 0.05,
              weight: 1.5,
              dashArray: '4 4',
            }}
          />
        )}

        {/* Live Moving Ambulance Marker & Polyline */}
        {ambulanceSession && (
          <>
            <Marker
              position={[
                ambulanceSession.currentLocation.latitude,
                ambulanceSession.currentLocation.longitude,
              ]}
              icon={ambulanceLiveIcon}
            >
              <Popup>
                <div className="p-1 text-xs">
                  <div className="font-bold text-red-600 flex items-center gap-1">
                    🚑 {ambulanceSession.driver.vehicleNumber}
                  </div>
                  <div className="text-gray-600 mt-0.5">
                    Driver: {ambulanceSession.driver.name}
                  </div>
                  <div className="text-gray-600">
                    Speed: {ambulanceSession.speedKmH} km/h • ETA: {ambulanceSession.etaMinutes} min
                  </div>
                </div>
              </Popup>
            </Marker>

            {/* Connecting Polyline Route */}
            <Polyline
              positions={routePoints}
              pathOptions={{
                color: '#ef4444',
                weight: 4,
                dashArray: '8 8',
                opacity: 0.85,
              }}
            />
          </>
        )}

        {/* Hospital Markers */}
        {hospitals.map((hosp) => {
          const isSelected = selectedHospital?.id === hosp.id;
          return (
            <Marker
              key={hosp.id}
              position={[hosp.latitude, hosp.longitude]}
              icon={hosp.emergency_available ? emergencyHospitalIcon : hospitalIcon}
              eventHandlers={{
                click: () => onSelectHospital?.(hosp),
              }}
            >
              <Popup>
                <div className="p-1.5 max-w-[220px] font-sans">
                  <div className="font-bold text-sm text-gray-900 leading-tight">
                    {hosp.name}
                  </div>
                  <div className="text-xs text-gray-500 mt-1">{hosp.address}</div>
                  <div className="mt-2 flex items-center justify-between text-xs font-medium">
                    <span className="text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded">
                      {hosp.distance}
                    </span>
                    {hosp.emergency_available && (
                      <span className="text-red-700 bg-red-50 px-1.5 py-0.5 rounded font-bold">
                        24/7 Emergency
                      </span>
                    )}
                  </div>
                  <div className="mt-3 flex gap-2">
                    {hosp.phone && (
                      <a
                        href={`tel:${hosp.phone}`}
                        className="flex-1 flex items-center justify-center gap-1 bg-emerald-600 text-white rounded px-2 py-1 text-xs font-semibold hover:bg-emerald-700 no-underline"
                      >
                        <Phone className="w-3 h-3" /> Call
                      </a>
                    )}
                    <a
                      href={hosp.directions_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex-1 flex items-center justify-center gap-1 bg-blue-600 text-white rounded px-2 py-1 text-xs font-semibold hover:bg-blue-700 no-underline"
                    >
                      <Navigation className="w-3 h-3" /> Directions
                    </a>
                  </div>
                </div>
              </Popup>
            </Marker>
          );
        })}
      </MapContainer>
    </div>
  );
}
