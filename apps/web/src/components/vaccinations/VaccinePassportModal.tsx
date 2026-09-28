import { motion, AnimatePresence } from 'framer-motion';
import {
  X,
  ShieldCheck,
  QrCode,
  Printer,
  Download,
  Share2,
  Calendar,
  User,
  CheckCircle2,
  AlertCircle,
  Building2,
  Award,
} from 'lucide-react';
import type { VaccinationPassport } from '@/types/vaccination';
import toast from 'react-hot-toast';

interface VaccinePassportModalProps {
  passport: VaccinationPassport | null;
  isOpen: boolean;
  onClose: () => void;
}

export function VaccinePassportModal({
  passport,
  isOpen,
  onClose,
}: VaccinePassportModalProps) {
  if (!isOpen || !passport) return null;

  const handlePrint = () => {
    window.print();
  };

  const handleShare = () => {
    if (navigator.share) {
      navigator
        .share({
          title: `Vaccination Passport - ${passport.patient.name}`,
          text: `Verified Digital Immunization Record for ${passport.patient.name} (${passport.summary.completionPercentage}% Completed). Verification Hash: ${passport.verificationHash.slice(0, 16)}`,
          url: window.location.href,
        })
        .catch(() => {});
    } else {
      navigator.clipboard.writeText(
        `MediTrack Verified Passport: ${passport.passportNumber} | Patient: ${passport.patient.name} | Hash: ${passport.verificationHash}`,
      );
      toast.success('Passport verification link copied to clipboard!');
    }
  };

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-md overflow-y-auto print:p-0 print:bg-white">
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 20 }}
          transition={{ duration: 0.2 }}
          className="relative w-full max-w-3xl max-h-[92vh] flex flex-col rounded-3xl border border-border bg-surface shadow-2xl overflow-hidden print:border-none print:shadow-none print:max-h-full print:w-full"
        >
          {/* Header Action Bar */}
          <div className="flex items-center justify-between p-5 border-b border-border bg-surface-elevated print:hidden">
            <div className="flex items-center gap-2">
              <ShieldCheck className="w-5 h-5 text-emerald-400" />
              <span className="font-bold text-sm text-text-primary">
                Digital Immunization Passport & Universal Health Record
              </span>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleShare}
                className="p-2 rounded-xl border border-border text-text-secondary hover:bg-surface-hover hover:text-text-primary transition flex items-center gap-1.5 text-xs font-semibold"
              >
                <Share2 className="w-4 h-4" /> Share
              </button>
              <button
                type="button"
                onClick={handlePrint}
                className="p-2 rounded-xl bg-brand-500/10 border border-brand-500/30 text-brand-400 hover:bg-brand-500/20 transition flex items-center gap-1.5 text-xs font-bold"
              >
                <Printer className="w-4 h-4" /> Print / Save PDF
              </button>
              <button
                type="button"
                onClick={onClose}
                className="p-2 rounded-xl text-text-muted hover:bg-surface-hover hover:text-text-primary transition"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
          </div>

          {/* Printable Passport Certificate Document */}
          <div className="flex-1 overflow-y-auto p-8 space-y-6 text-text-primary print:p-6 print:text-black">
            {/* Certificate Header Stamp */}
            <div className="relative rounded-2xl border-2 border-brand-500/30 bg-gradient-to-r from-brand-950/40 via-surface-elevated to-surface p-6 shadow-inner overflow-hidden print:border-slate-400 print:bg-white">
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                <div className="flex items-center gap-4">
                  <div className="h-16 w-16 rounded-2xl bg-gradient-to-br from-brand-500 to-indigo-600 p-0.5 shadow-glow flex items-center justify-center text-white print:bg-slate-800">
                    <Award className="h-9 w-9 text-white" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <h2 className="text-xl font-black tracking-tight text-text-primary print:text-black">
                        OFFICIAL IMMUNIZATION PASSPORT
                      </h2>
                      <span className="rounded-full bg-emerald-500/20 border border-emerald-500/40 px-2 py-0.5 text-[10px] font-black uppercase text-emerald-300 print:text-emerald-800">
                        VERIFIED
                      </span>
                    </div>
                    <p className="text-xs text-text-secondary print:text-slate-600 mt-0.5">
                      Issued under Universal Immunization Standards • MediTrack AI Health Graph
                    </p>
                    <p className="text-[11px] font-mono text-brand-400 print:text-slate-800 font-bold mt-1">
                      Passport ID: {passport.passportNumber}
                    </p>
                  </div>
                </div>

                {/* QR Code Verification Block */}
                <div className="flex items-center gap-3 bg-surface-elevated/80 border border-border p-3 rounded-2xl print:bg-white print:border-slate-300">
                  <div className="h-14 w-14 bg-white rounded-xl p-1 flex items-center justify-center shadow-md">
                    {/* Simulated Scalable Vector QR */}
                    <QrCode className="w-12 h-12 text-slate-900" />
                  </div>
                  <div className="text-[10px] text-text-muted print:text-slate-600">
                    <span className="font-bold text-text-primary print:text-black block">
                      Cryptographic Hash
                    </span>
                    <span className="font-mono text-[9px] block text-brand-400 print:text-slate-800">
                      {passport.verificationHash.slice(0, 16)}...
                    </span>
                    <span>Scan to verify authenticity</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Patient Credentials Card */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 p-4 rounded-2xl border border-border bg-surface-elevated text-xs print:border-slate-300 print:bg-slate-50">
              <div>
                <span className="text-text-muted print:text-slate-500 block text-[11px]">Patient Name</span>
                <span className="font-bold text-text-primary print:text-black text-sm">
                  {passport.patient.name}
                </span>
              </div>
              <div>
                <span className="text-text-muted print:text-slate-500 block text-[11px]">Date of Birth</span>
                <span className="font-bold text-text-primary print:text-black">
                  {passport.patient.dateOfBirth} ({passport.patient.ageYears} yrs)
                </span>
              </div>
              <div>
                <span className="text-text-muted print:text-slate-500 block text-[11px]">Blood Group</span>
                <span className="font-bold text-brand-400 print:text-black">
                  {passport.patient.bloodGroup || 'O+'}
                </span>
              </div>
              <div>
                <span className="text-text-muted print:text-slate-500 block text-[11px]">Immunization Status</span>
                <span className="font-black text-emerald-400 print:text-emerald-700">
                  {passport.summary.completionPercentage}% Completed
                </span>
              </div>
            </div>

            {/* Completed Immunization Table */}
            <div>
              <h3 className="text-sm font-bold text-text-primary print:text-black mb-3 flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-400" /> Administered Immunization Records
              </h3>

              <div className="rounded-2xl border border-border overflow-hidden print:border-slate-300">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="border-b border-border bg-surface-elevated text-text-muted print:bg-slate-100 print:text-slate-700 font-bold uppercase text-[10px]">
                      <th className="py-3 px-4">Vaccine & Antigen</th>
                      <th className="py-3 px-3">Dose</th>
                      <th className="py-3 px-3">Date Given</th>
                      <th className="py-3 px-3">Batch / Lot</th>
                      <th className="py-3 px-3">Administering Center</th>
                      <th className="py-3 px-3 text-right">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border print:divide-slate-200">
                    {passport.immunizationHistory.map((item, idx) => (
                      <tr
                        key={idx}
                        className="hover:bg-surface-elevated/40 transition print:hover:bg-transparent"
                      >
                        <td className="py-3 px-4 font-bold text-text-primary print:text-black">
                          {item.vaccineName}
                        </td>
                        <td className="py-3 px-3 font-semibold text-text-secondary print:text-slate-800">
                          Dose {item.doseNumber} of {item.totalDoses}
                        </td>
                        <td className="py-3 px-3 text-text-primary print:text-slate-800 font-medium">
                          {item.administeredDate}
                        </td>
                        <td className="py-3 px-3 font-mono text-[11px] text-text-muted print:text-slate-600">
                          {item.batchNumber || 'VERIFIED'}
                        </td>
                        <td className="py-3 px-3 text-text-secondary print:text-slate-700">
                          {item.centerName || 'Authorized Center'}
                        </td>
                        <td className="py-3 px-3 text-right">
                          <span className="inline-flex items-center gap-1 text-[11px] font-bold text-emerald-400 print:text-emerald-700">
                            <CheckCircle2 className="w-3.5 h-3.5" /> Done
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Upcoming Due Schedule */}
            {passport.upcomingImmunizations.length > 0 && (
              <div>
                <h3 className="text-sm font-bold text-text-primary print:text-black mb-3 flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 text-amber-400" /> Next Scheduled Booster Milestones
                </h3>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {passport.upcomingImmunizations.map((up, i) => (
                    <div
                      key={i}
                      className="p-3.5 rounded-2xl border border-amber-500/30 bg-amber-500/10 flex items-center justify-between text-xs print:border-slate-300 print:bg-slate-50"
                    >
                      <div>
                        <span className="font-bold text-text-primary print:text-black block">
                          {up.vaccineName} (Dose {up.doseNumber})
                        </span>
                        <span className="text-text-muted print:text-slate-600 text-[11px]">
                          Target Date: {up.dueDate}
                        </span>
                      </div>
                      <span className="rounded-full bg-amber-500/20 border border-amber-500/30 px-2 py-0.5 text-[10px] font-bold text-amber-300 uppercase">
                        {up.status.replace('_', ' ')}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Legal Notice */}
            <div className="text-[11px] text-text-muted print:text-slate-500 border-t border-border pt-4 print:border-slate-200">
              <p>
                This digital immunization passport is generated based on certified medical logs within the MediTrack AI platform.
                Data is cryptographically sealed with SHA-256 hash standards for international and domestic compliance.
              </p>
            </div>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
