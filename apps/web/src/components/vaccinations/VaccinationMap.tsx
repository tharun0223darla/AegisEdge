import { useEffect } from 'react';
import {
  MapContainer,
  TileLayer,
  Marker,
  Popup,
  Circle,
  useMap,
} from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type { VaccinationCenter } from '@/types/vaccination';
import { Phone, Navigation, ExternalLink, ShieldCheck, Clock } from 'lucide-react';

// ── Custom DivIcons for Leaflet ───────────────────────────────

const userLocationIcon = L.divIcon({
  className: 'custom-user-marker',
  html: `
    <div style="position: relative; display: flex; align-items: center; justify-content: center; width: 36px; height: 36px;">
      <div style="position: absolute; inset: 0; border-radius: 9999px; background-color: rgba(99, 102, 241, 0.4); animation: ping 1.5s cubic-bezier(0, 0, 0.2, 1) infinite;"></div>
      <div style="position: relative; width: 28px; height: 28px; border-radius: 9999px; background: #6366f1; border: 3px solid white; display: flex; align-items: center; justify-content: center; box-shadow: 0 4px 12px rgba(99,102,241,0.5); color: white; font-size: 14px;">
        📍
      </div>
    </div>
  `,
  iconSize: [36, 36],
  iconAnchor: [18, 18],
  popupAnchor: [0, -18],
});

const govtPhcIcon = L.divIcon({
  className: 'custom-govt-phc-marker',
  html: `
    <div style="position: relative; width: 34px; height: 34px; border-radius: 10px; background: #059669; border: 2.5px solid white; display: flex; align-items: center; justify-content: center; box-shadow: 0 4px 14px rgba(5,150,105,0.4); font-size: 16px;">
      🏛️
    </div>
  `,
  iconSize: [34, 34],
  iconAnchor: [17, 17],
  popupAnchor: [0, -17],
});

const pediatricIcon = L.divIcon({
  className: 'custom-pediatric-marker',
  html: `
    <div style="position: relative; width: 34px; height: 34px; border-radius: 10px; background: #8b5cf6; border: 2.5px solid white; display: flex; align-items: center; justify-content: center; box-shadow: 0 4px 14px rgba(139,92,246,0.4); font-size: 16px;">
      👶
    </div>
  `,
  iconSize: [34, 34],
  iconAnchor: [17, 17],
  popupAnchor: [0, -17],
});

const privateHospitalIcon = L.divIcon({
  className: 'custom-private-hosp-marker',
  html: `
    <div style="position: relative; width: 34px; height: 34px; border-radius: 10px; background: #0284c7; border: 2.5px solid white; display: flex; align-items: center; justify-content: center; box-shadow: 0 4px 14px rgba(2,132,199,0.4); font-size: 16px;">
      🏥
    </div>
  `,
  iconSize: [34, 34],
  iconAnchor: [17, 17],
  popupAnchor: [0, -17],
});

function MapRecenter({ center }: { center: [number, number] }) {
  const map = useMap();
  useEffect(() => {
    map.flyTo(center, map.getZoom(), { duration: 1.2 });
  }, [center, map]);
  return null;
}

interface VaccinationMapProps {
  userLocation: [number, number];
  centers: VaccinationCenter[];
  selectedCenter?: VaccinationCenter | null;
  onSelectCenter?: (center: VaccinationCenter) => void;
  onBookCenter?: (center: VaccinationCenter) => void;
  radiusMeters?: number;
}

