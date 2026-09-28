import {
  format,
  formatDistanceToNowStrict,
  isToday,
  isTomorrow,
  isYesterday,
  parseISO,
} from 'date-fns';

/** Safely parse an ISO string or Date. Returns null on bad input. */
export function safeDate(value: string | Date | null | undefined): Date | null {
  if (!value) return null;
  try {
    const d = typeof value === 'string' ? parseISO(value) : value;
    return Number.isNaN(d.getTime()) ? null : d;
  } catch {
    return null;
  }
}

export function formatDateTime(value: string | Date | null | undefined): string {
  const d = safeDate(value);
  if (!d) return '—';
  return format(d, "MMM d, yyyy 'at' h:mm a");
}

export function formatDate(value: string | Date | null | undefined): string {
  const d = safeDate(value);
  if (!d) return '—';
  return format(d, 'MMM d, yyyy');
}

export function formatTime(value: string | Date | null | undefined): string {
  const d = safeDate(value);
  if (!d) return '—';
  return format(d, 'h:mm a');
}

export function smartDay(value: string | Date | null | undefined): string {
  const d = safeDate(value);
  if (!d) return '—';
  if (isToday(d)) return 'Today';
  if (isTomorrow(d)) return 'Tomorrow';
  if (isYesterday(d)) return 'Yesterday';
  return format(d, 'EEE, MMM d');
}

export function relativeTime(value: string | Date | null | undefined): string {
  const d = safeDate(value);
  if (!d) return '—';
  return formatDistanceToNowStrict(d, { addSuffix: true });
}
