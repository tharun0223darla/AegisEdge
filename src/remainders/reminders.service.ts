import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { DoseStatus } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { DoseLogsService } from '../dose-logs/dose-logs.service';
import {
  ClientDoseActionSource,
  DoseActionStatus,
} from '../dose-logs/dto/create-dose-log.dto';
import { SchedulesService } from '../schedules/schedules.service';
import {
  dateKeyInTimezone,
  isValidTimezone,
  zonedDayBounds,
} from '../schedules/schedule-timezone';
import {
  SnoozeReminderDto,
  MAX_SNOOZE_COUNT,
  MIN_SNOOZE_MINUTES,
  MAX_SNOOZE_MINUTES,
} from './dto/snooze-remainder.dto';

// ─────────────────────────────────────────────────────────────
// ReminderStatus: the computed state of a dose log for the UI
// Not stored in DB — derived at query time.
// ─────────────────────────────────────────────────────────────
export type ReminderStatus =
  | 'DUE_NOW' // within the current minute
  | 'UPCOMING' // scheduled in the future
  | 'SNOOZED' // snoozed, reminder pending re-trigger
  | 'OVERDUE' // past scheduledAt + grace period, still PENDING
  | 'TAKEN'
  | 'MISSED'
  | 'SKIPPED';

export interface ReminderItem {
  doseLogId: string;
  medicineId: string;
  medicineName: string;
  medicineForm: string;
  strength: string | null;
  scheduleId: string;
  dosesPerIntake: number;
  unit: string;
  scheduledAt: string; // ISO string
  scheduledTime: string; // "HH:MM" for display
  status: DoseStatus;
  reminderStatus: ReminderStatus;
  snoozeUntil: string | null;
  snoozeCount: number;
  canSnooze: boolean; // false if MAX_SNOOZE_COUNT reached
  gracePeriodMinutes: number;
  minutesUntilDue: number | null; // negative = overdue
  notes: string | null;
}

@Injectable()
export class RemindersService {
  constructor(
    private prisma: PrismaService,
    private schedulesService: SchedulesService,
    private doseLogsService: DoseLogsService,
  ) {}

  // ─────────────────────────────────────────────────────────
  // TODAY TIMELINE
  // Full ordered list of all dose events for today.
  // Includes past (TAKEN/MISSED) and future (PENDING/SNOOZED).
  // ─────────────────────────────────────────────────────────
  async getTodayTimeline(
    userId: string,
    timezone = 'UTC',
  ): Promise<{
    date: string;
    summary: {
      total: number;
      taken: number;
      pending: number;
      missed: number;
      snoozed: number;
      skipped: number;
      completionPercent: number;
    };
    timeline: ReminderItem[];
  }> {
    if (!isValidTimezone(timezone)) {
      throw new BadRequestException('Timezone must be a valid IANA timezone');
    }
    const now = new Date();
    await this.schedulesService.reconcileDoseLogsForUser(userId, 2, now);
    const { start: startOfDay, end: endOfDay } = zonedDayBounds(now, timezone);

    const logs = await this.prisma.doseLog.findMany({
      where: {
        userId,
        scheduledAt: { gte: startOfDay, lte: endOfDay },
      },
      include: {
        medicine: {
          select: { id: true, name: true, form: true, strength: true },
        },
        schedule: {
          select: {
            id: true,
            dosesPerIntake: true,
            unit: true,
            gracePeriodMinutes: true,
          },
        },
      },
      orderBy: { scheduledAt: 'asc' },
    });

    const timeline = logs.map((log) => this.toReminderItem(log, now));

    // Summary counts — only finalized doses count towards completion
    const finalized = timeline.filter(
      (t) => t.status !== DoseStatus.PENDING && t.status !== DoseStatus.SNOOZED,
    );
    const taken = finalized.filter((t) => t.status === DoseStatus.TAKEN).length;
    const missed = finalized.filter(
      (t) => t.status === DoseStatus.MISSED,
    ).length;
    const skipped = finalized.filter(
      (t) => t.status === DoseStatus.SKIPPED,
    ).length;
    const pending = timeline.filter(
      (t) => t.status === DoseStatus.PENDING,
    ).length;
    const snoozed = timeline.filter(
      (t) => t.status === DoseStatus.SNOOZED,
    ).length;
    const total = timeline.length;

    // Guard: avoid division by zero
    const denominator = finalized.length;
    const completionPercent =
      denominator > 0 ? Math.round((taken / denominator) * 100) : 0;

    return {
      date: dateKeyInTimezone(now, timezone),
      summary: {
        total,
        taken,
        missed,
        pending,
        snoozed,
        skipped,
        completionPercent,
      },
      timeline,
    };
  }

