import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CalendarClock, Pill, ArrowRight, Check, Scan } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card';
import { Skeleton } from '@/components/ui/Skeleton';
import { EmptyState } from '@/components/ui/EmptyState';
import { Badge } from '@/components/ui/Badge';
import { formatTime, smartDay } from '@/lib/date';
import { ROUTES } from '@/constants/app';
import { useDoseAction } from '@/hooks/useDoseLogs';
import type { DoseLog } from '@/types/dose-log';
import { StripVerificationModal } from '@/components/doseLogs/StripVerificationModal';

interface UpcomingDoseCardProps {
  doses?: DoseLog[];
  isLoading?: boolean;
}

/** Renders the next pending doses with direct workable actions. */
export function UpcomingDoseCard({ doses, isLoading }: UpcomingDoseCardProps) {
  const navigate = useNavigate();
  const action = useDoseAction();
  const [verifyDose, setVerifyDose] = useState<DoseLog | null>(null);
  const [verifyOpen, setVerifyOpen] = useState(false);

  const upcoming = (doses ?? []).filter((d) => d.status === 'PENDING' || d.status === 'SNOOZED').slice(0, 5);

  const handleTakeQuick = (dose: DoseLog, e: React.MouseEvent) => {
    e.stopPropagation();
    action.mutate({
      scheduleId: dose.scheduleId,
      scheduledAt: dose.scheduledAt,
      status: 'TAKEN',
      source: 'APP',
    });
  };

  return (
    <Card className="flex flex-col justify-between">
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle className="flex items-center gap-2">
          <CalendarClock className="h-4 w-4 text-brand-400" /> Upcoming doses
        </CardTitle>
        <button
          type="button"
          onClick={() => navigate(ROUTES.DOSE_LOGS)}
          className="inline-flex items-center gap-1 text-xs font-semibold text-brand-400 hover:text-brand-300 transition-colors"
        >
          <span>Timeline</span>
          <ArrowRight className="h-3.5 w-3.5" />
        </button>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        {isLoading ? (
          Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-14 w-full" />)
        ) : upcoming.length === 0 ? (
          <div className="text-center py-6">
            <EmptyState
              title="No upcoming doses"
              description="You're all caught up for right now."
              className="border-none py-2"
            />
            <button
              type="button"
              onClick={() => navigate(ROUTES.DOSE_LOGS)}
              className="mt-3 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-border bg-surface text-xs font-semibold text-text-primary hover:bg-surface-hover hover:border-brand-500/40 transition-colors"
            >
              <span>View Today's Dose Timeline</span>
              <ArrowRight className="h-3.5 w-3.5" />
            </button>
          </div>
        ) : (
          upcoming.map((dose) => (
            <div
              key={dose.id}
              onClick={() => navigate(ROUTES.DOSE_LOGS)}
              className="flex items-center justify-between rounded-xl border border-border bg-surface-raised px-3 py-2.5 hover:border-brand-500/40 hover:bg-surface-hover cursor-pointer transition-all group"
            >
              <div className="flex items-center gap-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-500/12 text-brand-400 group-hover:bg-brand-500/20 group-hover:text-brand-300 transition-colors">
                  <Pill className="h-4 w-4" />
                </div>
                <div>
                  <p className="text-sm font-medium text-text-primary">{dose.medicine?.name ?? 'Medicine'}</p>
                  <p className="text-xs text-text-muted">{smartDay(dose.scheduledAt)}</p>
                </div>
              </div>
              <div className="flex items-center gap-1.5">
                <Badge tone="brand">{formatTime(dose.scheduledAt)}</Badge>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setVerifyDose(dose);
                    setVerifyOpen(true);
                  }}
                  className="px-2 py-1 rounded-lg bg-emerald-600/20 border border-emerald-500/40 text-emerald-400 hover:bg-emerald-600 hover:text-white transition-colors text-[11px] font-bold flex items-center gap-1"
                  title="Verify physical blister strip with camera before taking"
                >
                  <Scan className="h-3 w-3" />
                  <span>Verify</span>
                </button>
                <button
                  type="button"
                  onClick={(e) => handleTakeQuick(dose, e)}
                  disabled={action.isPending}
                  className="p-1.5 rounded-lg bg-slate-800 border border-slate-700 text-slate-300 hover:bg-emerald-600 hover:text-white hover:border-emerald-500 transition-colors"
                  title="Mark Taken Immediately"
                >
                  <Check className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          ))
        )}
      </CardContent>

      <StripVerificationModal
        dose={verifyDose}
        open={verifyOpen}
        onClose={() => setVerifyOpen(false)}
        onVerifiedTaken={() => {
          if (verifyDose) {
            action.mutate({
              scheduleId: verifyDose.scheduleId,
              scheduledAt: verifyDose.scheduledAt,
              status: 'TAKEN',
              source: 'APP',
            });
          }
        }}
      />
    </Card>
  );
}
