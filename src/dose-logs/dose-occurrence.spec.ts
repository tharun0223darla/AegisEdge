import { doseMissDeadline, doseOccurrenceState } from './dose-occurrence';

describe('dose occurrence state', () => {
  const scheduledAt = new Date('2026-08-14T08:00:00.000Z');

  it('uses the configured grace period for the missed-dose deadline', () => {
    expect(
      doseMissDeadline({ scheduledAt, gracePeriodMinutes: 30 }).toISOString(),
    ).toBe('2026-08-14T08:30:00.000Z');
  });

  it('does not mark a long snooze missed before the snooze expires', () => {
    expect(
      doseMissDeadline({
        scheduledAt,
        gracePeriodMinutes: 60,
        snoozeUntil: new Date('2026-08-14T10:00:00.000Z'),
      }).toISOString(),
    ).toBe('2026-08-14T10:00:00.000Z');
  });

  it('reports an expired snooze as due and then overdue', () => {
    const occurrence = {
      scheduledAt,
      gracePeriodMinutes: 60,
      snoozeUntil: new Date('2026-08-14T08:10:00.000Z'),
      status: 'SNOOZED' as const,
    };
    expect(
      doseOccurrenceState(occurrence, new Date('2026-08-14T08:11:00.000Z')),
    ).toBe('DUE');
    expect(
      doseOccurrenceState(occurrence, new Date('2026-08-14T08:30:00.000Z')),
    ).toBe('OVERDUE');
  });
});
