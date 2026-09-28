import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  X,
  Calendar,
  Clock,
  Building2,
  CheckCircle2,
  Syringe,
  User,
  ShieldCheck,
} from 'lucide-react';
import type { VaccinationCenter, FamilyMemberProfile, VaccineCatalogItem } from '@/types/vaccination';
import toast from 'react-hot-toast';

interface VaccineAppointmentModalProps {
  center: VaccinationCenter | null;
  vaccine?: VaccineCatalogItem | null;
  familyProfiles: FamilyMemberProfile[];
  activeMemberId?: string;
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (payload: any) => Promise<any>;
}

export function VaccineAppointmentModal({
  center,
  vaccine,
  familyProfiles,
  activeMemberId = 'mem-self',
  isOpen,
  onClose,
  onSubmit,
}: VaccineAppointmentModalProps) {
  const [memberId, setMemberId] = useState<string>(activeMemberId || 'mem-self');
  const [vaccineName, setVaccineName] = useState<string>(
    vaccine?.name || center?.vaccinesAvailable[0] || 'MMR Vaccine',
  );
  const [appointmentDate, setAppointmentDate] = useState<string>(
    new Date(Date.now() + 86400000).toISOString().split('T')[0],
  );
  const [timeSlot, setTimeSlot] = useState<string>('10:00 AM - 10:30 AM');
  const [notes, setNotes] = useState<string>('');
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [confirmedBooking, setConfirmedBooking] = useState<any>(null);

  if (!isOpen || !center) return null;

  const targetMember = familyProfiles.find((m) => m.id === memberId) || familyProfiles[0];

  const timeSlots = [
    '09:00 AM - 09:30 AM',
    '09:30 AM - 10:00 AM',
    '10:00 AM - 10:30 AM',
    '10:30 AM - 11:00 AM',
    '11:30 AM - 12:00 PM',
    '02:00 PM - 02:30 PM',
    '03:00 PM - 03:30 PM',
    '04:30 PM - 05:00 PM',
  ];

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      const res = await onSubmit({
        memberId,
        memberName: targetMember.name,
        vaccineId: vaccine?.id || 'vac-appointment',
        vaccineName,
        doseNumber: 1,
        centerId: center.id,
        appointmentDate,
        timeSlot,
        notes,
      });
      setConfirmedBooking(res || { bookingRef: `VAX-${Math.floor(100000 + Math.random() * 900000)}` });
      toast.success('Vaccination appointment booked!');
    } catch (err: any) {
      toast.error(err?.response?.data?.message || 'Failed to book appointment');
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
          className="relative w-full max-w-lg max-h-[90vh] flex flex-col rounded-3xl border border-border bg-surface shadow-2xl overflow-hidden"
        >
          {/* Header */}
          <div className="flex items-start justify-between p-6 border-b border-border bg-gradient-to-r from-brand-950/40 via-surface to-surface">
            <div className="flex items-center gap-3.5">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-brand-500/20 text-brand-400 border border-brand-500/30">
                <Calendar className="h-6 w-6" />
              </div>
              <div>
                <h3 className="text-lg font-bold text-text-primary">
                  {confirmedBooking ? 'Appointment Confirmed' : 'Book Vaccination Slot'}
                </h3>
                <p className="text-xs text-text-secondary line-clamp-1">{center.name}</p>
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

          {confirmedBooking ? (
            /* Booking Confirmation View */
            <div className="p-8 text-center space-y-6">
              <div className="mx-auto w-16 h-16 rounded-3xl bg-emerald-500/20 text-emerald-400 border border-emerald-500/40 flex items-center justify-center">
                <ShieldCheck className="w-8 h-8" />
              </div>

              <div>
                <h4 className="text-lg font-bold text-text-primary">
                  Slot Reserved Successfully!
                </h4>
                <p className="text-xs text-text-secondary mt-1">
                  Your appointment pass has been added to your MediTrack health calendar.
                </p>
                <div className="mt-4 p-4 rounded-2xl border border-border bg-surface-elevated text-xs space-y-1.5 text-left font-mono">
                  <div className="flex justify-between">
                    <span className="text-text-muted">Booking Reference:</span>
                    <span className="font-bold text-brand-400">
                      {confirmedBooking.bookingRef || 'VAX-CONFIRMED'}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-text-muted">Patient:</span>
                    <span className="font-semibold text-text-primary">
                      {targetMember.name}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-text-muted">Vaccine:</span>
                    <span className="font-semibold text-text-primary">{vaccineName}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-text-muted">Date & Time:</span>
                    <span className="font-semibold text-text-primary">
                      {appointmentDate} • {timeSlot}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-text-muted">Center:</span>
                    <span className="font-semibold text-text-primary">{center.name}</span>
                  </div>
                </div>
              </div>

              <div className="pt-2">
                <button
                  type="button"
                  onClick={onClose}
                  className="w-full py-2.5 rounded-xl bg-brand-600 text-xs font-bold text-white shadow-glow hover:brightness-110 transition"
                >
                  Done
                </button>
              </div>
            </div>
          ) : (
            /* Booking Form */
            <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-6 space-y-4 text-xs">
              {/* Family Member */}
              <div>
                <label className="font-bold text-text-primary block mb-1.5 flex items-center gap-1">
                  <User className="w-3.5 h-3.5 text-brand-400" /> Patient / Family Member
                </label>
                <select
                  value={memberId}
                  onChange={(e) => setMemberId(e.target.value)}
                  className="w-full rounded-xl border border-border bg-surface-elevated px-3.5 py-2.5 text-xs text-text-primary focus:border-brand-500 focus:outline-none"
                >
                  {familyProfiles.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} ({p.relationship} • {p.bloodGroup || 'O+'})
                    </option>
                  ))}
                </select>
              </div>

              {/* Vaccine Selection */}
              <div>
                <label className="font-bold text-text-primary block mb-1.5 flex items-center gap-1">
                  <Syringe className="w-3.5 h-3.5 text-brand-400" /> Target Vaccine
                </label>
                <select
                  value={vaccineName}
                  onChange={(e) => setVaccineName(e.target.value)}
                  className="w-full rounded-xl border border-border bg-surface-elevated px-3.5 py-2.5 text-xs text-text-primary focus:border-brand-500 focus:outline-none"
                >
                  {center.vaccinesAvailable.map((v, i) => (
                    <option key={i} value={v}>
                      {v}
                    </option>
                  ))}
                </select>
              </div>

              {/* Date & Time Slot */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="font-bold text-text-primary block mb-1.5 flex items-center gap-1">
                    <Calendar className="w-3.5 h-3.5 text-brand-400" /> Appointment Date
                  </label>
                  <input
                    type="date"
                    required
                    min={new Date().toISOString().split('T')[0]}
                    value={appointmentDate}
                    onChange={(e) => setAppointmentDate(e.target.value)}
                    className="w-full rounded-xl border border-border bg-surface-elevated px-3.5 py-2.5 text-xs text-text-primary focus:border-brand-500 focus:outline-none"
                  />
                </div>

                <div>
                  <label className="font-bold text-text-primary block mb-1.5 flex items-center gap-1">
                    <Clock className="w-3.5 h-3.5 text-brand-400" /> Preferred Slot
                  </label>
                  <select
                    value={timeSlot}
                    onChange={(e) => setTimeSlot(e.target.value)}
                    className="w-full rounded-xl border border-border bg-surface-elevated px-3.5 py-2.5 text-xs text-text-primary focus:border-brand-500 focus:outline-none"
                  >
                    {timeSlots.map((slot, i) => (
                      <option key={i} value={slot}>
                        {slot}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Special Instructions / Notes */}
              <div>
                <label className="font-bold text-text-primary block mb-1.5">
                  Special Instructions / Allergies
                </label>
                <textarea
                  rows={2}
                  placeholder="e.g. Needs booster dose confirmation, pediatric anxiety, etc."
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  className="w-full rounded-xl border border-border bg-surface-elevated px-3.5 py-2.5 text-xs text-text-primary focus:border-brand-500 focus:outline-none"
                />
              </div>

              {/* Footer */}
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
                  className="px-6 py-2.5 rounded-xl bg-gradient-to-r from-brand-600 to-indigo-600 text-xs font-bold text-white shadow-glow hover:brightness-110 transition flex items-center gap-1.5"
                >
                  <CheckCircle2 className="w-4 h-4" />
                  {submitting ? 'Reserving...' : 'Confirm Appointment'}
                </button>
              </div>
            </form>
          )}
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
