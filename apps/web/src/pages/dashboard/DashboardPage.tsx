import { motion } from 'framer-motion';
import { PageHeader } from '@/components/shared/PageHeader';
import {
  DashboardStats,
  AdherenceCard,
  StreakCard,
  UpcomingDoseCard,
  NotificationsCard,
  LowStockCard,
  LiveTelemetryRibbon,
  NEWS2ScoreCard,
} from '@/components/dashboard';
import {
  useDashboardSummary,
  useRecentNotifications,
  useLowStockMedicines,
} from '@/hooks/useDashboard';
import { useTodayDoses } from '@/hooks/useDoseLogs';
import { useUser } from '@/store/auth.store';
import { staggerContainer, fadeUp } from '@/animations/variants';

import { VoiceAssistant } from '@/components/dashboard/VoiceAssistant';
import { VitalsSimulator } from '@/components/dashboard/VitalsSimulator';
import { env } from '@/lib/env';

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Siren, Building2, Phone, ArrowRight, Syringe, Award, BookOpen, ShieldCheck, Scan, Pill } from 'lucide-react';
import { ROUTES } from '@/constants/app';
import { formatTime } from '@/lib/date';
import { StripVerificationModal } from '@/components/doseLogs/StripVerificationModal';
import type { DoseLog } from '@/types/dose-log';