  // ─────────────────────────────────────────────────────────
  // DUE NOW
  // Doses scheduled within ±5 minutes of current time
  // that are still PENDING (or SNOOZED with snoozeUntil <= now)
  // ─────────────────────────────────────────────────────────
  async getDueNow(userId: string): Promise<ReminderItem[]> {
    const now = new Date();
    const windowStart = new Date(now.getTime() - 5 * 60 * 1000); // 5 min ago
    const windowEnd = new Date(now.getTime() + 5 * 60 * 1000); // 5 min ahead

    const logs = await this.prisma.doseLog.findMany({
      where: {
        userId,
        OR: [
          // Normal PENDING doses in the ±5 min window
          {
            status: DoseStatus.PENDING,
            scheduledAt: { gte: windowStart, lte: windowEnd },
          },
          // SNOOZED doses whose snooze has now expired
          {
            status: DoseStatus.SNOOZED,
            snoozeUntil: { lte: now },
          },
        ],
      },
      include: {
        medicine: {
          select: { id: true, name: true, form: true, strength: true },
        },
        schedule: {
          select: {
            id: true,
            dosesPerIntake: true,
            unit: true,
            gracePeriodMinutes: true,
          },
        },
      },
      orderBy: { scheduledAt: 'asc' },
    });

    return logs.map((log) => this.toReminderItem(log, now));
  }

  // ─────────────────────────────────────────────────────────
  // UPCOMING
  // Future PENDING doses for today and tomorrow
  // starting from now + 5 min (to exclude DUE_NOW window)
  // ─────────────────────────────────────────────────────────
  async getUpcoming(userId: string, hoursAhead = 24): Promise<ReminderItem[]> {
    const now = new Date();
    const from = new Date(now.getTime() + 5 * 60 * 1000); // skip DUE_NOW window
    const to = new Date(
      now.getTime() + Math.min(hoursAhead, 48) * 60 * 60 * 1000,
    );

    const logs = await this.prisma.doseLog.findMany({
      where: {
        userId,
        status: DoseStatus.PENDING,
        scheduledAt: { gte: from, lte: to },
      },
      include: {
        medicine: {
          select: { id: true, name: true, form: true, strength: true },
        },
        schedule: {
          select: {
            id: true,
            dosesPerIntake: true,
            unit: true,
            gracePeriodMinutes: true,
          },
        },
      },
      orderBy: { scheduledAt: 'asc' },
      take: 20, // cap: no need to return more than 20 upcoming
    });

    return logs.map((log) => this.toReminderItem(log, now));
  }

  // ─────────────────────────────────────────────────────────
  // OVERDUE
  // PENDING doses past scheduledAt + gracePeriodMinutes
  // These will be auto-marked MISSED by cron — shown here so
  // patient can still act on them manually before the cron runs
  // ─────────────────────────────────────────────────────────
  async getOverdue(userId: string): Promise<ReminderItem[]> {
    const now = new Date();

    // Fetch all PENDING logs in the past (before now)
    // We can't filter by gracePeriod in SQL efficiently since it's per-schedule,
    // so we fetch past PENDING and filter in JS
    const logs = await this.prisma.doseLog.findMany({
      where: {
        userId,
        status: DoseStatus.PENDING,
        scheduledAt: { lt: now },
      },
      include: {
        medicine: {
          select: { id: true, name: true, form: true, strength: true },
        },
        schedule: {
          select: {
            id: true,
            dosesPerIntake: true,
            unit: true,
            gracePeriodMinutes: true,
          },
        },
      },
      orderBy: { scheduledAt: 'desc' },
      take: 50,
    });

    // Filter: only return doses that are past their grace period
    const overdue = logs.filter((log) => {
      const gracePeriod = log.schedule.gracePeriodMinutes ?? 60;
      const deadline = new Date(
        log.scheduledAt.getTime() + gracePeriod * 60 * 1000,
      );
      return now > deadline;
    });

    return overdue.map((log) => this.toReminderItem(log, now));
  }

