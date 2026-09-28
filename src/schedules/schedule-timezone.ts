const formatterCache = new Map<string, Intl.DateTimeFormat>();

interface WallClockParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
}

function formatter(timezone: string): Intl.DateTimeFormat {
  const existing = formatterCache.get(timezone);
  if (existing) return existing;

  const created = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  formatterCache.set(timezone, created);
  return created;
}

function wallClockParts(date: Date, timezone: string): WallClockParts {
  const values = Object.fromEntries(
    formatter(timezone)
      .formatToParts(date)
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, Number(part.value)]),
  ) as Record<string, number>;

  return {
    year: values.year,
    month: values.month,
    day: values.day,
    hour: values.hour,
    minute: values.minute,
  };
}

function parseDateKey(dateKey: string): [number, number, number] | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (
    probe.getUTCFullYear() !== year ||
    probe.getUTCMonth() !== month - 1 ||
    probe.getUTCDate() !== day
  ) {
    return null;
  }
  return [year, month, day];
}

export function isValidTimezone(timezone: string): boolean {
  try {
    formatter(timezone).format(new Date());
    return true;
  } catch {
    formatterCache.delete(timezone);
    return false;
  }
}

export function dateKeyInTimezone(date: Date, timezone: string): string {
  const parts = wallClockParts(date, timezone);
  return `${String(parts.year).padStart(4, '0')}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`;
}

export function addDaysToDateKey(dateKey: string, days: number): string {
  const parsed = parseDateKey(dateKey);
  if (!parsed) throw new Error(`Invalid date key: ${dateKey}`);
  const [year, month, day] = parsed;
  const date = new Date(Date.UTC(year, month - 1, day + days));
  return date.toISOString().slice(0, 10);
}

export function dayOfWeekForDateKey(dateKey: string): number {
  const parsed = parseDateKey(dateKey);
  if (!parsed) throw new Error(`Invalid date key: ${dateKey}`);
  const [year, month, day] = parsed;
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

export function zonedDateTimeToUtc(
  dateKey: string,
  time: string,
  timezone: string,
): Date | null {
  const date = parseDateKey(dateKey);
  const timeMatch = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(time);
  if (!date || !timeMatch || !isValidTimezone(timezone)) return null;

  const [year, month, day] = date;
  const hour = Number(timeMatch[1]);
  const minute = Number(timeMatch[2]);
  const targetWallTime = Date.UTC(year, month - 1, day, hour, minute);
  let candidate = targetWallTime;

  // Iterating the observed timezone offset handles regular offsets and DST.
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const observed = wallClockParts(new Date(candidate), timezone);
    const observedWallTime = Date.UTC(
      observed.year,
      observed.month - 1,
      observed.day,
      observed.hour,
      observed.minute,
    );
    const correction = targetWallTime - observedWallTime;
    candidate += correction;
    if (correction === 0) break;
  }

  const result = new Date(candidate);
  const verified = wallClockParts(result, timezone);
  if (
    verified.year !== year ||
    verified.month !== month ||
    verified.day !== day ||
    verified.hour !== hour ||
    verified.minute !== minute
  ) {
    // A nonexistent wall-clock time during a DST jump is not scheduled.
    return null;
  }
  return result;
}

export function zonedDayBounds(
  instant: Date,
  timezone: string,
): { dateKey: string; start: Date; end: Date } {
  const dateKey = dateKeyInTimezone(instant, timezone);
  const start = zonedDateTimeToUtc(dateKey, '00:00', timezone);
  const nextDateKey = addDaysToDateKey(dateKey, 1);
  const nextStart = zonedDateTimeToUtc(nextDateKey, '00:00', timezone);
  if (!start || !nextStart) {
    throw new Error(`Unable to calculate day bounds for ${timezone}`);
  }
  return {
    dateKey,
    start,
    end: new Date(nextStart.getTime() - 1),
  };
}
