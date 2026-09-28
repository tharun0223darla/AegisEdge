import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  Logger,
  Optional,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { MedicinesService } from '../medicines/medicines.service';
import { CreateScheduleDto } from './dto/create-schedule.dto';
import { UpdateScheduleDto } from './dto/update-schedule.dto';
import { ScheduleFrequency } from './dto/create-schedule.dto';
import { MedicationSafetyService } from '../medication-safety/medication-safety.service';
import {
  addDaysToDateKey,
  dateKeyInTimezone,
  dayOfWeekForDateKey,
  isValidTimezone,
  zonedDateTimeToUtc,
  zonedDayBounds,
} from './schedule-timezone';
import {
  doseMissDeadline,
  doseOccurrenceState,
} from '../dose-logs/dose-occurrence';

export interface MobileReminderItem {
  id: number;
  doseLogId: string;
  scheduleId: string;
  medicineId: string;
  medicineName: string;
  dosage: string;
  scheduledAt: string;
  doseScheduledAt: string;
  kind: 'PRIMARY' | 'FOLLOW_UP';
  title: string;
  body: string;
  actionUrl: string;
}

export interface MobileReminderPlan {
  generatedAt: string;
  horizonDays: number;
  reminders: MobileReminderItem[];
}

interface OccurrenceSchedule {
  id: string;
  userId: string;
  medicineId: string;
  frequency: string;
  timesOfDay: string[];
  daysOfWeek: number[];
  startDate: Date;
  endDate: Date | null;
  timezone: string;
}

@Injectable()
export class SchedulesService {
  private readonly logger = new Logger(SchedulesService.name);

  constructor(
    private prisma: PrismaService,
    private auditLogs: AuditLogsService,
    private medicinesService: MedicinesService,
    @Optional() private medicationSafety?: MedicationSafetyService,
  ) {}

  // ── Create schedule + generate initial dose logs ──────────
  async create(userId: string, dto: CreateScheduleDto) {
    // Verify medicine belongs to user
    await this.medicinesService.findOne(userId, dto.medicineId);

    const startDate = new Date(dto.startDate);
    const endDate = dto.endDate ? new Date(dto.endDate) : null;
    const timezone = dto.timezone ?? 'UTC';

    if (!isValidTimezone(timezone)) {
      throw new BadRequestException('Timezone must be a valid IANA timezone');
    }

    if (endDate && endDate <= startDate) {
      throw new BadRequestException('End date must be after start date');
    }

    const schedule = await this.prisma.medicineSchedule.create({
      data: {
        userId,
        medicineId: dto.medicineId,
        frequency: dto.frequency,
        timesOfDay: dto.timesOfDay,
        daysOfWeek: dto.daysOfWeek ?? [],
        startDate,
        endDate,
        dosesPerIntake: dto.dosesPerIntake ?? 1,
        unit: dto.unit ?? 'tablet',
        isActive: dto.isActive ?? true,
        timezone,
        notes: dto.notes,
      },
      include: { medicine: { select: { name: true } } },
    });

    if (dto.frequency !== ScheduleFrequency.AS_NEEDED) {
      await this.reconcileDoseLogsForUser(userId, 14);
    }

    await this.auditLogs.log({
      userId,
      action: 'SCHEDULE_ACTIVATED',
      entityType: 'MedicineSchedule',
      entityId: schedule.id,
      newValues: {
        medicineId: dto.medicineId,
        frequency: dto.frequency,
        timesOfDay: dto.timesOfDay,
        startDate: startDate.toISOString(),
      },
    });

    // Return the plan produced from the same committed schedule state. The mobile
    // client can register alarms before any list refetch or UI work consumes the
    // short lead time between schedule creation and the first dose.
    const reminderPlan = await this.getMobileReminderPlan(userId, 14);
    await this.refreshMedicationSafety(userId);

    return { ...schedule, reminderPlan };
  }