export function VaccinationMap({
  userLocation,
  centers,
  selectedCenter,
  onSelectCenter,
  onBookCenter,
  radiusMeters = 25000,
}: VaccinationMapProps) {
  const centerCoord: [number, number] = selectedCenter
    ? [selectedCenter.latitude, selectedCenter.longitude]
    : userLocation;

  return (
    <div className="relative w-full h-[520px] rounded-2xl overflow-hidden border border-border shadow-xl z-0">
      <MapContainer
        center={centerCoord}
        zoom={13}
        scrollWheelZoom={true}
        className="w-full h-full"
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />

        <MapRecenter center={centerCoord} />

        {/* User Location Marker */}
        <Marker position={userLocation} icon={userLocationIcon}>
          <Popup>
            <div className="p-1 text-xs">
              <span className="font-bold text-slate-800">Your Location</span>
              <p className="text-slate-500">Searching vaccination centers around you</p>
            </div>
          </Popup>
        </Marker>

        {/* Radius Search Circle */}
        <Circle
          center={userLocation}
          radius={Math.min(radiusMeters, 15000)}
          pathOptions={{
            color: '#6366f1',
            fillColor: '#6366f1',
            fillOpacity: 0.05,
            weight: 1.5,
            dashArray: '4, 8',
          }}
        />

        {/* Vaccination Center Markers */}
        {centers.map((center) => {
          const icon =
            center.type === 'GOVERNMENT_PHC'
              ? govtPhcIcon
              : center.type === 'PEDIATRIC_CLINIC'
                ? pediatricIcon
                : privateHospitalIcon;

          return (
            <Marker
              key={center.id}
              position={[center.latitude, center.longitude]}
              icon={icon}
              eventHandlers={{
                click: () => onSelectCenter && onSelectCenter(center),
              }}
            >
              <Popup className="custom-leaflet-popup">
                <div className="p-2.5 min-w-[240px] max-w-[280px]">
                  <div className="flex items-start justify-between gap-2">
                    <h4 className="font-bold text-sm text-slate-900 leading-tight">
                      {center.name}
                    </h4>
                    {center.isGovtFreeUip ? (
                      <span className="shrink-0 bg-emerald-100 text-emerald-800 text-[10px] font-black px-2 py-0.5 rounded-full uppercase">
                        Govt Free
                      </span>
                    ) : (
                      <span className="shrink-0 bg-blue-100 text-blue-800 text-[10px] font-bold px-2 py-0.5 rounded-full uppercase">
                        Private
                      </span>
                    )}
                  </div>

                  <p className="text-xs text-slate-600 mt-1 line-clamp-2">
                    {center.address}
                  </p>

                  <div className="mt-2 flex items-center justify-between text-xs text-slate-500">
                    <span className="font-bold text-indigo-600 flex items-center gap-1">
                      <Navigation className="w-3 h-3" /> {center.distanceText || `${center.distanceKm} km`}
                    </span>
                    <span className="flex items-center gap-1">
                      ⭐ {center.rating.toFixed(1)} ({center.reviewsCount})
                    </span>
                  </div>

                  <div className="mt-2.5 flex items-center gap-1.5 flex-wrap">
                    {center.vaccinesAvailable.slice(0, 3).map((v, i) => (
                      <span
                        key={i}
                        className="bg-slate-100 text-slate-700 text-[10px] px-1.5 py-0.5 rounded"
                      >
                        {v}
                      </span>
                    ))}
                    {center.vaccinesAvailable.length > 3 && (
                      <span className="text-[10px] text-slate-400">
                        +{center.vaccinesAvailable.length - 3} more
                      </span>
                    )}
                  </div>

                  <div className="mt-3 pt-2 border-t border-slate-200 flex items-center gap-2">
                    <a
                      href={center.directionsUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex-1 inline-flex items-center justify-center gap-1 bg-indigo-600 text-white rounded-lg px-2.5 py-1.5 text-xs font-semibold hover:bg-indigo-700 transition"
                    >
                      <Navigation className="w-3 h-3" /> Directions
                    </a>
                    {onBookCenter && (
                      <button
                        type="button"
                        onClick={() => onBookCenter(center)}
                        className="flex-1 bg-slate-900 text-white rounded-lg px-2.5 py-1.5 text-xs font-semibold hover:bg-slate-800 transition"
                      >
                        Book Slot
                      </button>
                    )}
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
