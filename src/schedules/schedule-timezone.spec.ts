import {
  addDaysToDateKey,
  dateKeyInTimezone,
  isValidTimezone,
  zonedDateTimeToUtc,
  zonedDayBounds,
} from './schedule-timezone';

describe('schedule timezone helpers', () => {
  it('converts an India wall-clock dose time to UTC', () => {
    expect(
      zonedDateTimeToUtc('2026-07-29', '08:00', 'Asia/Kolkata')?.toISOString(),
    ).toBe('2026-07-29T02:30:00.000Z');
  });

  it('handles DST offsets and rejects nonexistent wall-clock times', () => {
    expect(
      zonedDateTimeToUtc(
        '2026-01-15',
        '08:00',
        'America/New_York',
      )?.toISOString(),
    ).toBe('2026-01-15T13:00:00.000Z');
    expect(
      zonedDateTimeToUtc('2026-03-08', '02:30', 'America/New_York'),
    ).toBeNull();
  });

  it('calculates timezone-local day boundaries across DST', () => {
    const bounds = zonedDayBounds(
      new Date('2026-11-01T16:00:00.000Z'),
      'America/New_York',
    );
    expect(bounds.dateKey).toBe('2026-11-01');
    expect(bounds.start.toISOString()).toBe('2026-11-01T04:00:00.000Z');
    expect(bounds.end.toISOString()).toBe('2026-11-02T04:59:59.999Z');
  });

  it('supports stable date-key arithmetic and timezone validation', () => {
    expect(addDaysToDateKey('2026-12-31', 1)).toBe('2027-01-01');
    expect(
      dateKeyInTimezone(new Date('2026-07-28T20:00:00.000Z'), 'Asia/Kolkata'),
    ).toBe('2026-07-29');
    expect(isValidTimezone('Asia/Kolkata')).toBe(true);
    expect(isValidTimezone('Not/A_Timezone')).toBe(false);
  });
});
