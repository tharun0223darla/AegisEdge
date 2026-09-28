import { useEffect, useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Building2,
  Phone,
  Siren,
  Search,
  SlidersHorizontal,
  MapPin,
  RefreshCw,
  LocateFixed,
  Map as MapIcon,
  List as ListIcon,
  ShieldAlert,
  Navigation,
  AlertCircle,
} from 'lucide-react';
import { emergencyService } from '@/services/emergency.service';
import type { Hospital } from '@/types/emergency';
import { HospitalCard } from '@/components/emergency/HospitalCard';
import { EmergencyMap } from '@/components/emergency/EmergencyMap';
import { ROUTES } from '@/constants/app';
import toast from 'react-hot-toast';
import { cn } from '@/lib/utils';

export default function HospitalsPage() {
  const navigate = useNavigate();

  // Location State (Default to Hyderabad / Central coordinate if GPS denied)
  const [latitude, setLatitude] = useState<number>(17.385044);
  const [longitude, setLongitude] = useState<number>(78.486671);
  const [isLocating, setIsLocating] = useState<boolean>(false);
  const [locationName, setLocationName] = useState<string>('Detecting location…');

  // Query & Filter States
  const [radiusKm, setRadiusKm] = useState<number>(15);
  const [category, setCategory] = useState<'all' | 'emergency' | 'hospital' | 'clinic' | 'pharmacy'>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [viewMode, setViewMode] = useState<'split' | 'map' | 'list'>('split');

  // Hospitals Data States
  const [hospitals, setHospitals] = useState<Hospital[]>([]);
  const [selectedHospital, setSelectedHospital] = useState<Hospital | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  // ── 1. Detect User Location via GPS ──────────────────────────
  const detectLocation = () => {
    setIsLocating(true);
    if (!navigator.geolocation) {
      toast.error('Geolocation is not supported by your browser');
      setIsLocating(false);
      setLocationName('Default Coordinates (GPS unavailable)');
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const lat = pos.coords.latitude;
        const lng = pos.coords.longitude;
        setLatitude(lat);
        setLongitude(lng);
        setIsLocating(false);
        setLocationName(`Current GPS (${lat.toFixed(4)}, ${lng.toFixed(4)})`);
        toast.success('Live location acquired');
      },
      (err) => {
        setIsLocating(false);
        setLocationName('Default Coordinates (Location permission denied)');
        console.warn('Geolocation error:', err.message);
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 },
    );
  };

  useEffect(() => {
    detectLocation();
  }, []);

  // ── 2. Fetch Nearby Hospitals from Backend / Overpass ─────────
  const fetchHospitals = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await emergencyService.getNearbyHospitals({
        latitude,
        longitude,
        radius: radiusKm * 1000,
        category,
      });

      const list: Hospital[] = Array.isArray(res)
        ? res
        : Array.isArray((res as any)?.data)
          ? (res as any).data
          : [];

      setHospitals(list);
      if (list.length > 0) {
        setSelectedHospital(list[0]);
      }
    } catch (err: any) {
      console.error('Failed to fetch hospitals:', err);
      setError('Unable to load nearby hospitals. Please check your internet connection.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchHospitals();
  }, [latitude, longitude, radiusKm, category]);

  // Filter by search query
  const filteredHospitals = useMemo(() => {
    if (!searchQuery.trim()) return hospitals;
    const q = searchQuery.toLowerCase();
    return hospitals.filter(
      (h) =>
        h.name.toLowerCase().includes(q) ||
        h.address.toLowerCase().includes(q) ||
        h.type.toLowerCase().includes(q),
    );
  }, [hospitals, searchQuery]);

  // Dispatch Ambulance handler
  const handleRequestAmbulance = (hospital: Hospital) => {
    navigate('/emergency', {
      state: {
        destinationHospital: hospital.name,
        latitude,
        longitude,
        emergencyType: 'Accident / Severe Trauma',
      },
    });
  };

  return (
    <div className="space-y-6">
      {/* ── Top Emergency Speed-Dial Bar ────────────────────────── */}
      <div className="rounded-2xl border border-rose-500/30 bg-gradient-to-r from-rose-950/40 via-red-900/20 to-surface/40 p-4 backdrop-blur-xl">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-rose-500/20 border border-rose-500/40 text-rose-400">
              <Siren className="h-5 w-5 animate-pulse" />
            </div>
            <div>
              <h2 className="text-base font-bold text-text-primary flex items-center gap-2">
                Emergency Response & Ambulance Hotlines
                <span className="inline-flex items-center rounded-md bg-rose-500/20 px-2 py-0.5 text-xs font-semibold text-rose-300">
                  24/7 ACTIVE
                </span>
              </h2>
              <p className="text-xs text-text-secondary">
                Tap to dial emergency services instantly, or trigger an SOS broadcast.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <a
              href="tel:108"
              className="inline-flex items-center gap-1.5 rounded-xl bg-rose-600 px-3.5 py-2 text-xs font-bold text-white shadow-lg shadow-rose-600/30 hover:bg-rose-500 transition-all hover:scale-105"
            >
              <Phone className="h-3.5 w-3.5" /> Call 108 (Ambulance)
            </a>
            <a
              href="tel:112"
              className="inline-flex items-center gap-1.5 rounded-xl bg-surface border border-rose-500/40 px-3.5 py-2 text-xs font-bold text-rose-300 hover:bg-rose-500/20 transition-all"
            >
              <Phone className="h-3.5 w-3.5" /> Call 112 (National SOS)
            </a>
            <button
              type="button"
              onClick={() => navigate('/emergency')}
              className="inline-flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-red-600 to-rose-600 px-4 py-2 text-xs font-black text-white shadow-glow hover:brightness-110 transition-all"
            >
              <ShieldAlert className="h-4 w-4" /> SOS EMERGENCY
            </button>
          </div>
        </div>
      </div>

      {/* ── Main Header & Location Status ──────────────────────── */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-text-primary flex items-center gap-2.5">
            <Building2 className="h-7 w-7 text-brand-400" />
            Nearby Hospitals & Healthcare Finder
          </h1>
          <p className="mt-1 text-sm text-text-secondary">
            Find certified emergency hospitals, trauma centers, ICU facilities, and pharmacies with live distance and directions.
          </p>
        </div>

        {/* Current Location Badge & Refresh */}
        <div className="flex items-center gap-2 self-start md:self-auto">
          <div className="flex items-center gap-2 rounded-xl border border-border bg-surface/70 px-3 py-1.5 text-xs text-text-secondary">
            <MapPin className="h-3.5 w-3.5 text-brand-400 shrink-0" />
            <span className="font-medium truncate max-w-[200px]">{locationName}</span>
          </div>

          <button
            type="button"
            onClick={detectLocation}
            disabled={isLocating}
            className="flex h-9 w-9 items-center justify-center rounded-xl border border-border bg-surface hover:bg-surface-hover text-text-primary transition-colors disabled:opacity-50"
            title="Detect GPS location"
          >
            <LocateFixed className={cn('h-4 w-4 text-brand-400', isLocating && 'animate-spin')} />
          </button>
          <button
            type="button"
            onClick={fetchHospitals}
            disabled={loading}
            className="flex h-9 w-9 items-center justify-center rounded-xl border border-border bg-surface hover:bg-surface-hover text-text-primary transition-colors disabled:opacity-50"
            title="Refresh hospitals list"
          >
            <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin text-brand-400')} />
          </button>
        </div>
      </div>

      {/* ── Search, Filters & View Toggle ──────────────────────── */}
      <div className="rounded-2xl border border-border bg-surface/50 p-4 backdrop-blur-xl space-y-4">
        <div className="flex flex-col lg:flex-row gap-3 items-stretch lg:items-center justify-between">
          {/* Search Bar */}
          <div className="relative flex-1">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-text-muted" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search hospital name, trauma center, locality..."
              className="w-full rounded-xl border border-border bg-surface-elevated/70 pl-10 pr-4 py-2 text-sm text-text-primary placeholder:text-text-muted focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500 transition-all"
            />
          </div>

          {/* Radius Selector */}
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-text-muted uppercase tracking-wider shrink-0">
              Radius:
            </span>
            <div className="flex items-center gap-1 rounded-xl border border-border bg-surface p-1">
              {[5, 10, 15, 25, 50].map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => setRadiusKm(r)}
                  className={cn(
                    'rounded-lg px-2.5 py-1 text-xs font-semibold transition-all',
                    radiusKm === r
                      ? 'bg-brand-500 text-white shadow-sm'
                      : 'text-text-secondary hover:text-text-primary',
                  )}
                >
                  {r}km
                </button>
              ))}
            </div>
          </div>

          {/* View Mode Toggle (Desktop) */}
          <div className="hidden sm:flex items-center gap-1 rounded-xl border border-border bg-surface p-1">
            <button
              type="button"
              onClick={() => setViewMode('split')}
              className={cn(
                'flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-semibold transition-all',
                viewMode === 'split' ? 'bg-brand-500 text-white' : 'text-text-secondary hover:text-text-primary',
              )}
            >
              Split View
            </button>
            <button
              type="button"
              onClick={() => setViewMode('list')}
              className={cn(
                'flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-semibold transition-all',
                viewMode === 'list' ? 'bg-brand-500 text-white' : 'text-text-secondary hover:text-text-primary',
              )}
            >
              <ListIcon className="w-3.5 h-3.5" /> List
            </button>
            <button
              type="button"
              onClick={() => setViewMode('map')}
              className={cn(
                'flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-semibold transition-all',
                viewMode === 'map' ? 'bg-brand-500 text-white' : 'text-text-secondary hover:text-text-primary',
              )}
            >
              <MapIcon className="w-3.5 h-3.5" /> Map
            </button>
          </div>
        </div>

        {/* Category Pills */}
        <div className="flex items-center gap-2 overflow-x-auto pb-1 text-xs font-medium scrollbar-none">
          {[
            { id: 'all', label: 'All Facilities' },
            { id: 'emergency', label: '🚨 24/7 Emergency & Trauma' },
            { id: 'hospital', label: '🏥 Multispecialty Hospitals' },
            { id: 'clinic', label: '🩺 Clinics & PHCs' },
            { id: 'pharmacy', label: '💊 24/7 Pharmacies' },
          ].map((cat) => (
            <button
              key={cat.id}
              type="button"
              onClick={() => setCategory(cat.id as any)}
              className={cn(
                'rounded-xl border px-3.5 py-1.5 transition-all whitespace-nowrap',
                category === cat.id
                  ? 'border-brand-500 bg-brand-500/15 text-brand-300 shadow-sm'
                  : 'border-border bg-surface text-text-secondary hover:border-border-hover hover:text-text-primary',
              )}
            >
              {cat.label}
            </button>
          ))}
        </div>
      </div>

      {/* ── Content Area: Map + List ───────────────────────────── */}
      {error && (
        <div className="rounded-2xl border border-rose-500/30 bg-rose-500/10 p-4 text-xs text-rose-300 flex items-center gap-3">
          <AlertCircle className="w-5 h-5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <div
        className={cn(
          'grid gap-6',
          viewMode === 'split' ? 'lg:grid-cols-12' : 'grid-cols-1',
        )}
      >
        {/* Interactive Map */}
        {(viewMode === 'split' || viewMode === 'map') && (
          <div className={cn(viewMode === 'split' ? 'lg:col-span-6 xl:col-span-7' : 'w-full')}>
            <div className="sticky top-24">
              <EmergencyMap
                userLocation={{ latitude, longitude }}
                hospitals={filteredHospitals}
                selectedHospital={selectedHospital}
                onSelectHospital={(h) => setSelectedHospital(h)}
                searchRadiusKm={radiusKm}
                className="h-[560px] w-full rounded-2xl border border-border shadow-xl overflow-hidden"
              />
              <div className="mt-2 flex items-center justify-between text-xs text-text-muted px-1">
                <span>Showing {filteredHospitals.length} facilities on map</span>
                <span>Click pins for direct call & navigation</span>
              </div>
            </div>
          </div>
        )}

        {/* Hospital Cards List */}
        {(viewMode === 'split' || viewMode === 'list') && (
          <div className={cn(viewMode === 'split' ? 'lg:col-span-6 xl:col-span-5' : 'w-full')}>
            <div className="flex items-center justify-between mb-3 px-1">
              <span className="text-xs font-semibold text-text-muted uppercase tracking-wider">
                {loading ? 'Searching nearby...' : `Found ${filteredHospitals.length} Healthcare Facilities`}
              </span>
              <span className="text-xs text-text-secondary">Sorted by closest distance</span>
            </div>

            {loading ? (
              <div className="space-y-4">
                {[1, 2, 3, 4].map((i) => (
                  <div
                    key={i}
                    className="h-36 rounded-2xl border border-border bg-surface/40 animate-pulse"
                  />
                ))}
              </div>
            ) : filteredHospitals.length === 0 ? (
              <div className="rounded-2xl border border-border bg-surface/50 p-8 text-center backdrop-blur-xl">
                <Building2 className="mx-auto h-12 w-12 text-text-muted/40" />
                <h3 className="mt-3 text-base font-semibold text-text-primary">
                  No facilities found in {radiusKm}km radius
                </h3>
                <p className="mt-1 text-xs text-text-secondary max-w-sm mx-auto">
                  Try expanding the search radius or changing category filters.
                </p>
                <button
                  type="button"
                  onClick={() => setRadiusKm(50)}
                  className="mt-4 rounded-xl bg-brand-500 px-4 py-2 text-xs font-semibold text-white hover:bg-brand-600 transition-colors"
                >
                  Expand Radius to 50 km
                </button>
              </div>
            ) : (
              <div className="space-y-3.5 max-h-[600px] overflow-y-auto pr-1">
                {filteredHospitals.map((hospital) => (
                  <HospitalCard
                    key={hospital.id}
                    hospital={hospital}
                    isSelected={selectedHospital?.id === hospital.id}
                    onSelect={() => setSelectedHospital(hospital)}
                    onRequestAmbulance={handleRequestAmbulance}
                  />
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
