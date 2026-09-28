import { useState } from 'react';
import {
  AlarmClock,
  Camera,
  Check,
  CircleHelp,
  Clock3,
  MessageSquareText,
  Scan,
  ShieldCheck,
  X,
} from 'lucide-react';
import { format, parseISO } from 'date-fns';
import {
  useDoseAction,
  useDoseHelpRequest,
  useTodayDoses,
} from '@/hooks/useDoseLogs';
import { Badge } from '@/components/ui/Badge';
import { Spinner } from '@/components/ui/Spinner';
import { Button } from '@/components/ui/Button';
import type {
  DoseLog,
  DoseOccurrenceState,
  DoseStatus,
} from '@/types/dose-log';
import type { DoseHelpRequestResult } from '@/types/care';
import { DoseBarrierReasonPicker } from './DoseBarrierReasonPicker';
import { StripVerificationModal } from './StripVerificationModal';
import { doseBarrierLabel } from '@/constants/adherence-barriers';

const statusMeta = {
  UPCOMING: ['Upcoming', 'muted'],
  DUE: ['Due now', 'info'],
  OVERDUE: ['Action needed', 'warning'],
  TAKEN: ['Taken', 'success'],
  MISSED: ['Missed', 'danger'],
  SNOOZED: ['Snoozed', 'warning'],
  SKIPPED: ['Skipped', 'muted'],
} as const;

export function TodayDoseTimeline() {
  const today = useTodayDoses();
  const action = useDoseAction();
  const help = useDoseHelpRequest();
  const doses = today.data ?? [];
  const record = (dose: DoseLog, status: DoseStatus) =>
    action.mutate({
      scheduleId: dose.scheduleId,
      scheduledAt: dose.scheduledAt,
      status,
      source: 'APP',
      snoozeUntil:
        status === 'SNOOZED'
          ? new Date(Date.now() + 10 * 60 * 1000).toISOString()
          : undefined,
    });

  return (
    <section className="border border-slate-800 bg-slate-900 p-5 shadow-xl">
      <header className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Today's Pharmacological Telemetry</h2>
          <p className="text-sm text-text-muted">
            {doses.length
              ? `${doses.filter((d) => d.status === 'TAKEN').length} of ${doses.length} doses confirmed taken`
              : 'No scheduled doses today.'}
          </p>
        </div>
        <Clock3 className="h-5 w-5 text-brand-400" />
      </header>
      {today.isLoading ? (
        <div className="flex justify-center py-8">
          <Spinner size="lg" />
        </div>
      ) : null}
      {today.isError ? (
        <p className="mt-4 text-sm text-danger">
          Today&apos;s doses could not be loaded.
        </p>
      ) : null}
      <div className="mt-4 divide-y divide-slate-800">
        {doses.map((dose) => (
          <DoseRow
            key={dose.id}
            dose={dose}
            busy={
              action.isPending &&
              action.variables?.scheduleId === dose.scheduleId &&
              action.variables?.scheduledAt === dose.scheduledAt
            }
            helpBusy={help.isPending && help.variables === dose.id}
            record={record}
            requestHelp={(doseLogId, onSuccess) =>
              help.mutate(doseLogId, { onSuccess })
            }
          />
        ))}
      </div>
    </section>
  );
}

interface DoseRowProps {
  dose: DoseLog;
  busy: boolean;
  helpBusy: boolean;
  record: (dose: DoseLog, status: DoseStatus) => void;
  requestHelp: (
    doseLogId: string,
    onSuccess: (result: DoseHelpRequestResult) => void,
  ) => void;
}