export default function DashboardPage() {
  const navigate = useNavigate();
  const user = useUser();
  const summary = useDashboardSummary();
  const notifications = useRecentNotifications(5);
  const lowStock = useLowStockMedicines();
  const todayDoses = useTodayDoses();
  const [isVerifyStripOpen, setIsVerifyStripOpen] = useState(false);
  const [verifyDose, setVerifyDose] = useState<DoseLog | null>(null);

  const nextPendingDose = todayDoses.data?.find((d) => d.status === 'PENDING' || d.status === 'SNOOZED') ?? todayDoses.data?.[0];

  const name = user?.fullName?.split(' ')[0] ?? 'there';

  return (
    <div>
      <PageHeader
        title={`Welcome back, ${name}`}
        description="Remote Patient Monitoring (RPM) Telemetry & Medication Intelligence"
      />

      {/* Live Continuous Physiological Telemetry Ribbon */}
      <LiveTelemetryRibbon />

      {/* Quick Vaccination Passport & Due Milestone Banner */}
      <div className="mb-4 rounded-2xl border border-brand-500/30 bg-gradient-to-r from-brand-950/40 via-surface/80 to-surface/60 p-4 backdrop-blur-xl shadow-lg">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-500/20 border border-brand-500/40 text-brand-400">
              <Syringe className="h-5 w-5 animate-pulse" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-sm font-bold text-text-primary">
                  Vaccination Due & Immunization Passport
                </span>
                <span className="rounded-md bg-amber-500/20 border border-amber-500/30 px-1.5 py-0.5 text-[10px] font-black uppercase text-amber-300">
                  2 Action Items
                </span>
              </div>
              <p className="text-xs text-text-secondary">
                HPV 9-Valent (Ananya) due in 15 days • Annual Flu Shot (Priya) overdue.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 w-full sm:w-auto">
            <button
              type="button"
              onClick={() => navigate(ROUTES.VACCINATIONS)}
              className="flex-1 sm:flex-initial inline-flex items-center justify-center gap-1.5 rounded-xl border border-border bg-surface px-3.5 py-2 text-xs font-semibold text-text-primary hover:bg-surface-hover hover:border-brand-500/40 transition-colors"
            >
              <Award className="w-3.5 h-3.5 text-brand-400" /> Immunization Passport
            </button>
            <button
              type="button"
              onClick={() => navigate(ROUTES.VACCINATIONS + '?tab=catalog')}
              className="flex-1 sm:flex-initial inline-flex items-center justify-center gap-1.5 rounded-xl bg-gradient-to-r from-brand-600 to-indigo-600 px-4 py-2 text-xs font-black uppercase tracking-wider text-white shadow-glow hover:brightness-110 transition-all"
            >
              <BookOpen className="w-3.5 h-3.5" /> Vaccine Catalog
            </button>
          </div>
        </div>
      </div>

      {/* Quick Emergency SOS & Hospitals Banner */}
      <div className="mb-6 rounded-2xl border border-rose-500/30 bg-gradient-to-r from-rose-950/40 via-surface/80 to-surface/60 p-4 backdrop-blur-xl shadow-lg">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-rose-500/20 border border-rose-500/40 text-rose-400">
              <Siren className="h-5 w-5 animate-pulse" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-sm font-bold text-text-primary">
                  Emergency Medical Services
                </span>
                <span className="rounded-md bg-rose-500/20 border border-rose-500/30 px-1.5 py-0.5 text-[10px] font-black uppercase text-rose-300">
                  24/7
                </span>
              </div>
              <p className="text-xs text-text-secondary">
                Find nearby certified emergency hospitals, trauma centers, and live ambulance dispatch.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 w-full sm:w-auto">
            <button
              type="button"
              onClick={() => navigate(ROUTES.HOSPITALS)}
              className="flex-1 sm:flex-initial inline-flex items-center justify-center gap-1.5 rounded-xl border border-border bg-surface px-3.5 py-2 text-xs font-semibold text-text-primary hover:bg-surface-hover hover:border-brand-500/40 transition-colors"
            >
              <Building2 className="w-3.5 h-3.5 text-brand-400" /> Nearby Hospitals
            </button>
            <button
              type="button"
              onClick={() => navigate(ROUTES.EMERGENCY)}
              className="flex-1 sm:flex-initial inline-flex items-center justify-center gap-1.5 rounded-xl bg-gradient-to-r from-red-600 to-rose-600 px-4 py-2 text-xs font-black uppercase tracking-wider text-white shadow-glow hover:brightness-110 transition-all"
            >
              <Siren className="w-3.5 h-3.5" /> SOS Emergency
            </button>
          </div>
        </div>
      </div>

      {/* Point-of-Care CDSCO Strip Verification Action Banner */}
      <div className="mb-6 rounded-2xl border border-emerald-500/30 bg-gradient-to-r from-emerald-950/40 via-surface/80 to-surface/60 p-4 backdrop-blur-xl shadow-lg">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-500/20 border border-emerald-500/40 text-emerald-400">
              <ShieldCheck className="h-5 w-5 animate-pulse" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-sm font-bold text-text-primary">
                  Point-of-Care Medicine Strip Verifier
                </span>
                <span className="rounded-md bg-emerald-500/20 border border-emerald-500/30 px-1.5 py-0.5 text-[10px] font-black uppercase text-emerald-300">
                  CDSCO & GS1 Live
                </span>
              </div>
              <p className="text-xs text-text-secondary">
                Verify your physical medicine blister strip with your laptop webcam before taking. Validates batch registry, authentic composition & expiry.
              </p>
              {nextPendingDose?.medicine && (
                <div className="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-emerald-500/10 border border-emerald-500/25 px-2.5 py-1 text-[11px] font-medium text-emerald-300">
                  <Pill className="h-3 w-3 text-emerald-400" />
                  <span>Scheduled Next: <strong className="text-white">{nextPendingDose.medicine.name}</strong> {nextPendingDose.medicine.strength ? `(${nextPendingDose.medicine.strength})` : ''} at {formatTime(nextPendingDose.scheduledAt)}</span>
                </div>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2 w-full sm:w-auto">
            <button
              type="button"
              onClick={() => {
                setVerifyDose(nextPendingDose ?? null);
                setIsVerifyStripOpen(true);
              }}
              className="w-full sm:w-auto inline-flex items-center justify-center gap-1.5 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 px-4 py-2.5 text-xs font-black uppercase tracking-wider text-white shadow-glow hover:brightness-110 transition-all cursor-pointer"
            >
              <Scan className="w-4 h-4" /> Scan {nextPendingDose?.medicine?.name ? nextPendingDose.medicine.name.split(' ')[0] : 'Strip'} with Camera
            </button>
          </div>
        </div>
      </div>

      {/* Predictive Decompensation Engine (NEWS2 Clinical Score) */}
      <div className="mb-6">
        <NEWS2ScoreCard />
      </div>

      <StripVerificationModal
        dose={verifyDose}
        open={isVerifyStripOpen}
        onClose={() => {
          setIsVerifyStripOpen(false);
          setVerifyDose(null);
        }}
      />

      <DashboardStats summary={summary.data} isLoading={summary.isLoading} />

      <motion.div
        variants={staggerContainer}
        initial="hidden"
        animate="visible"
        className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-3"
      >
        <motion.div variants={fadeUp} className="lg:col-span-2">
          <AdherenceCard summary={summary.data} isLoading={summary.isLoading} />
        </motion.div>
        <motion.div variants={fadeUp}>
          <StreakCard summary={summary.data} isLoading={summary.isLoading} />
        </motion.div>
        <motion.div variants={fadeUp}>
          <UpcomingDoseCard
            doses={todayDoses.data}
            isLoading={todayDoses.isLoading}
          />
        </motion.div>
        <motion.div variants={fadeUp}>
          <NotificationsCard
            notifications={notifications.data}
            isLoading={notifications.isLoading}
          />
        </motion.div>
        <motion.div variants={fadeUp}>
          <LowStockCard
            medicines={lowStock.data}
            isLoading={lowStock.isLoading}
          />
        </motion.div>
      </motion.div>

      <div
        className={`mt-8 grid grid-cols-1 gap-6 ${env.ENABLE_DEVTOOLS ? 'lg:grid-cols-2' : ''}`}
      >
        <VoiceAssistant />
        {env.ENABLE_DEVTOOLS && <VitalsSimulator />}
      </div>
    </div>
  );
}
