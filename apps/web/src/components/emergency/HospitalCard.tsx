import { Phone, Navigation, Siren, Star, Clock, ShieldCheck, MapPin, Building2 } from 'lucide-react';
import type { Hospital } from '@/types/emergency';
import { cn } from '@/lib/utils';

interface HospitalCardProps {
  hospital: Hospital;
  isSelected?: boolean;
  onSelect?: () => void;
  onRequestAmbulance?: (hospital: Hospital) => void;
}

export function HospitalCard({
  hospital,
  isSelected = false,
  onSelect,
  onRequestAmbulance,
}: HospitalCardProps) {
  const isEmergency = hospital.emergency_available || hospital.type === 'trauma_center';

  return (
    <div
      onClick={onSelect}
      className={cn(
        'group relative flex flex-col justify-between rounded-2xl border p-5 transition-all duration-300 backdrop-blur-xl cursor-pointer',
        isSelected
          ? 'border-brand-500 bg-surface-active/80 shadow-glow ring-1 ring-brand-500/50'
          : 'border-border bg-surface/60 hover:border-brand-500/40 hover:bg-surface-hover hover:shadow-lg',
      )}
    >
      <div>
        {/* Top Badges */}
        <div className="flex items-center justify-between gap-2 mb-3">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span
              className={cn(
                'inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold uppercase tracking-wider',
                isEmergency
                  ? 'bg-rose-500/15 text-rose-400 border border-rose-500/30'
                  : 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30',
              )}
            >
              {isEmergency && <Siren className="w-3 h-3 animate-pulse" />}
              {hospital.type.replace('_', ' ')}
            </span>

            {hospital.icu_available && (
              <span className="inline-flex items-center gap-1 rounded-full bg-blue-500/10 border border-blue-500/20 px-2 py-0.5 text-xs font-medium text-blue-400">
                <ShieldCheck className="w-3 h-3" /> ICU Ready
              </span>
            )}
          </div>

          {/* Distance Badge */}
          <span className="inline-flex items-center gap-1 rounded-full bg-brand-500/15 border border-brand-500/30 px-3 py-1 text-xs font-bold text-brand-300">
            <MapPin className="w-3 h-3" />
            {hospital.distance}
          </span>
        </div>

        {/* Hospital Name & Rating */}
        <div className="flex items-start justify-between gap-2">
          <h3 className="text-base font-semibold text-text-primary group-hover:text-brand-300 transition-colors line-clamp-1">
            {hospital.name}
          </h3>
          {hospital.rating && (
            <div className="flex items-center gap-1 text-xs font-bold text-amber-400 shrink-0">
              <Star className="w-3.5 h-3.5 fill-amber-400" />
              <span>{hospital.rating}</span>
            </div>
          )}
        </div>

        {/* Address */}
        <p className="mt-1.5 text-xs text-text-secondary line-clamp-2 leading-relaxed">
          {hospital.address}
        </p>

        {/* Info Grid */}
        <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-text-muted">
          {hospital.opening_hours && (
            <div className="flex items-center gap-1.5 truncate">
              <Clock className="w-3.5 h-3.5 text-text-secondary shrink-0" />
              <span className="truncate">{hospital.opening_hours}</span>
            </div>
          )}
          <div className="flex items-center gap-1.5 truncate">
            <Building2 className="w-3.5 h-3.5 text-text-secondary shrink-0" />
            <span>{hospital.source}</span>
          </div>
        </div>
      </div>

      {/* Action Buttons */}
      <div className="mt-4 pt-4 border-t border-border flex items-center gap-2">
        {hospital.phone && (
          <a
            href={`tel:${hospital.phone}`}
            onClick={(e) => e.stopPropagation()}
            className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-xl bg-emerald-500/15 border border-emerald-500/30 py-2 text-xs font-semibold text-emerald-400 hover:bg-emerald-500/25 transition-colors"
          >
            <Phone className="w-3.5 h-3.5" /> Call
          </a>
        )}

        <a
          href={hospital.directions_url}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
          className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-xl bg-surface border border-border py-2 text-xs font-semibold text-text-primary hover:bg-surface-hover hover:border-text-muted transition-colors"
        >
          <Navigation className="w-3.5 h-3.5 text-blue-400" /> Directions
        </a>

        {onRequestAmbulance && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onRequestAmbulance(hospital);
            }}
            className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-xl bg-rose-500/20 border border-rose-500/40 py-2 text-xs font-bold text-rose-300 hover:bg-rose-500/30 transition-colors shadow-sm"
          >
            <Siren className="w-3.5 h-3.5" /> Dispatch
          </button>
        )}
      </div>
    </div>
  );
}