  // ─────────────────────────────────────────────────────────
  // SNOOZE
  // Snooze a specific dose log for N minutes
  // Enforces: max snooze count, valid future time, ownership
  // ─────────────────────────────────────────────────────────
  async snooze(
    userId: string,
    doseLogId: string,
    dto: SnoozeReminderDto,
  ): Promise<ReminderItem> {
    // 1. Load the dose log with ownership check
    const doseLog = await this.prisma.doseLog.findUnique({
      where: { id: doseLogId },
      include: {
        medicine: {
          select: { id: true, name: true, form: true, strength: true },
        },
        schedule: {
          select: {
            id: true,
            dosesPerIntake: true,
            unit: true,
            gracePeriodMinutes: true,
            isActive: true,
          },
        },
      },
    });

    if (!doseLog) throw new NotFoundException('Dose log not found');
    if (doseLog.userId !== userId) {
      throw new ForbiddenException(
        'You do not have permission to snooze this reminder',
      );
    }

    // 2. Only PENDING or SNOOZED logs can be snoozed
    if (
      doseLog.status !== DoseStatus.PENDING &&
      doseLog.status !== DoseStatus.SNOOZED
    ) {
      throw new BadRequestException(
        `Cannot snooze a dose with status "${doseLog.status}". ` +
          'Only PENDING or SNOOZED doses can be snoozed.',
      );
    }

    // 3. Enforce snooze count limit
    if (doseLog.snoozeCount >= MAX_SNOOZE_COUNT) {
      throw new BadRequestException(
        `This dose has been snoozed ${doseLog.snoozeCount} time(s). ` +
          `Maximum snooze limit (${MAX_SNOOZE_COUNT}) reached. ` +
          'Please mark it as TAKEN or MISSED.',
      );
    }

    // 4. Calculate snoozeUntil
    const now = new Date();
    let snoozeUntil: Date;

    if (dto.snoozeUntil) {
      snoozeUntil = new Date(dto.snoozeUntil);
    } else if (dto.snoozeMinutes) {
      snoozeUntil = new Date(now.getTime() + dto.snoozeMinutes * 60 * 1000);
    } else {
      // Default: 15-minute snooze
      snoozeUntil = new Date(now.getTime() + 15 * 60 * 1000);
    }

    // 5. Validate snoozeUntil is in the future
    if (snoozeUntil <= now) {
      throw new BadRequestException('snoozeUntil must be in the future');
    }

    // 6. Validate snoozeUntil is not too far ahead (max MAX_SNOOZE_MINUTES)
    const maxAllowed = new Date(now.getTime() + MAX_SNOOZE_MINUTES * 60 * 1000);
    if (snoozeUntil > maxAllowed) {
      throw new BadRequestException(
        `Snooze cannot exceed ${MAX_SNOOZE_MINUTES} minutes from now.`,
      );
    }

    // 7. Check grace period — if dose is past deadline, warn but allow (patient choice)
    await this.doseLogsService.recordAction(userId, {
      clientActionId: randomUUID(),
      scheduleId: doseLog.scheduleId,
      scheduledAt: doseLog.scheduledAt.toISOString(),
      status: DoseActionStatus.SNOOZED,
      source: ClientDoseActionSource.APP,
      snoozeUntil: snoozeUntil.toISOString(),
      notes: dto.notes ?? doseLog.notes ?? undefined,
    });

    const updated = await this.prisma.doseLog.findUniqueOrThrow({
      where: { id: doseLogId },
      include: {
        medicine: {
          select: { id: true, name: true, form: true, strength: true },
        },
        schedule: {
          select: {
            id: true,
            dosesPerIntake: true,
            unit: true,
            gracePeriodMinutes: true,
          },
        },
      },
    });

    return this.toReminderItem(updated, now);
  }

  // ─────────────────────────────────────────────────────────
  // WEEKLY REMINDER SUMMARY
  // 7-day overview: which days had full/partial/zero adherence
  // Used for the weekly summary screen
  // ─────────────────────────────────────────────────────────
  async getWeeklySummary(userId: string): Promise<{
    weekStart: string;
    weekEnd: string;
    days: {
      date: string;
      dayName: string;
      total: number;
      taken: number;
      missed: number;
      adherencePercent: number;
      status: 'full' | 'partial' | 'none' | 'no_doses';
    }[];
    weeklyAdherencePercent: number;
  }> {
    const now = new Date();
    // Week: last 7 days including today
    const weekEnd = new Date(now);
    weekEnd.setHours(23, 59, 59, 999);
    const weekStart = new Date(now);
    weekStart.setDate(weekStart.getDate() - 6);
    weekStart.setHours(0, 0, 0, 0);

    const logs = await this.prisma.doseLog.findMany({
      where: {
        userId,
        scheduledAt: { gte: weekStart, lte: weekEnd },
        status: { not: DoseStatus.PENDING },
      },
      select: { scheduledAt: true, status: true },
      orderBy: { scheduledAt: 'asc' },
    });

    // Group by date
    const byDate: Record<
      string,
      { taken: number; missed: number; snoozed: number; skipped: number }
    > = {};
    for (const log of logs) {
      const key = log.scheduledAt.toISOString().split('T')[0];
      if (!byDate[key])
        byDate[key] = { taken: 0, missed: 0, snoozed: 0, skipped: 0 };
      const k = log.status.toLowerCase() as
        | 'taken'
        | 'missed'
        | 'snoozed'
        | 'skipped';
      byDate[key][k]++;
    }

    const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    type WeeklyDay = {
      date: string;
      dayName: string;
      total: number;
      taken: number;
      missed: number;
      adherencePercent: number;
      status: 'full' | 'partial' | 'none' | 'no_doses';
    };

    const days: WeeklyDay[] = [];
    let weeklyTaken = 0;
    let weeklyTotal = 0;

    for (let i = 0; i < 7; i++) {
      const d = new Date(weekStart);
      d.setDate(d.getDate() + i);
      const key = d.toISOString().split('T')[0];
      const data = byDate[key];

      if (!data) {
        days.push({
          date: key,
          dayName: dayNames[d.getDay()],
          total: 0,
          taken: 0,
          missed: 0,
          adherencePercent: 0,
          status: 'no_doses' as const,
        });
        continue;
      }

      const total = data.taken + data.missed + data.snoozed + data.skipped;
      const adherencePercent =
        total > 0 ? Math.round((data.taken / total) * 100) : 0;
      weeklyTaken += data.taken;
      weeklyTotal += total;

      days.push({
        date: key,
        dayName: dayNames[d.getDay()],
        total,
        taken: data.taken,
        missed: data.missed,
        adherencePercent,
        status: (total === 0
          ? 'no_doses'
          : data.taken === total
            ? 'full'
            : data.taken === 0
              ? 'none'
              : 'partial') as 'full' | 'partial' | 'none' | 'no_doses',
      });
    }

    return {
      weekStart: weekStart.toISOString().split('T')[0],
      weekEnd: weekEnd.toISOString().split('T')[0],
      days,
      weeklyAdherencePercent:
        weeklyTotal > 0 ? Math.round((weeklyTaken / weeklyTotal) * 100) : 0,
    };
  }