function DoseRow({ dose, busy, helpBusy, record, requestHelp }: DoseRowProps) {
  const [helpOpen, setHelpOpen] = useState(false);
  const [helpSent, setHelpSent] = useState(false);
  const [barrierOpen, setBarrierOpen] = useState(false);
  const [verifyOpen, setVerifyOpen] = useState(false);
  const occurrenceState = resolveOccurrenceState(dose);
  const meta = statusMeta[occurrenceState];
  const actionable =
    dose.isActionable ??
    (dose.status === 'PENDING' || dose.status === 'SNOOZED');
  const checkInRequested =
    helpSent ||
    ['PENDING', 'PROCESSING', 'SENT'].includes(dose.helpRequest?.status ?? '');
  const canRecordBarrier = ['MISSED', 'SKIPPED'].includes(dose.status);
  return (
    <article className="py-4">
      <div className="grid gap-3 md:grid-cols-[110px_minmax(0,1fr)_auto] md:items-center">
        <time className="font-semibold">
          {format(parseISO(dose.scheduledAt), 'hh:mm a')}
        </time>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <strong className="truncate">
              {dose.medicine?.name ?? 'Medicine'}
            </strong>
            <Badge tone={meta[1]} dot>
              {meta[0]}
            </Badge>
          </div>
          <p className="text-sm text-text-muted">
            {[dose.medicine?.strength, dose.medicine?.form]
              .filter(Boolean)
              .join(' / ')}
          </p>
          <p className="mt-1 text-xs text-text-muted">
            {stateDescription(dose, occurrenceState)}
          </p>
        </div>
        {actionable ? (
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              onClick={() => setVerifyOpen(true)}
              className="bg-gradient-to-r from-emerald-600 to-teal-600 hover:brightness-110 text-white font-bold shadow-md"
              title="Verify physical blister pack via OCR before swallowing"
            >
              <Scan className="h-4 w-4 mr-1" /> Verify Strip
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => record(dose, 'TAKEN')}
              disabled={busy}
              title="Mark as taken"
            >
              <Check className="h-4 w-4" /> Taken
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => record(dose, 'SNOOZED')}
              disabled={busy || (dose.snoozeCount ?? 0) >= 3}
              title="Remind in 10 minutes"
            >
              <AlarmClock className="h-4 w-4" /> 10 min
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => record(dose, 'SKIPPED')}
              disabled={busy}
              title="Record as skipped"
            >
              <X className="h-4 w-4" /> Skip
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setHelpOpen((open) => !open)}
              disabled={helpBusy || checkInRequested}
              title="Request a caregiver check-in"
            >
              <CircleHelp className="h-4 w-4" />
              {checkInRequested ? 'Check-in requested' : 'Need help'}
            </Button>
          </div>
        ) : canRecordBarrier ? (
          <Button
            size="sm"
            variant="outline"
            onClick={() => setBarrierOpen(true)}
            title="Record why this dose was not taken"
          >
            <MessageSquareText className="h-4 w-4" />
            {doseBarrierLabel(dose.barrierReason)}
          </Button>
        ) : null}
      </div>

      <StripVerificationModal
        dose={dose}
        open={verifyOpen}
        onClose={() => setVerifyOpen(false)}
        onVerifiedTaken={() => record(dose, 'TAKEN')}
      />
      {helpOpen && !checkInRequested ? (
        <div className="mt-3 border-l-2 border-warning bg-warning/5 px-4 py-3 text-sm">
          <p className="font-medium text-text-primary">
            Request a caregiver check-in?
          </p>
          <p className="mt-1 text-text-muted">
            This sends a privacy-safe alert only to caregivers you authorized
            for dose help. It does not contact emergency services or provide
            medical advice.
          </p>
          <p className="mt-2 text-text-muted">
            For severe symptoms or an emergency, contact local emergency
            services now.
          </p>
          <div className="mt-3 flex gap-2">
            <Button
              size="sm"
              onClick={() =>
                requestHelp(dose.id, (result) => {
                  setHelpSent(result.eligibleCaregivers > 0);
                  setHelpOpen(false);
                })
              }
              disabled={helpBusy}
            >
              Request check-in
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setHelpOpen(false)}
              disabled={helpBusy}
            >
              Cancel
            </Button>
          </div>
        </div>
      ) : null}
      <DoseBarrierReasonPicker
        doseLogId={dose.id}
        currentReason={dose.barrierReason}
        open={barrierOpen}
        onClose={() => setBarrierOpen(false)}
      />
    </article>
  );
}

function resolveOccurrenceState(dose: DoseLog): DoseOccurrenceState {
  if (dose.occurrenceState) return dose.occurrenceState;
  if (dose.status === 'PENDING') return 'DUE';
  return dose.status;
}

function stateDescription(dose: DoseLog, state: DoseOccurrenceState): string {
  if (state === 'SNOOZED' && dose.effectiveDueAt) {
    return `Reminder returns at ${format(parseISO(dose.effectiveDueAt), 'hh:mm a')}.`;
  }
  if (state === 'UPCOMING') {
    const minutes = Math.max(1, dose.minutesUntilDue ?? 1);
    return `Scheduled in about ${minutes} minute${minutes === 1 ? '' : 's'}.`;
  }
  if (state === 'OVERDUE' && dose.graceEndsAt) {
    return `Still within the response window until ${format(parseISO(dose.graceEndsAt), 'hh:mm a')}.`;
  }
  if (state === 'DUE') return 'Confirm, snooze, or skip this dose.';
  if (state === 'TAKEN') return 'Recorded as taken.';
  if (state === 'MISSED')
    return 'Recorded as missed after the response window.';
  return 'Recorded as skipped.';
}
