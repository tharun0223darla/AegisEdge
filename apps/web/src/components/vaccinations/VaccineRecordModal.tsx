import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  X,
  CheckCircle2,
  Calendar,
  Building2,
  User,
  Hash,
  FileText,
  AlertCircle,
  Syringe,
} from 'lucide-react';
import type { VaccineCatalogItem, VaccinationRecord, FamilyMemberProfile } from '@/types/vaccination';
import toast from 'react-hot-toast';

interface VaccineRecordModalProps {
  vaccine?: VaccineCatalogItem | null;
  record?: VaccinationRecord | null;
  familyProfiles: FamilyMemberProfile[];
  activeMemberId?: string;
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (payload: any) => Promise<void>;
}

export function VaccineRecordModal({
  vaccine,
  record,
  familyProfiles,
  activeMemberId = 'mem-self',
  isOpen,
  onClose,
  onSubmit,
}: VaccineRecordModalProps) {
  const [memberId, setMemberId] = useState<string>(
    record?.memberId || activeMemberId || 'mem-self',
  );
  const [doseNumber, setDoseNumber] = useState<number>(
    record?.doseNumber || vaccine?.doseNumber || 1,
  );
  const [administeredDate, setAdministeredDate] = useState<string>(
    record?.administeredDate || new Date().toISOString().split('T')[0],
  );
  const [clinicOrCenterName, setClinicOrCenterName] = useState<string>(
    record?.clinicOrCenterName || 'Primary Health Centre / Hospital',
  );
  const [administeredBy, setAdministeredBy] = useState<string>(
    record?.administeredBy || 'Dr. / Medical Officer',
  );
  const [batchNumber, setBatchNumber] = useState<string>(
    record?.batchNumber || `BATCH-${Math.floor(100000 + Math.random() * 900000)}`,
  );
  const [brandName, setBrandName] = useState<string>(
    record?.brandName || vaccine?.manufacturerBrands?.[0] || 'Standard Formulation',
  );
  const [adverseReactions, setAdverseReactions] = useState<string>(
    record?.adverseReactions || '',
  );
  const [notes, setNotes] = useState<string>(record?.notes || '');
  const [submitting, setSubmitting] = useState<boolean>(false);

  if (!isOpen) return null;

  const vaccineTitle = record?.vaccineName || vaccine?.name || 'Vaccination Dose';
  const vaccineCode = record?.vaccineCode || vaccine?.code || 'VAX';
  const targetMember = familyProfiles.find((m) => m.id === memberId) || familyProfiles[0];

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      if (record) {
        await onSubmit({
          status: 'COMPLETED',
          administeredDate,
          clinicOrCenterName,
          administeredBy,
          batchNumber,
          brandName,
          adverseReactions,
          notes,
        });
      } else {
        await onSubmit({
          vaccineId: vaccine?.id || 'vac-custom',
          memberId,
          memberName: targetMember?.name || 'Self',
          doseNumber,
          administeredDate,
          clinicOrCenterName,
          administeredBy,
          batchNumber,
          brandName,
          adverseReactions,
          notes,
        });
      }
      toast.success('Vaccination recorded successfully in passport!');
      onClose();
    } catch (err: any) {
      toast.error(err?.response?.data?.message || 'Failed to record vaccination');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-md overflow-y-auto">
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 20 }}
          transition={{ duration: 0.2 }}
          className="relative w-full max-w-xl max-h-[90vh] flex flex-col rounded-3xl border border-border bg-surface shadow-2xl overflow-hidden"
        >
          {/* Header */}
          <div className="flex items-start justify-between p-6 border-b border-border bg-gradient-to-r from-emerald-950/40 via-surface to-surface">
            <div className="flex items-center gap-3.5">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                <CheckCircle2 className="h-6 w-6" />
              </div>
              <div>
                <h3 className="text-lg font-bold text-text-primary">
                  Record Administered Vaccine
                </h3>
                <p className="text-xs text-emerald-400/90 font-medium">
                  {vaccineTitle} ({vaccineCode})
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

          {/* Form */}
          <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-6 space-y-4 text-xs">
            {/* Family Member Selection */}
            {!record && (
              <div>
                <label className="font-bold text-text-primary block mb-1.5">
                  Patient / Family Member
                </label>
                <select
                  value={memberId}
                  onChange={(e) => setMemberId(e.target.value)}
                  className="w-full rounded-xl border border-border bg-surface-elevated px-3.5 py-2.5 text-xs text-text-primary focus:border-brand-500 focus:outline-none"
                >
                  {familyProfiles.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} ({p.relationship})
                    </option>
                  ))}
                </select>
              </div>
            )}

            {/* Dose Number & Date Administered */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="font-bold text-text-primary block mb-1.5">
                  Dose Sequence
                </label>
                <input
                  type="number"
                  min="1"
                  max="10"
                  value={doseNumber}
                  onChange={(e) => setDoseNumber(parseInt(e.target.value) || 1)}
                  className="w-full rounded-xl border border-border bg-surface-elevated px-3.5 py-2.5 text-xs text-text-primary focus:border-brand-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="font-bold text-text-primary block mb-1.5 flex items-center gap-1">
                  <Calendar className="w-3.5 h-3.5 text-brand-400" /> Date Administered
                </label>
                <input
                  type="date"
                  required
                  value={administeredDate}
                  onChange={(e) => setAdministeredDate(e.target.value)}
                  className="w-full rounded-xl border border-border bg-surface-elevated px-3.5 py-2.5 text-xs text-text-primary focus:border-brand-500 focus:outline-none"
                />
              </div>
            </div>

            {/* Clinic / Center & Doctor */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="font-bold text-text-primary block mb-1.5 flex items-center gap-1">
                  <Building2 className="w-3.5 h-3.5 text-brand-400" /> Hospital / PHC / Clinic
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Rainbow Children Hospital or BBMP PHC"
                  value={clinicOrCenterName}
                  onChange={(e) => setClinicOrCenterName(e.target.value)}
                  className="w-full rounded-xl border border-border bg-surface-elevated px-3.5 py-2.5 text-xs text-text-primary focus:border-brand-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="font-bold text-text-primary block mb-1.5 flex items-center gap-1">
                  <User className="w-3.5 h-3.5 text-brand-400" /> Administering Doctor / Nurse
                </label>
                <input
                  type="text"
                  placeholder="e.g. Dr. S. Kulkarni"
                  value={administeredBy}
                  onChange={(e) => setAdministeredBy(e.target.value)}
                  className="w-full rounded-xl border border-border bg-surface-elevated px-3.5 py-2.5 text-xs text-text-primary focus:border-brand-500 focus:outline-none"
                />
              </div>
            </div>

            {/* Batch Number & Brand */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="font-bold text-text-primary block mb-1.5 flex items-center gap-1">
                  <Hash className="w-3.5 h-3.5 text-brand-400" /> Vaccine Batch / Lot Number
                </label>
                <input
                  type="text"
                  placeholder="e.g. BATCH-88294A"
                  value={batchNumber}
                  onChange={(e) => setBatchNumber(e.target.value)}
                  className="w-full rounded-xl border border-border bg-surface-elevated px-3.5 py-2.5 text-xs text-text-primary focus:border-brand-500 focus:outline-none font-mono"
                />
              </div>

              <div>
                <label className="font-bold text-text-primary block mb-1.5 flex items-center gap-1">
                  <Syringe className="w-3.5 h-3.5 text-brand-400" /> Brand / Manufacturer
                </label>
                <input
                  type="text"
                  placeholder="e.g. Serum Institute / GSK / Sanofi"
                  value={brandName}
                  onChange={(e) => setBrandName(e.target.value)}
                  className="w-full rounded-xl border border-border bg-surface-elevated px-3.5 py-2.5 text-xs text-text-primary focus:border-brand-500 focus:outline-none"
                />
              </div>
            </div>

            {/* Adverse Reactions / Observations */}
            <div>
              <label className="font-bold text-text-primary block mb-1.5 flex items-center gap-1">
                <AlertCircle className="w-3.5 h-3.5 text-amber-400" /> Adverse Events / Post-Vaccine Observations
              </label>
              <input
                type="text"
                placeholder="e.g. Mild low fever for 12 hours, resolved with paracetamol"
                value={adverseReactions}
                onChange={(e) => setAdverseReactions(e.target.value)}
                className="w-full rounded-xl border border-border bg-surface-elevated px-3.5 py-2.5 text-xs text-text-primary focus:border-brand-500 focus:outline-none"
              />
            </div>

            {/* Notes */}
            <div>
              <label className="font-bold text-text-primary block mb-1.5 flex items-center gap-1">
                <FileText className="w-3.5 h-3.5 text-text-muted" /> Clinical Notes
              </label>
              <textarea
                rows={2}
                placeholder="Additional details, next booster consultation, etc."
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                className="w-full rounded-xl border border-border bg-surface-elevated px-3.5 py-2.5 text-xs text-text-primary focus:border-brand-500 focus:outline-none"
              />
            </div>

            {/* Action Buttons */}
            <div className="pt-4 border-t border-border flex items-center justify-end gap-3">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2.5 rounded-xl border border-border text-xs font-semibold text-text-secondary hover:bg-surface-hover transition"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={submitting}
                className="px-6 py-2.5 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 text-xs font-bold text-white shadow-glow hover:brightness-110 transition flex items-center gap-1.5"
              >
                <CheckCircle2 className="w-4 h-4" />
                {submitting ? 'Saving...' : 'Save & Mark Completed'}
              </button>
            </div>
          </form>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