  // ── List schedules ────────────────────────────────────────
  async findAll(userId: string, page = 1, limit = 20, activeOnly = false) {
    const skip = (page - 1) * limit;
    const where = { userId, ...(activeOnly ? { isActive: true } : {}) };

    const [total, schedules] = await Promise.all([
      this.prisma.medicineSchedule.count({ where }),
      this.prisma.medicineSchedule.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          medicine: {
            select: { id: true, name: true, form: true, strength: true },
          },
          _count: { select: { doseLogs: true } },
        },
      }),
    ]);

    return {
      data: schedules,
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }

  // ── Find one schedule ─────────────────────────────────────
  async findOne(userId: string, id: string) {
    const schedule = await this.prisma.medicineSchedule.findUnique({
      where: { id },
      include: {
        medicine: {
          select: { id: true, name: true, form: true, strength: true },
        },
        doseLogs: {
          orderBy: { scheduledAt: 'desc' },
          take: 10,
        },
      },
    });

    if (!schedule) throw new NotFoundException('Schedule not found');
    this.assertOwnership(schedule.userId, userId);

    return schedule;
  }

  // ── Update schedule ───────────────────────────────────────
  async update(userId: string, id: string, dto: UpdateScheduleDto) {
    const existing = await this.findOne(userId, id);
    if (dto.timezone && !isValidTimezone(dto.timezone)) {
      throw new BadRequestException('Timezone must be a valid IANA timezone');
    }

    const scheduleShapeChanged = [
      'frequency',
      'timesOfDay',
      'daysOfWeek',
      'startDate',
      'endDate',
      'timezone',
      'isActive',
    ].some((field) => Object.prototype.hasOwnProperty.call(dto, field));

    const updated = await this.prisma.$transaction(async (tx) => {
      const result = await tx.medicineSchedule.update({
        where: { id },
        data: {
          ...dto,
          startDate: dto.startDate ? new Date(dto.startDate) : undefined,
          endDate: dto.endDate ? new Date(dto.endDate) : undefined,
        },
      });

      if (scheduleShapeChanged) {
        await tx.doseLog.deleteMany({
          where: {
            scheduleId: id,
            status: 'PENDING',
            scheduledAt: { gt: new Date() },
          },
        });
      }
      return result;
    });

    if (updated.isActive && updated.frequency !== 'AS_NEEDED') {
      await this.reconcileDoseLogsForUser(userId, 14);
    }

    await this.auditLogs.log({
      userId,
      action: 'UPDATED',
      entityType: 'MedicineSchedule',
      entityId: id,
      oldValues: {
        isActive: existing.isActive,
        timesOfDay: existing.timesOfDay,
      },
      newValues: { ...dto },
    });

    const reminderPlan = await this.getMobileReminderPlan(userId, 14);
    await this.refreshMedicationSafety(userId);
    return { ...updated, reminderPlan };
  }

  async getMobileReminderPlan(
    userId: string,
    days = 14,
    now = new Date(),
  ): Promise<MobileReminderPlan> {
    const horizonDays = Math.min(Math.max(Math.floor(days), 1), 30);
    await this.reconcileDoseLogsForUser(userId, horizonDays, now);

    const doseLogs = await this.prisma.doseLog.findMany({
      where: {
        userId,
        status: { in: ['PENDING', 'SNOOZED'] },
        OR: [
          {
            status: 'PENDING',
            scheduledAt: {
              gt: now,
              lte: new Date(now.getTime() + (horizonDays + 2) * 86_400_000),
            },
          },
          {
            status: 'SNOOZED',
            snoozeUntil: {
              gt: now,
              lte: new Date(now.getTime() + (horizonDays + 2) * 86_400_000),
            },
          },
        ],
        schedule: { isActive: true, frequency: { not: 'AS_NEEDED' } },
      },
      include: {
        medicine: {
          select: { id: true, name: true, strength: true, form: true },
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

    const reminders = doseLogs.flatMap((dose) => {
      const medicineLabel = [dose.medicine.name, dose.medicine.strength]
        .filter(Boolean)
        .join(' ');
      const dosage = `${dose.schedule.dosesPerIntake} ${dose.schedule.unit}`;
      const triggerAt =
        dose.status === 'SNOOZED' && dose.snoozeUntil
          ? dose.snoozeUntil
          : dose.scheduledAt;
      const primary: MobileReminderItem = {
        id: this.mobileNotificationId(
          dose.scheduleId,
          dose.scheduledAt,
          dose.status === 'SNOOZED'
            ? `snooze:${dose.snoozeUntil?.toISOString()}`
            : 'primary',
        ),
        doseLogId: dose.id,
        scheduleId: dose.scheduleId,
        medicineId: dose.medicineId,
        medicineName: medicineLabel,
        dosage,
        scheduledAt: triggerAt.toISOString(),
        doseScheduledAt: dose.scheduledAt.toISOString(),
        kind: 'PRIMARY',
        title:
          dose.status === 'SNOOZED'
            ? 'Snoozed medicine reminder'
            : 'Medicine reminder',
        body:
          dose.status === 'SNOOZED'
            ? `Your snoozed dose of ${medicineLabel} is due.`
            : `Time to take ${dosage} of ${medicineLabel}.`,
        actionUrl: `/dose-logs?doseLogId=${encodeURIComponent(dose.id)}`,
      };
      if (dose.status === 'SNOOZED') return [primary];
      const followUpAt = new Date(dose.scheduledAt.getTime() + 15 * 60_000);
      const deadline = doseMissDeadline({
        scheduledAt: dose.scheduledAt,
        gracePeriodMinutes: dose.schedule.gracePeriodMinutes,
      });
      if (
        followUpAt.getTime() >= deadline.getTime() ||
        followUpAt.getTime() <= now.getTime()
      ) {
        return [primary];
      }
      const followUp: MobileReminderItem = {
        ...primary,
        id: this.mobileNotificationId(
          dose.scheduleId,
          dose.scheduledAt,
          'follow-up',
        ),
        scheduledAt: followUpAt.toISOString(),
        kind: 'FOLLOW_UP',
        title: 'Dose check-in',
        body: `Please confirm whether you took ${medicineLabel}.`,
      };
      return [primary, followUp];
    });

    return {
      generatedAt: now.toISOString(),
      horizonDays,
      reminders,
    };
  }
  // ── Deactivate schedule ───────────────────────────────────
  async deactivate(userId: string, id: string) {
    await this.findOne(userId, id);

    const updated = await this.prisma.medicineSchedule.update({
      where: { id },
      data: { isActive: false },
    });

    await this.auditLogs.log({
      userId,
      action: 'SCHEDULE_DEACTIVATED',
      entityType: 'MedicineSchedule',
      entityId: id,
      newValues: { isActive: false },
    });

    await this.refreshMedicationSafety(userId);

    return updated;
  }

  // ── Get today's upcoming doses ────────────────────────────
  async getTodaysDoses(userId: string, timezone = 'UTC') {
    if (!isValidTimezone(timezone)) {
      throw new BadRequestException('Timezone must be a valid IANA timezone');
    }
    const now = new Date();
    await this.reconcileDoseLogsForUser(userId, 2, now);
    const { start: startOfDay, end: endOfDay } = zonedDayBounds(now, timezone);

    const doseLogs = await this.prisma.doseLog.findMany({
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
            timesOfDay: true,
            unit: true,
            dosesPerIntake: true,
            gracePeriodMinutes: true,
          },
        },
        careEscalations: {
          where: { kind: 'DOSE_HELP_REQUEST' },
          select: { status: true, createdAt: true },
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
      },
      orderBy: { scheduledAt: 'asc' },
    });

    return doseLogs.map((dose) => {
      const { careEscalations, ...serializedDose } = dose;
      const effectiveDueAt =
        dose.status === 'SNOOZED' && dose.snoozeUntil
          ? dose.snoozeUntil
          : dose.scheduledAt;
      const graceEndsAt = doseMissDeadline({
        scheduledAt: dose.scheduledAt,
        gracePeriodMinutes: dose.schedule.gracePeriodMinutes,
        snoozeUntil: dose.snoozeUntil,
      });
      const occurrenceState = doseOccurrenceState(
        {
          status: dose.status,
          scheduledAt: dose.scheduledAt,
          gracePeriodMinutes: dose.schedule.gracePeriodMinutes,
          snoozeUntil: dose.snoozeUntil,
        },
        now,
      );
      return {
        ...serializedDose,
        occurrenceState,
        effectiveDueAt,
        graceEndsAt,
        minutesUntilDue: Math.ceil(
          (effectiveDueAt.getTime() - now.getTime()) / 60_000,
        ),
        isActionable: !['TAKEN', 'MISSED', 'SKIPPED'].includes(occurrenceState),
        helpRequest: careEscalations[0] ?? null,
      };
    });
  }

  // ── Internal: generate dose logs ──────────────────────────
  async generateDoseLogs(
    scheduleId: string,
    userId: string,
    medicineId: string,
    timesOfDay: string[],
    startDate: Date,
    endDate: Date | null,
    daysOfWeek: number[],
    timezone = 'UTC',
  ) {
    return this.createOccurrencesForSchedule(
      {
        id: scheduleId,
        userId,
        medicineId,
        frequency: ScheduleFrequency.DAILY,
        timesOfDay,
        daysOfWeek,
        startDate,
        endDate,
        timezone,
      },
      7,
      new Date(),
    );
  }

  // ── Guard ─────────────────────────────────────────────────

  async reconcileDoseLogsForUser(
    userId: string,
    days = 14,
    now = new Date(),
  ): Promise<number> {
    const schedules = await this.prisma.medicineSchedule.findMany({
      where: {
        userId,
        isActive: true,
        frequency: { not: ScheduleFrequency.AS_NEEDED },
      },
      select: {
        id: true,
        userId: true,
        medicineId: true,
        frequency: true,
        timesOfDay: true,
        daysOfWeek: true,
        startDate: true,
        endDate: true,
        timezone: true,
      },
    });
    return this.createOccurrencesForSchedules(schedules, days, now);
  }

  async reconcileAllActiveDoseLogs(
    days = 7,
    now = new Date(),
  ): Promise<number> {
    const schedules = await this.prisma.medicineSchedule.findMany({
      where: {
        isActive: true,
        frequency: { not: ScheduleFrequency.AS_NEEDED },
      },
      select: {
        id: true,
        userId: true,
        medicineId: true,
        frequency: true,
        timesOfDay: true,
        daysOfWeek: true,
        startDate: true,
        endDate: true,
        timezone: true,
      },
    });
    return this.createOccurrencesForSchedules(schedules, days, now);
  }

  private async createOccurrencesForSchedules(
    schedules: OccurrenceSchedule[],
    days: number,
    now: Date,
  ): Promise<number> {
    let created = 0;
    for (const schedule of schedules) {
      created += await this.createOccurrencesForSchedule(schedule, days, now);
    }
    return created;
  }

  private async createOccurrencesForSchedule(
    schedule: OccurrenceSchedule,
    days: number,
    now: Date,
  ): Promise<number> {
    if (
      schedule.frequency === 'AS_NEEDED' ||
      !isValidTimezone(schedule.timezone)
    ) {
      return 0;
    }

    const horizonDays = Math.min(Math.max(Math.floor(days), 1), 30);
    const firstDateKey = dateKeyInTimezone(now, schedule.timezone);
    const startDateKey = schedule.startDate.toISOString().slice(0, 10);
    const endDateKey = schedule.endDate?.toISOString().slice(0, 10) ?? null;
    const rows: Array<{
      userId: string;
      medicineId: string;
      scheduleId: string;
      scheduledAt: Date;
    }> = [];

    for (let dayOffset = 0; dayOffset < horizonDays; dayOffset += 1) {
      const dateKey = addDaysToDateKey(firstDateKey, dayOffset);
      if (dateKey < startDateKey || (endDateKey && dateKey > endDateKey)) {
        continue;
      }
      if (
        schedule.daysOfWeek.length > 0 &&
        !schedule.daysOfWeek.includes(dayOfWeekForDateKey(dateKey))
      ) {
        continue;
      }

      for (const time of schedule.timesOfDay) {
        const scheduledAt = zonedDateTimeToUtc(
          dateKey,
          time,
          schedule.timezone,
        );
        if (!scheduledAt) continue;
        rows.push({
          userId: schedule.userId,
          medicineId: schedule.medicineId,
          scheduleId: schedule.id,
          scheduledAt,
        });
      }
    }

    if (rows.length === 0) return 0;
    const result = await this.prisma.doseLog.createMany({
      data: rows,
      skipDuplicates: true,
    });
    return result.count;
  }

  private mobileNotificationId(
    scheduleId: string,
    scheduledAt: Date,
    kind = 'primary',
  ): number {
    const key = `${scheduleId}:${scheduledAt.toISOString()}:${kind}`;
    let hash = 2166136261;
    for (let i = 0; i < key.length; i++) {
      hash ^= key.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return Math.abs(hash % 2147483647) || 1;
  }

  private assertOwnership(ownerId: string, requesterId: string) {
    if (ownerId !== requesterId) {
      throw new ForbiddenException(
        'You do not have permission to access this schedule',
      );
    }
  }

  private async refreshMedicationSafety(userId: string) {
    if (!this.medicationSafety) return;
    try {
      await this.medicationSafety.evaluateUser(userId);
    } catch (error) {
      this.logger.error(
        `Medication safety refresh failed for user ${userId}`,
        error instanceof Error ? error.stack : undefined,
      );
    }
  }
}
