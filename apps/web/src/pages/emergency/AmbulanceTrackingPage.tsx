import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Siren,
  Phone,
  Clock,
  Gauge,
  MapPin,
  ShieldCheck,
  UserCheck,
  CheckCircle2,
  AlertTriangle,
  Share2,
  XCircle,
  Building2,
  Navigation,
  RefreshCw,
} from 'lucide-react';
import { emergencyService } from '@/services/emergency.service';
import type { AmbulanceTrackingSession, DispatchStatus } from '@/types/emergency';
import { EmergencyMap } from '@/components/emergency/EmergencyMap';
import toast from 'react-hot-toast';
import { cn } from '@/lib/utils';

export default function AmbulanceTrackingPage() {
  const { id: routeRequestId } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const requestId = routeRequestId || 'MED-AMB-DEMO108';

  const [session, setSession] = useState<AmbulanceTrackingSession | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [cancelling, setCancelling] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  // ── Poll Live Telemetry every 3 seconds ───────────────────────
  const fetchSession = async () => {
    try {
      const res = await emergencyService.getAmbulanceStatus(requestId);
      if (res && res.data) {
        setSession(res.data);
      }
    } catch (err: any) {
      console.error('Failed to fetch ambulance status:', err);
      setError('Unable to fetch live tracking telemetry.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSession();
    const interval = setInterval(fetchSession, 3000);
    return () => clearInterval(interval);
  }, [requestId]);

  // ── Cancel Dispatch ──────────────────────────────────────────
  const handleCancel = async () => {
    if (!confirm('Are you sure you want to cancel this emergency ambulance dispatch?')) {
      return;
    }
    setCancelling(true);
    try {
      await emergencyService.cancelAmbulance(requestId);
      toast.success('Ambulance request cancelled');
      fetchSession();
    } catch (err: any) {
      toast.error('Failed to cancel ambulance request');
    } finally {
      setCancelling(false);
    }
  };

  // ── Share Tracking Link ──────────────────────────────────────
  const handleShare = () => {
    const url = window.location.href;
    if (navigator.share) {
      navigator.share({
        title: 'Emergency Ambulance Tracking',
        text: `Track live ambulance dispatch ${requestId} on MediTrack AI:`,
        url,
      });
    } else {
      navigator.clipboard.writeText(url);
      toast.success('Live tracking link copied to clipboard');
    }
  };

  const statusSteps: { key: DispatchStatus; label: string; desc: string }[] = [
    { key: 'REQUESTED', label: 'Requested', desc: 'Emergency received' },
    { key: 'DISPATCHED', label: 'Dispatched', desc: 'Paramedics assigned' },
    { key: 'ON_THE_WAY', label: 'On The Way', desc: 'Moving to location' },
    { key: 'ARRIVED', label: 'Arrived', desc: 'At patient doorstep' },
    { key: 'TRANSPORTING', label: 'Transporting', desc: 'En route to hospital' },
  ];

  const getStepIndex = (status?: DispatchStatus) => {
    switch (status) {
      case 'REQUESTED':
        return 0;
      case 'DISPATCHED':
        return 1;
      case 'ON_THE_WAY':
        return 2;
      case 'ARRIVED':
        return 3;
      case 'TRANSPORTING':
      case 'COMPLETED':
        return 4;
      default:
        return 2;
    }
  };

  const currentStepIdx = getStepIndex(session?.status);

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      {/* ── Top Status Header Bar ──────────────────────────────── */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 rounded-2xl border border-rose-500/30 bg-surface/70 p-5 backdrop-blur-xl">
        <div className="flex items-center gap-3">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-rose-500/20 border border-rose-500/40 text-rose-400">
            <Siren className="h-6 w-6 animate-pulse" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-bold text-text-primary">
                Ambulance Live Tracking
              </h1>
              <span className="font-mono text-xs font-bold text-rose-400 bg-rose-500/15 border border-rose-500/30 px-2 py-0.5 rounded-md">
                {requestId}
              </span>
            </div>
            <p className="text-xs text-text-secondary mt-0.5">
              Emergency: <strong className="text-text-primary">{session?.emergencyType || 'Medical Emergency'}</strong>
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap self-stretch sm:self-auto">
          <button
            type="button"
            onClick={handleShare}
            className="flex-1 sm:flex-initial inline-flex items-center justify-center gap-1.5 rounded-xl border border-border bg-surface px-3.5 py-2 text-xs font-semibold text-text-secondary hover:text-text-primary transition-colors"
          >
            <Share2 className="w-3.5 h-3.5" /> Share
          </button>
          <a
            href="tel:108"
            className="flex-1 sm:flex-initial inline-flex items-center justify-center gap-1.5 rounded-xl bg-rose-600 px-4 py-2 text-xs font-bold text-white shadow-lg shadow-rose-600/30 hover:bg-rose-500 transition-colors"
          >
            <Phone className="w-3.5 h-3.5" /> Call 108
          </a>
        </div>
      </div>

      {/* ── Status Progress Pipeline ───────────────────────────── */}
      <div className="rounded-2xl border border-border bg-surface/60 p-5 backdrop-blur-xl">
        <div className="grid grid-cols-5 gap-2 relative">
          {statusSteps.map((step, idx) => {
            const isCompleted = idx < currentStepIdx;
            const isCurrent = idx === currentStepIdx;

            return (
              <div key={step.key} className="flex flex-col items-center text-center">
                <div
                  className={cn(
                    'flex h-9 w-9 items-center justify-center rounded-full border-2 text-xs font-bold transition-all duration-300',
                    isCompleted
                      ? 'border-emerald-500 bg-emerald-500 text-white shadow-sm'
                      : isCurrent
                        ? 'border-rose-500 bg-rose-500/20 text-rose-400 ring-4 ring-rose-500/20 animate-pulse'
                        : 'border-border bg-surface text-text-muted',
                  )}
                >
                  {isCompleted ? <CheckCircle2 className="w-5 h-5" /> : idx + 1}
                </div>
                <span
                  className={cn(
                    'mt-2 text-xs font-bold line-clamp-1',
                    isCurrent ? 'text-rose-400' : isCompleted ? 'text-text-primary' : 'text-text-muted',
                  )}
                >
                  {step.label}
                </span>
                <span className="hidden md:block text-[11px] text-text-secondary mt-0.5">
                  {step.desc}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Main Tracking Grid (Live Map + Telemetry Dashboard) ── */}
      <div className="grid lg:grid-cols-12 gap-6">
        {/* Interactive Map */}
        <div className="lg:col-span-8 space-y-3">
          {session ? (
            <EmergencyMap
              userLocation={session.patientLocation}
              ambulanceSession={session}
              className="h-[520px] w-full rounded-2xl border border-border shadow-2xl overflow-hidden"
            />
          ) : (
            <div className="h-[520px] rounded-2xl border border-border bg-surface/40 flex items-center justify-center animate-pulse">
              <RefreshCw className="w-8 h-8 text-brand-400 animate-spin" />
            </div>
          )}
          <div className="flex items-center justify-between text-xs text-text-muted px-1">
            <span className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-emerald-500 animate-ping" />
              Live Telemetry streaming every 3s
            </span>
            <span>Destination: {session?.destinationHospital || 'Trauma Center'}</span>
          </div>
        </div>

        {/* Telemetry & Driver Card */}
        <div className="lg:col-span-4 space-y-4">
          {/* Quick Metrics */}
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-2xl border border-border bg-surface/70 p-4 backdrop-blur-xl">
              <div className="flex items-center gap-1.5 text-xs text-text-secondary">
                <Clock className="w-4 h-4 text-emerald-400" />
                <span>Estimated ETA</span>
              </div>
              <div className="mt-2 text-2xl font-black text-emerald-400">
                {session?.etaMinutes ?? '--'} <span className="text-xs font-normal">min</span>
              </div>
              <div className="text-[11px] text-text-muted mt-0.5">
                {session?.distanceKmRemaining} km away
              </div>
            </div>

            <div className="rounded-2xl border border-border bg-surface/70 p-4 backdrop-blur-xl">
              <div className="flex items-center gap-1.5 text-xs text-text-secondary">
                <Gauge className="w-4 h-4 text-blue-400" />
                <span>Vehicle Speed</span>
              </div>
              <div className="mt-2 text-2xl font-black text-blue-400">
                {session?.speedKmH ?? '--'} <span className="text-xs font-normal">km/h</span>
              </div>
              <div className="text-[11px] text-text-muted mt-0.5">
                High Priority Transit
              </div>
            </div>
          </div>

          {/* Assigned Driver & Paramedic Unit */}
          <div className="rounded-2xl border border-border bg-surface/70 p-5 backdrop-blur-xl space-y-4">
            <div className="text-xs font-bold text-text-muted uppercase tracking-wider">
              Assigned Paramedic Unit
            </div>

            <div className="flex items-center gap-3">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-500/15 border border-brand-500/30 text-xl font-bold text-brand-300">
                👨‍⚕️
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-bold text-text-primary truncate">
                  {session?.driver.name || 'Assigned Paramedic Team'}
                </div>
                <div className="text-xs font-mono text-brand-400">
                  {session?.driver.vehicleNumber || 'AP-28-AMB-4412'}
                </div>
                <div className="text-[11px] text-text-muted truncate">
                  {session?.driver.vehicleModel}
                </div>
              </div>
            </div>

            {session?.driver.phone && (
              <a
                href={`tel:${session.driver.phone}`}
                className="w-full flex items-center justify-center gap-2 rounded-xl bg-emerald-600 py-3 text-xs font-bold text-white shadow-lg shadow-emerald-600/30 hover:bg-emerald-500 transition-colors"
              >
                <Phone className="w-4 h-4" /> Call Driver ({session.driver.phone})
              </a>
            )}
          </div>

          {/* Hospital Destination Card */}
          <div className="rounded-2xl border border-border bg-surface/70 p-4 backdrop-blur-xl space-y-2 text-xs">
            <div className="flex items-center gap-1.5 font-bold text-text-primary">
              <Building2 className="w-4 h-4 text-brand-400" />
              <span>Receiving Hospital</span>
            </div>
            <div className="text-text-secondary">
              {session?.destinationHospital || 'City Central Emergency & Trauma Center'}
            </div>
            <div className="text-[11px] text-emerald-400 font-semibold flex items-center gap-1">
              <ShieldCheck className="w-3.5 h-3.5" /> Emergency Room & ICU on Standby
            </div>
          </div>

          {/* Cancel Request Button */}
          {session?.status !== 'CANCELLED' && session?.status !== 'ARRIVED' && (
            <button
              type="button"
              onClick={handleCancel}
              disabled={cancelling}
              className="w-full rounded-xl border border-rose-500/30 bg-rose-500/10 py-2.5 text-xs font-bold text-rose-400 hover:bg-rose-500/20 transition-colors disabled:opacity-50"
            >
              Cancel Ambulance Dispatch
            </button>
          )}

          <button
            type="button"
            onClick={() => navigate('/hospitals')}
            className="w-full rounded-xl border border-border bg-surface py-2 text-xs font-medium text-text-secondary hover:text-text-primary transition-colors"
          >
            ← Back to Nearby Hospitals Finder
          </button>
        </div>
      </div>
    </div>
  );
}