  // ─────────────────────────────────────────────────────────
  // INTERNAL: Convert a DoseLog DB record → ReminderItem
  // Pure function — no DB calls
  // ─────────────────────────────────────────────────────────
  private toReminderItem(
    log: {
      id: string;
      medicineId: string;
      scheduleId: string;
      scheduledAt: Date;
      status: DoseStatus;
      snoozeUntil: Date | null;
      snoozeCount: number;
      notes: string | null;
      medicine: {
        id: string;
        name: string;
        form: string;
        strength: string | null;
      };
      schedule: {
        id: string;
        dosesPerIntake: number;
        unit: string;
        gracePeriodMinutes: number;
      };
    },
    now: Date,
  ): ReminderItem {
    const minutesUntilDue = Math.round(
      (log.scheduledAt.getTime() - now.getTime()) / 60000,
    );

    const gracePeriod = log.schedule.gracePeriodMinutes ?? 60;
    const deadline = new Date(
      log.scheduledAt.getTime() + gracePeriod * 60 * 1000,
    );
    const isPastDeadline = now > deadline;

    let reminderStatus: ReminderStatus;
    switch (log.status) {
      case DoseStatus.TAKEN:
        reminderStatus = 'TAKEN';
        break;
      case DoseStatus.MISSED:
        reminderStatus = 'MISSED';
        break;
      case DoseStatus.SKIPPED:
        reminderStatus = 'SKIPPED';
        break;
      case DoseStatus.SNOOZED:
        reminderStatus = 'SNOOZED';
        break;
      case DoseStatus.PENDING:
        if (isPastDeadline) {
          reminderStatus = 'OVERDUE';
        } else if (Math.abs(minutesUntilDue) <= 5) {
          reminderStatus = 'DUE_NOW';
        } else {
          reminderStatus = 'UPCOMING';
        }
        break;
    }

    const scheduledAt = log.scheduledAt;
    const scheduledTime = `${String(scheduledAt.getHours()).padStart(2, '0')}:${String(
      scheduledAt.getMinutes(),
    ).padStart(2, '0')}`;

    return {
      doseLogId: log.id,
      medicineId: log.medicine.id,
      medicineName: log.medicine.name,
      medicineForm: log.medicine.form,
      strength: log.medicine.strength,
      scheduleId: log.schedule.id,
      dosesPerIntake: log.schedule.dosesPerIntake,
      unit: log.schedule.unit,
      scheduledAt: scheduledAt.toISOString(),
      scheduledTime,
      status: log.status,
      reminderStatus,
      snoozeUntil: log.snoozeUntil ? log.snoozeUntil.toISOString() : null,
      snoozeCount: log.snoozeCount,
      canSnooze:
        log.snoozeCount < MAX_SNOOZE_COUNT &&
        (log.status === DoseStatus.PENDING ||
          log.status === DoseStatus.SNOOZED),
      gracePeriodMinutes: gracePeriod,
      minutesUntilDue,
      notes: log.notes,
    };
  }

  // ─────────────────────────────────────────────────────────
  // Helper: day bounds in UTC
  // ─────────────────────────────────────────────────────────
}
