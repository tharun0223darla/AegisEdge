import { useState, useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  Siren,
  Phone,
  AlertTriangle,
  HeartPulse,
  Activity,
  Baby,
  Wind,
  Flame,
  HelpCircle,
  MapPin,
  CheckCircle2,
  Navigation,
  ShieldCheck,
  ArrowRight,
  Sparkles,
} from 'lucide-react';
import { emergencyService } from '@/services/emergency.service';
import { useAuthStore } from '@/store/auth.store';
import { AutonomousSosSimulatorModal } from '@/components/emergency/AutonomousSosSimulatorModal';
import toast from 'react-hot-toast';
import { cn } from '@/lib/utils';

export default function EmergencySOSPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const user = useAuthStore((state) => state.user);

  const routerState = location.state as {
    destinationHospital?: string;
    latitude?: number;
    longitude?: number;
    emergencyType?: string;
  } | null;

  // Form & Telemetry States
  const [latitude, setLatitude] = useState<number>(routerState?.latitude || 17.385044);
  const [longitude, setLongitude] = useState<number>(routerState?.longitude || 78.486671);
  const [address, setAddress] = useState<string>('');
  const [selectedType, setSelectedType] = useState<string>(
    routerState?.emergencyType || 'Cardiac / Chest Pain',
  );
  const [selectedSymptoms, setSelectedSymptoms] = useState<string[]>([]);
  const [notes, setNotes] = useState<string>('');
  const [destinationHospital, setDestinationHospital] = useState<string>(
    routerState?.destinationHospital || 'Nearest Trauma Center (Auto-Assigned)',
  );
  const [contactPhone, setContactPhone] = useState<string>('');

  const [loading, setLoading] = useState<boolean>(false);
  const [isLocating, setIsLocating] = useState<boolean>(false);
  const [simModalOpen, setSimModalOpen] = useState<boolean>(false);

  // Detect GPS
  useEffect(() => {
    if (!routerState?.latitude && navigator.geolocation) {
      setIsLocating(true);
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          setLatitude(pos.coords.latitude);
          setLongitude(pos.coords.longitude);
          setIsLocating(false);
        },
        () => setIsLocating(false),
        { enableHighAccuracy: true, timeout: 8000 },
      );
    }
  }, [routerState]);

  const emergencyCategories = [
    {
      id: 'Cardiac / Chest Pain',
      label: 'Cardiac / Heart Emergency',
      icon: HeartPulse,
      color: 'rose',
      severity: 'critical',
      desc: 'Severe chest tightness, radiating pain, sudden collapse',
    },
    {
      id: 'Accident / Severe Trauma',
      label: 'Accident & Severe Trauma',
      icon: AlertTriangle,
      color: 'red',
      severity: 'critical',
      desc: 'Road crash, heavy bleeding, suspected fractures, head injury',
    },
    {
      id: 'Pregnancy / Labor',
      label: 'Pregnancy & Maternity',
      icon: Baby,
      color: 'pink',
      severity: 'urgent',
      desc: 'Active labor pains, rupture, delivery complications',
    },
    {
      id: 'Respiratory Distress',
      label: 'Severe Breathing Trouble',
      icon: Wind,
      color: 'blue',
      severity: 'critical',
      desc: 'Acute asthma attack, asphyxiation, choking',
    },
    {
      id: 'Stroke / Neurological',
      label: 'Stroke / Loss of Consciousness',
      icon: Activity,
      color: 'purple',
      severity: 'critical',
      desc: 'Facial drooping, arm weakness, speech slurring',
    },
    {
      id: 'Poisoning / Burn / Other',
      label: 'Burn, Poisoning & General',
      icon: Flame,
      color: 'amber',
      severity: 'urgent',
      desc: 'Chemical burns, ingestion, acute abdominal pain',
    },
  ];

  const symptomOptions = [
    'Unconscious / Unresponsive',
    'Severe Bleeding',
    'Chest Pain / Radiating Arm Pain',
    'Difficulty Breathing / Gasping',
    'Severe Fracture / Dislocation',
    'High Fever with Convulsions',
    'Sudden Paralysis / Numbness',
    'Heavy Allergic Shock (Anaphylaxis)',
  ];

  const toggleSymptom = (sym: string) => {
    setSelectedSymptoms((prev) =>
      prev.includes(sym) ? prev.filter((s) => s !== sym) : [...prev, sym],
    );
  };

  // Submit Ambulance Request
  const handleDispatch = async () => {
    setLoading(true);
    try {
      const res = await emergencyService.requestAmbulance({
        latitude,
        longitude,
        address: address.trim() || undefined,
        emergencyType: selectedType,
        notes: [
          selectedSymptoms.length > 0 ? `Symptoms: ${selectedSymptoms.join(', ')}` : '',
          notes.trim(),
        ]
          .filter(Boolean)
          .join(' | '),
        destinationHospital: destinationHospital || undefined,
        contactPhone: contactPhone.trim() || undefined,
      });

      if (res && res.data?.requestId) {
        toast.success('Ambulance dispatched! Redirecting to live tracking...');
        navigate(`/ambulance-tracking/${res.data.requestId}`);
      } else {
        throw new Error(res.message || 'Failed to dispatch ambulance');
      }
    } catch (err: any) {
      console.error('Ambulance dispatch error:', err);
      toast.error(err.response?.data?.message || 'Failed to dispatch ambulance. Dialing 108 is advised.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* ── Emergency Siren Banner ─────────────────────────────── */}
      <div className="relative overflow-hidden rounded-3xl border border-rose-500/40 bg-gradient-to-br from-rose-950/80 via-red-900/30 to-surface/80 p-6 md:p-8 backdrop-blur-2xl shadow-2xl">
        <div className="absolute top-0 right-0 -mr-16 -mt-16 h-64 w-64 rounded-full bg-rose-500/10 blur-3xl pointer-events-none" />

        <div className="relative flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
          <div className="space-y-2">
            <div className="inline-flex items-center gap-2 rounded-full bg-rose-500/20 border border-rose-500/40 px-3 py-1 text-xs font-black uppercase tracking-widest text-rose-300">
              <Siren className="w-3.5 h-3.5 animate-pulse text-rose-400" />
              Emergency SOS Hub
            </div>
            <h1 className="text-2xl md:text-3xl font-black text-white tracking-tight">
              Request Emergency Ambulance
            </h1>
            <p className="text-sm text-text-secondary max-w-xl">
              Instant GPS-coordinated paramedic dispatch with real-time live route tracking, driver contact, and automated Care Circle alerts.
            </p>
          </div>

          <div className="flex flex-col sm:flex-row gap-3 w-full md:w-auto">
            <a
              href="tel:108"
              className="inline-flex items-center justify-center gap-2 rounded-2xl bg-rose-600 px-6 py-3.5 text-sm font-black text-white shadow-xl shadow-rose-600/40 hover:bg-rose-500 transition-all hover:scale-105 active:scale-95"
            >
              <Phone className="w-4 h-4" /> 📞 Call 108 (Free)
            </a>
            <a
              href="tel:112"
              className="inline-flex items-center justify-center gap-2 rounded-2xl bg-surface border border-rose-500/40 px-5 py-3.5 text-sm font-bold text-rose-300 hover:bg-rose-500/20 transition-all"
            >
              <Phone className="w-4 h-4" /> 112 National SOS
            </a>
          </div>
        </div>
      </div>

      {/* ── Autonomous Zero-Click Liveness Switch Demo Card ─────────── */}
      <div className="rounded-2xl border border-amber-500/30 bg-gradient-to-r from-amber-950/40 via-surface/80 to-surface/60 p-4 backdrop-blur-xl shadow-lg flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-500/20 border border-amber-500/40 text-amber-400">
            <Sparkles className="h-5 w-5 animate-pulse" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-sm font-bold text-text-primary">
                Autonomous Zero-Click Emergency & 30s Liveness Switch
              </span>
              <span className="rounded-md bg-amber-500/20 border border-amber-500/30 px-1.5 py-0.5 text-[10px] font-black uppercase text-amber-300">
                RPM Feature
              </span>
            </div>
            <p className="text-xs text-text-secondary">
              Protects solitary or unconscious patients. Simulates automated vital breach (SpO2 &lt; 80% or Fall), 30s audio countdown, and auto-dispatch.
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={() => setSimModalOpen(true)}
          className="w-full sm:w-auto inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-amber-600 to-rose-600 px-4 py-2.5 text-xs font-black uppercase tracking-wider text-white shadow-lg hover:brightness-110 active:scale-95 transition-all"
        >
          <Siren className="w-3.5 h-3.5" /> Test 0-Click SOS (Judge Demo)
        </button>
      </div>

      <AutonomousSosSimulatorModal
        open={simModalOpen}
        onClose={() => setSimModalOpen(false)}
      />

      {/* ── Main Dispatch Form ─────────────────────────────────── */}
      <div className="grid md:grid-cols-12 gap-6">
        {/* Left Column: Form Details */}
        <div className="md:col-span-8 space-y-6">
          {/* Step 1: Emergency Type Selection */}
          <div className="rounded-2xl border border-border bg-surface/60 p-6 backdrop-blur-xl space-y-4">
            <h2 className="text-base font-bold text-text-primary flex items-center gap-2">
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-brand-500/20 text-xs font-bold text-brand-300">
                1
              </span>
              Select Emergency Category
            </h2>

            <div className="grid sm:grid-cols-2 gap-3">
              {emergencyCategories.map((cat) => {
                const Icon = cat.icon;
                const isSelected = selectedType === cat.id;
                return (
                  <button
                    key={cat.id}
                    type="button"
                    onClick={() => setSelectedType(cat.id)}
                    className={cn(
                      'flex items-start gap-3 rounded-xl border p-3.5 text-left transition-all',
                      isSelected
                        ? 'border-rose-500 bg-rose-500/15 shadow-glow'
                        : 'border-border bg-surface hover:border-border-hover hover:bg-surface-hover',
                    )}
                  >
                    <div
                      className={cn(
                        'flex h-10 w-10 shrink-0 items-center justify-center rounded-xl',
                        isSelected ? 'bg-rose-500 text-white' : 'bg-surface-elevated text-text-muted',
                      )}
                    >
                      <Icon className="w-5 h-5" />
                    </div>
                    <div className="min-w-0">
                      <div className="text-xs font-bold text-text-primary truncate">{cat.label}</div>
                      <div className="text-[11px] text-text-secondary mt-0.5 line-clamp-2">{cat.desc}</div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Step 2: Patient Location & Landmark */}
          <div className="rounded-2xl border border-border bg-surface/60 p-6 backdrop-blur-xl space-y-4">
            <h2 className="text-base font-bold text-text-primary flex items-center gap-2">
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-brand-500/20 text-xs font-bold text-brand-300">
                2
              </span>
              Patient Location & Pickup Details
            </h2>

            <div className="space-y-3">
              <div className="flex items-center justify-between rounded-xl border border-border bg-surface-elevated/70 p-3 text-xs">
                <div className="flex items-center gap-2">
                  <MapPin className="w-4 h-4 text-rose-400 shrink-0" />
                  <span className="font-medium text-text-primary">
                    GPS: {latitude.toFixed(6)}, {longitude.toFixed(6)}
                  </span>
                </div>
                <span className="text-[11px] text-emerald-400 font-semibold bg-emerald-500/10 px-2 py-0.5 rounded-full">
                  GPS Active
                </span>
              </div>

              <div>
                <label className="block text-xs font-semibold text-text-secondary mb-1.5">
                  Street Address / Landmark / Flat Number
                </label>
                <input
                  type="text"
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  placeholder="e.g. Flat 304, Green Heights, Opposite Apollo Pharmacy"
                  className="w-full rounded-xl border border-border bg-surface-elevated/70 px-4 py-2.5 text-sm text-text-primary placeholder:text-text-muted focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
                />
              </div>

              <div className="grid sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-text-secondary mb-1.5">
                    Contact Phone Number
                  </label>
                  <input
                    type="tel"
                    value={contactPhone}
                    onChange={(e) => setContactPhone(e.target.value)}
                    placeholder={user?.phone || '+91 98765 43210'}
                    className="w-full rounded-xl border border-border bg-surface-elevated/70 px-4 py-2.5 text-sm text-text-primary placeholder:text-text-muted focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-text-secondary mb-1.5">
                    Destination Hospital Preference
                  </label>
                  <input
                    type="text"
                    value={destinationHospital}
                    onChange={(e) => setDestinationHospital(e.target.value)}
                    placeholder="Nearest Trauma Hospital"
                    className="w-full rounded-xl border border-border bg-surface-elevated/70 px-4 py-2.5 text-sm text-text-primary placeholder:text-text-muted focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Step 3: Specific Critical Symptoms */}
          <div className="rounded-2xl border border-border bg-surface/60 p-6 backdrop-blur-xl space-y-4">
            <h2 className="text-base font-bold text-text-primary flex items-center gap-2">
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-brand-500/20 text-xs font-bold text-brand-300">
                3
              </span>
              Critical Symptoms (Select all that apply)
            </h2>

            <div className="flex flex-wrap gap-2">
              {symptomOptions.map((sym) => {
                const isSelected = selectedSymptoms.includes(sym);
                return (
                  <button
                    key={sym}
                    type="button"
                    onClick={() => toggleSymptom(sym)}
                    className={cn(
                      'rounded-xl border px-3 py-1.5 text-xs font-semibold transition-all',
                      isSelected
                        ? 'border-rose-500 bg-rose-500/20 text-rose-300 shadow-sm'
                        : 'border-border bg-surface text-text-secondary hover:border-text-muted hover:text-text-primary',
                    )}
                  >
                    {sym}
                  </button>
                );
              })}
            </div>

            <div>
              <label className="block text-xs font-semibold text-text-secondary mb-1.5">
                Additional Notes for Paramedics
              </label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={2}
                placeholder="Mention allergies, preexisting cardiac conditions, or gate pass instructions..."
                className="w-full rounded-xl border border-border bg-surface-elevated/70 px-4 py-2 text-xs text-text-primary placeholder:text-text-muted focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
              />
            </div>
          </div>
        </div>

        {/* Right Column: Dispatch Action Summary Card */}
        <div className="md:col-span-4 space-y-4">
          <div className="sticky top-24 rounded-2xl border border-rose-500/30 bg-surface/80 p-6 backdrop-blur-xl shadow-2xl space-y-5">
            <div className="flex items-center gap-2 text-rose-400 font-bold text-sm">
              <ShieldCheck className="w-5 h-5" />
              Dispatch Summary
            </div>

            <div className="space-y-3 text-xs">
              <div className="flex justify-between py-1 border-b border-border">
                <span className="text-text-secondary">Emergency:</span>
                <span className="font-bold text-text-primary truncate max-w-[140px]">
                  {selectedType}
                </span>
              </div>
              <div className="flex justify-between py-1 border-b border-border">
                <span className="text-text-secondary">Destination:</span>
                <span className="font-medium text-text-primary truncate max-w-[140px]">
                  {destinationHospital}
                </span>
              </div>
              <div className="flex justify-between py-1 border-b border-border">
                <span className="text-text-secondary">Estimated ETA:</span>
                <span className="font-bold text-emerald-400">5 – 8 Minutes</span>
              </div>
              <div className="flex justify-between py-1 border-b border-border">
                <span className="text-text-secondary">Care Circle Alert:</span>
                <span className="text-blue-400 font-semibold">Automatic via SMS/App</span>
              </div>
            </div>

            {/* Big One-Touch Dispatch Button */}
            <button
              type="button"
              onClick={handleDispatch}
              disabled={loading}
              className="w-full flex items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-red-600 via-rose-600 to-red-700 py-4 text-sm font-black uppercase tracking-wider text-white shadow-xl shadow-rose-600/30 hover:brightness-110 active:scale-98 transition-all disabled:opacity-50"
            >
              {loading ? (
                <span>Dispatching Paramedics...</span>
              ) : (
                <>
                  <Siren className="w-5 h-5 animate-pulse" />
                  DISPATCH AMBULANCE NOW
                  <ArrowRight className="w-4 h-4 ml-1" />
                </>
              )}
            </button>

            <button
              type="button"
              onClick={() => navigate('/hospitals')}
              className="w-full rounded-xl border border-border bg-surface py-2.5 text-xs font-semibold text-text-secondary hover:text-text-primary transition-colors"
            >
              View Nearby Hospitals List Instead
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
