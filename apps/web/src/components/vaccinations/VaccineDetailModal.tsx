import { motion, AnimatePresence } from 'framer-motion';
import {
  X,
  Syringe,
  ShieldCheck,
  AlertTriangle,
  Clock,
  CheckCircle2,
  Thermometer,
  Layers,
  IndianRupee,
  Activity,
  HeartHandshake,
} from 'lucide-react';
import type { VaccineCatalogItem } from '@/types/vaccination';

interface VaccineDetailModalProps {
  vaccine: VaccineCatalogItem | null;
  isOpen: boolean;
  onClose: () => void;
  onRecordAdministered?: (vaccine: VaccineCatalogItem) => void;
  onFindCenters?: (vaccine: VaccineCatalogItem) => void;
}

export function VaccineDetailModal({
  vaccine,
  isOpen,
  onClose,
  onRecordAdministered,
  onFindCenters,
}: VaccineDetailModalProps) {
  if (!isOpen || !vaccine) return null;

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-md overflow-y-auto">
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 20 }}
          transition={{ duration: 0.2 }}
          className="relative w-full max-w-2xl max-h-[90vh] flex flex-col rounded-3xl border border-border bg-surface shadow-2xl overflow-hidden"
        >
          {/* Header */}
          <div className="flex items-start justify-between p-6 border-b border-border bg-gradient-to-r from-brand-950/40 via-surface to-surface">
            <div className="flex items-center gap-3.5">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-brand-500/20 text-brand-400 border border-brand-500/30">
                <Syringe className="h-6 w-6" />
              </div>
              <div>
                <div className="flex items-center gap-2 flex-wrap">
                  <h3 className="text-xl font-bold text-text-primary">
                    {vaccine.name}
                  </h3>
                  <span className="rounded-md bg-brand-500/15 border border-brand-500/30 px-2 py-0.5 text-xs font-black text-brand-400 tracking-wider">
                    {vaccine.code}
                  </span>
                </div>
                <p className="text-xs text-text-secondary mt-0.5">
                  {vaccine.targetAgeDescription}
                </p>
              </div>
            </div>

            <button
              type="button"
              onClick={onClose}
              className="rounded-xl p-2 text-text-muted hover:bg-surface-hover hover:text-text-primary transition"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Body Content */}
          <div className="flex-1 overflow-y-auto p-6 space-y-6">
            {/* UIP / Gov badge & Pricing */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="p-3.5 rounded-2xl border border-border bg-surface-elevated flex flex-col justify-between">
                <span className="text-[11px] font-semibold text-text-muted">Category</span>
                <span className="text-sm font-bold text-brand-400 capitalize mt-1">
                  {vaccine.category.toLowerCase().replace('_', ' ')}
                </span>
              </div>

              <div className="p-3.5 rounded-2xl border border-border bg-surface-elevated flex flex-col justify-between">
                <span className="text-[11px] font-semibold text-text-muted">Govt Universal UIP</span>
                <span
                  className={`text-sm font-bold mt-1 ${
                    vaccine.isUipGovernmentFree ? 'text-emerald-400' : 'text-amber-400'
                  }`}
                >
                  {vaccine.isUipGovernmentFree ? 'Free (Govt PHCs)' : 'Optional / Private'}
                </span>
              </div>

              <div className="p-3.5 rounded-2xl border border-border bg-surface-elevated flex flex-col justify-between">
                <span className="text-[11px] font-semibold text-text-muted">Private Clinic Cost</span>
                <span className="text-sm font-bold text-text-primary mt-1 flex items-center">
                  ₹{vaccine.estimatedCostInr.privateMin} - ₹{vaccine.estimatedCostInr.privateMax}
                </span>
              </div>
            </div>

            {/* Description */}
            <div>
              <h4 className="text-xs font-bold uppercase tracking-wider text-text-muted mb-2">
                Clinical Overview
              </h4>
              <p className="text-sm text-text-secondary leading-relaxed bg-surface-elevated/60 p-4 rounded-2xl border border-border/60">
                {vaccine.fullDescription}
              </p>
            </div>

            {/* Diseases Prevented */}
            <div>
              <h4 className="text-xs font-bold uppercase tracking-wider text-text-muted mb-2.5">
                Pathogens & Diseases Prevented
              </h4>
              <div className="flex flex-wrap gap-2">
                {vaccine.diseasePrevented.map((disease, idx) => (
                  <span
                    key={idx}
                    className="inline-flex items-center gap-1.5 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3 py-1.5 text-xs font-semibold text-emerald-300"
                  >
                    <ShieldCheck className="w-3.5 h-3.5" />
                    {disease}
                  </span>
                ))}
              </div>
            </div>

            {/* Dosage, Route & Administration Site */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="p-4 rounded-2xl border border-border bg-surface-elevated space-y-2">
                <div className="flex items-center gap-2 text-text-primary font-bold text-xs">
                  <Layers className="w-4 h-4 text-brand-400" /> Administration Route
                </div>
                <p className="text-sm font-semibold text-text-primary">
                  {vaccine.administrationRoute}
                </p>
                <p className="text-xs text-text-muted">
                  Site: {vaccine.recommendedSites.join(', ')}
                </p>
              </div>

              <div className="p-4 rounded-2xl border border-border bg-surface-elevated space-y-2">
                <div className="flex items-center gap-2 text-text-primary font-bold text-xs">
                  <Clock className="w-4 h-4 text-brand-400" /> Series & Booster
                </div>
                <p className="text-sm font-semibold text-text-primary">
                  {vaccine.totalDosesInSeries} Dose Series
                </p>
                <p className="text-xs text-text-muted">
                  {vaccine.boosterRecommendations || 'Follow standard pediatric or adult intervals.'}
                </p>
              </div>
            </div>

            {/* Side Effects & Precautions */}
            <div className="space-y-4">
              <div className="p-4 rounded-2xl border border-amber-500/30 bg-amber-500/10 space-y-2">
                <div className="flex items-center gap-2 text-amber-300 font-bold text-xs">
                  <Activity className="w-4 h-4" /> Common Side Effects (Normal Immune Response)
                </div>
                <ul className="text-xs text-amber-200/90 space-y-1 list-disc list-inside">
                  {vaccine.commonSideEffects.map((se, i) => (
                    <li key={i}>{se}</li>
                  ))}
                </ul>
              </div>

              <div className="p-4 rounded-2xl border border-rose-500/30 bg-rose-500/10 space-y-2">
                <div className="flex items-center gap-2 text-rose-300 font-bold text-xs">
                  <AlertTriangle className="w-4 h-4" /> Precautions & Contraindications
                </div>
                <ul className="text-xs text-rose-200/90 space-y-1 list-disc list-inside">
                  {vaccine.precautionsAndContraindications.map((pc, i) => (
                    <li key={i}>{pc}</li>
                  ))}
                </ul>
              </div>
            </div>

            {/* Available Brands & Cold Chain Storage */}
            {vaccine.manufacturerBrands && vaccine.manufacturerBrands.length > 0 && (
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 rounded-2xl border border-border bg-surface-elevated text-xs">
                <div>
                  <span className="font-bold text-text-primary block">
                    Recognized Brand Formulations:
                  </span>
                  <span className="text-text-secondary">
                    {vaccine.manufacturerBrands.join(', ')}
                  </span>
                </div>
                {vaccine.storageTempCelsius && (
                  <div className="flex items-center gap-1.5 text-text-muted shrink-0">
                    <Thermometer className="w-4 h-4 text-brand-400" />
                    <span>{vaccine.storageTempCelsius}</span>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Footer Actions */}
          <div className="p-6 border-t border-border bg-surface-elevated/50 flex flex-col sm:flex-row items-center justify-end gap-3">
            <button
              type="button"
              onClick={onClose}
              className="w-full sm:w-auto px-5 py-2.5 rounded-xl border border-border text-xs font-semibold text-text-secondary hover:bg-surface-hover transition"
            >
              Close
            </button>
            {onFindCenters && (
              <button
                type="button"
                onClick={() => {
                  onClose();
                  onFindCenters(vaccine);
                }}
                className="w-full sm:w-auto px-5 py-2.5 rounded-xl border border-brand-500/40 bg-brand-500/10 text-xs font-semibold text-brand-300 hover:bg-brand-500/20 transition flex items-center justify-center gap-1.5"
              >
                <HeartHandshake className="w-4 h-4" /> Find Nearby Centers
              </button>
            )}
            {onRecordAdministered && (
              <button
                type="button"
                onClick={() => {
                  onClose();
                  onRecordAdministered(vaccine);
                }}
                className="w-full sm:w-auto px-5 py-2.5 rounded-xl bg-gradient-to-r from-brand-600 to-indigo-600 text-xs font-bold text-white shadow-glow hover:brightness-110 transition flex items-center justify-center gap-1.5"
              >
                <CheckCircle2 className="w-4 h-4" /> Mark Administered
              </button>
            )}
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
