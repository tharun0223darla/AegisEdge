export type DoseOccurrenceState =
  | 'UPCOMING'
  | 'DUE'
  | 'OVERDUE'
  | 'SNOOZED'
  | 'TAKEN'
  | 'MISSED'
  | 'SKIPPED';

interface DoseTiming {
  scheduledAt: Date;
  gracePeriodMinutes: number | null | undefined;
  snoozeUntil?: Date | null;
}

interface DoseOccurrence extends DoseTiming {
  status: 'PENDING' | 'TAKEN' | 'MISSED' | 'SNOOZED' | 'SKIPPED';
}

const DUE_WINDOW_MINUTES = 15;
const DEFAULT_GRACE_MINUTES = 60;

export function doseMissDeadline(timing: DoseTiming): Date {
  const graceMinutes = Math.min(
    Math.max(timing.gracePeriodMinutes ?? DEFAULT_GRACE_MINUTES, 15),
    24 * 60,
  );
  const graceDeadline = new Date(
    timing.scheduledAt.getTime() + graceMinutes * 60_000,
  );
  if (
    timing.snoozeUntil &&
    timing.snoozeUntil.getTime() > graceDeadline.getTime()
  ) {
    return timing.snoozeUntil;
  }
  return graceDeadline;
}

export function doseOccurrenceState(
  occurrence: DoseOccurrence,
  now = new Date(),
): DoseOccurrenceState {
  if (occurrence.status === 'TAKEN') return 'TAKEN';
  if (occurrence.status === 'MISSED') return 'MISSED';
  if (occurrence.status === 'SKIPPED') return 'SKIPPED';

  if (
    occurrence.status === 'SNOOZED' &&
    occurrence.snoozeUntil &&
    occurrence.snoozeUntil.getTime() > now.getTime()
  ) {
    return 'SNOOZED';
  }

  const effectiveDueAt =
    occurrence.status === 'SNOOZED' && occurrence.snoozeUntil
      ? occurrence.snoozeUntil
      : occurrence.scheduledAt;
  if (now.getTime() < effectiveDueAt.getTime()) return 'UPCOMING';
  if (now.getTime() <= effectiveDueAt.getTime() + DUE_WINDOW_MINUTES * 60_000) {
    return 'DUE';
  }
  return 'OVERDUE';
}
