import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import {
  DoseActionSource,
  DoseBarrierReason,
  DoseStatus,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import {
  ClientDoseActionSource,
  CreateDoseLogDto,
  DoseActionStatus,
} from './dto/create-dose-log.dto';
import { doseMissDeadline } from './dose-occurrence';

@Injectable()
export class DoseLogsService {
  private readonly logger = new Logger(DoseLogsService.name);

  constructor(
    private prisma: PrismaService,
    private auditLogs: AuditLogsService,
  ) {}

  private readonly barrierGuidance: Record<
    DoseBarrierReason,
    { label: string; guidance: string; urgent: boolean }
  > = {
    FORGOT: {
      label: 'Forgot',
      guidance: 'Review reminder timing and keep the routine easy to notice.',
      urgent: false,
    },
    ASLEEP: {
      label: 'Was asleep',
      guidance:
        'Ask your clinician or pharmacist whether the prescribed schedule fits your sleep routine.',
      urgent: false,
    },
    AWAY_FROM_HOME: {
      label: 'Away from home',
      guidance:
        'Prepare an appropriate travel supply and keep the prescribed schedule available offline.',
      urgent: false,
    },
    ROUTINE_CHANGED: {
      label: 'Routine changed',
      guidance: 'Review reminder times when your daily routine changes.',
      urgent: false,
    },
    RAN_OUT: {
      label: 'Ran out',
      guidance:
        'Review the refill estimate and contact a licensed pharmacy or prescriber.',
      urgent: false,
    },
    COST_OR_ACCESS: {
      label: 'Cost or access problem',
      guidance:
        'Ask a clinician or pharmacist about suitable approved and affordable options.',
      urgent: false,
    },
    SIDE_EFFECT_CONCERN: {
      label: 'Side-effect concern',
      guidance:
        'Contact a clinician or pharmacist. Do not stop, restart, or change a dose without professional advice.',
      urgent: true,
    },
    DID_NOT_WANT_TO_TAKE: {
      label: 'Did not want to take it',
      guidance:
        'Discuss your concerns with a clinician or pharmacist before changing treatment.',
      urgent: false,
    },
    OTHER: {
      label: 'Another reason',
      guidance:
        'If this keeps happening, discuss the barrier with a clinician or pharmacist.',
      urgent: false,
    },
  };

  // ─────────────────────────────────────────────────────────
  // Record a dose action (TAKEN / MISSED / SNOOZED / SKIPPED)
  // ─────────────────────────────────────────────────────────
  async recordAction(userId: string, dto: CreateDoseLogDto) {
    // 1. Verify the schedule belongs to this user
    const schedule = await this.prisma.medicineSchedule.findUnique({
      where: { id: dto.scheduleId },
      include: { medicine: { select: { id: true, name: true } } },
    });

    if (!schedule) throw new NotFoundException('Schedule not found');
    if (schedule.userId !== userId) {
      throw new ForbiddenException(
        'You do not have permission to log this dose',
      );
    }

    // 2. Validate snooze has snoozeUntil
    if (dto.status === DoseActionStatus.SNOOZED && !dto.snoozeUntil) {
      throw new BadRequestException(
        'snoozeUntil is required when status is SNOOZED',
      );
    }

    const scheduledAt = new Date(dto.scheduledAt);
    const actionAt = new Date();
    const snoozeUntil = dto.snoozeUntil ? new Date(dto.snoozeUntil) : null;
    const requestedStatus = dto.status as DoseStatus;
    const actionSource = (dto.source ??
      ClientDoseActionSource.APP) as DoseActionSource;
    if (snoozeUntil) {
      const maximumSnooze = actionAt.getTime() + 12 * 60 * 60 * 1000;
      if (
        snoozeUntil.getTime() <= actionAt.getTime() ||
        snoozeUntil.getTime() > maximumSnooze
      ) {
        throw new BadRequestException(
          'snoozeUntil must be in the future and within 12 hours',
        );
      }
    }
    const clientActionId = `${userId}:${
      dto.clientActionId ??
      [
        dto.scheduleId,
        scheduledAt.toISOString(),
        dto.status,
        snoozeUntil?.toISOString() ?? '',
      ].join(':')
    }`;
    const lockKey = `${dto.scheduleId}:${scheduledAt.toISOString()}`;

    const result = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`
        SELECT pg_advisory_xact_lock(hashtext(${lockKey}))
      `;

      const include = {
        medicine: { select: { id: true, name: true, form: true } },
        schedule: {
          select: { id: true, dosesPerIntake: true, unit: true },
        },
      } as const;
      const replayedEvent = await tx.doseActionEvent.findUnique({
        where: { clientActionId },
      });
      if (replayedEvent) {
        const doseLog = await tx.doseLog.findUniqueOrThrow({
          where: { id: replayedEvent.doseLogId },
          include,
        });
        return { doseLog, changed: false };
      }

      const existingLog = await tx.doseLog.findUnique({
        where: {
          scheduleId_scheduledAt: {
            scheduleId: dto.scheduleId,
            scheduledAt,
          },
        },
      });
      if (!existingLog || existingLog.userId !== userId) {
        throw new NotFoundException('Scheduled dose occurrence not found');
      }

      if (existingLog.status === DoseStatus.TAKEN) {
        if (requestedStatus !== DoseStatus.TAKEN) {
          throw new BadRequestException(
            'A taken dose cannot be changed to another status.',
          );
        }
        const doseLog = await tx.doseLog.findUniqueOrThrow({
          where: { id: existingLog.id },
          include,
        });
        await tx.doseActionEvent.create({
          data: {
            userId,
            doseLogId: existingLog.id,
            clientActionId,
            status: DoseStatus.TAKEN,
            source: actionSource,
            occurredAt: actionAt,
          },
        });
        return { doseLog, changed: false };
      }

      if (
        requestedStatus === DoseStatus.SNOOZED &&
        existingLog.snoozeCount >= 3
      ) {
        throw new BadRequestException(
          'This dose has reached the maximum of 3 snoozes',
        );
      }

      const doseLog = await tx.doseLog.update({
        where: { id: existingLog.id },
        data: {
          status: requestedStatus,
          actionAt,
          actionSource,
          snoozeUntil:
            requestedStatus === DoseStatus.SNOOZED ? snoozeUntil : null,
          snoozeCount:
            requestedStatus === DoseStatus.SNOOZED
              ? { increment: 1 }
              : existingLog.snoozeCount,
          notes: dto.notes,
        },
        include,
      });

      if (requestedStatus === DoseStatus.TAKEN) {
        const dosesPerIntake = doseLog.schedule.dosesPerIntake ?? 1;
        await tx.$executeRaw`
          UPDATE medicines
          SET "remainingQuantity" = GREATEST(
                0,
                "remainingQuantity" - ${dosesPerIntake}
              ),
              "updatedAt" = NOW()
          WHERE id = ${schedule.medicineId}
            AND "remainingQuantity" IS NOT NULL
        `;
      }

      await tx.doseActionEvent.create({
        data: {
          userId,
          doseLogId: doseLog.id,
          clientActionId,
          status: requestedStatus,
          source: actionSource,
          occurredAt: actionAt,
        },
      });

      return { doseLog, changed: true };
    });

    if (!result.changed) return result.doseLog;
    const doseLog = result.doseLog;

    const auditAction = {
      [DoseActionStatus.TAKEN]: 'DOSE_TAKEN',
      [DoseActionStatus.MISSED]: 'DOSE_MISSED',
      [DoseActionStatus.SNOOZED]: 'DOSE_SNOOZED',
      [DoseActionStatus.SKIPPED]: 'DOSE_SKIPPED',
    }[dto.status];

    await this.auditLogs.log({
      userId,
      action: auditAction as Parameters<AuditLogsService['log']>[0]['action'],
      entityType: 'DoseLog',
      entityId: doseLog.id,
      newValues: {
        medicineId: schedule.medicineId,
        medicineName: schedule.medicine.name,
        status: dto.status,
        scheduledAt: scheduledAt.toISOString(),
        actionAt: actionAt.toISOString(),
      },
    });

    this.logger.log(
      `Dose ${dto.status} — user: ${userId}, medicine: ${schedule.medicine.name}`,
    );

    return doseLog;
  }

  async recordBarrierReason(
    userId: string,
    doseLogId: string,
    reason: DoseBarrierReason,
  ) {
    const existing = await this.prisma.doseLog.findUnique({
      where: { id: doseLogId },
      select: {
        id: true,
        userId: true,
        status: true,
        barrierReason: true,
        barrierRecordedAt: true,
      },
    });
    if (!existing || existing.userId !== userId) {
      throw new NotFoundException('Dose log not found');
    }
    if (
      existing.status !== DoseStatus.MISSED &&
      existing.status !== DoseStatus.SKIPPED
    ) {
      throw new BadRequestException(
        'A reason can only be recorded for a missed or skipped dose.',
      );
    }
    if (existing.barrierReason === reason && existing.barrierRecordedAt) {
      return this.findOne(userId, doseLogId);
    }

    const barrierRecordedAt = new Date();
    const updated = await this.prisma.doseLog.updateMany({
      where: {
        id: doseLogId,
        userId,
        status: { in: [DoseStatus.MISSED, DoseStatus.SKIPPED] },
      },
      data: { barrierReason: reason, barrierRecordedAt },
    });
    if (updated.count !== 1) {
      throw new BadRequestException(
        'This dose is no longer eligible for a barrier reason.',
      );
    }

    await this.auditLogs.log({
      userId,
      action: 'DOSE_BARRIER_RECORDED',
      entityType: 'DoseLog',
      entityId: doseLogId,
      oldValues: { barrierReason: existing.barrierReason },
      newValues: { barrierReason: reason, barrierRecordedAt },
    });
    return this.findOne(userId, doseLogId);
  }

  async barrierSummary(userId: string, requestedDays = 30) {
    const days = Math.min(90, Math.max(7, requestedDays));
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const terminalStatuses = [DoseStatus.MISSED, DoseStatus.SKIPPED];
    const [groups, finalized] = await Promise.all([
      this.prisma.doseLog.groupBy({
        by: ['barrierReason'],
        where: {
          userId,
          status: { in: terminalStatuses },
          scheduledAt: { gte: since },
          barrierReason: { not: null },
        },
        _count: { id: true },
      }),
      this.prisma.doseLog.count({
        where: {
          userId,
          status: { in: terminalStatuses },
          scheduledAt: { gte: since },
        },
      }),
    ]);

    const reasons = groups
      .filter(
        (group): group is typeof group & { barrierReason: DoseBarrierReason } =>
          group.barrierReason !== null,
      )
      .map((group) => ({
        reason: group.barrierReason,
        count: group._count.id,
        ...this.barrierGuidance[group.barrierReason],
      }))
      .sort((a, b) => b.count - a.count);
    const recorded = reasons.reduce((sum, item) => sum + item.count, 0);

    return {
      periodDays: days,
      finalized,
      recorded,
      unrecorded: Math.max(0, finalized - recorded),
      coveragePercent:
        finalized > 0 ? Math.round((recorded / finalized) * 100) : 0,
      reasons,
      guidance: reasons.slice(0, 3),
      disclaimer:
        'These patterns support personal tracking only. They do not diagnose a problem or recommend changing treatment.',
    };
  }

  // ─────────────────────────────────────────────────────────
  // Get dose logs for authenticated user (paginated, filterable)
  // ─────────────────────────────────────────────────────────
  async findAll(
    userId: string,
    options: {
      page?: number;
      limit?: number;
      status?: DoseStatus;
      medicineId?: string;
      from?: string;
      to?: string;
    } = {},
  ) {
    const { page = 1, limit = 20, status, medicineId, from, to } = options;
    const skip = (page - 1) * limit;

    const where: any = {
      userId,
      ...(status ? { status } : {}),
      ...(medicineId ? { medicineId } : {}),
      ...(from || to
        ? {
            scheduledAt: {
              ...(from && !isNaN(new Date(from).getTime())
                ? { gte: new Date(from) }
                : {}),

              ...(to && !isNaN(new Date(to).getTime())
                ? { lte: new Date(to) }
                : {}),
            },
          }
        : {}),
    };

    const [total, logs] = await Promise.all([
      this.prisma.doseLog.count({ where }),
      this.prisma.doseLog.findMany({
        where,
        skip,
        take: Math.min(limit, 100),
        orderBy: { scheduledAt: 'desc' },
        include: {
          medicine: {
            select: { id: true, name: true, form: true, strength: true },
          },
          schedule: {
            select: {
              id: true,
              frequency: true,
              dosesPerIntake: true,
              unit: true,
            },
          },
        },
      }),
    ]);

    return {
      data: logs,
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }

  // ─────────────────────────────────────────────────────────
  // Get a single dose log by id
  // ─────────────────────────────────────────────────────────
  async findOne(userId: string, id: string) {
    const log = await this.prisma.doseLog.findUnique({
      where: { id },
      include: {
        medicine: {
          select: { id: true, name: true, form: true, strength: true },
        },
        schedule: {
          select: {
            id: true,
            frequency: true,
            timesOfDay: true,
            dosesPerIntake: true,
            unit: true,
          },
        },
      },
    });

    if (!log) throw new NotFoundException('Dose log not found');
    if (log.userId !== userId) {
      throw new ForbiddenException('You do not have access to this dose log');
    }

    return log;
  }

  // ─────────────────────────────────────────────────────────
  // Get today's pending doses that need reminders
  // Called by the notification scheduler
  // ─────────────────────────────────────────────────────────
  async getPendingDosesForReminder(userId: string) {
    const now = new Date();
    const fifteenMinutesFromNow = new Date(now.getTime() + 15 * 60 * 1000);

    return this.prisma.doseLog.findMany({
      where: {
        userId,
        status: DoseStatus.PENDING,
        scheduledAt: {
          gte: now,
          lte: fifteenMinutesFromNow,
        },
      },
      include: {
        medicine: { select: { id: true, name: true } },
        schedule: { select: { id: true, dosesPerIntake: true, unit: true } },
      },
    });
  }

  // ─────────────────────────────────────────────────────────
  // Mark all still-PENDING logs older than threshold as MISSED
  // Called by the notification scheduler (cron job)
  // ─────────────────────────────────────────────────────────
  async markOverdueAsMissed(): Promise<number> {
    const markedMissed = await this.reconcileMissedOccurrences(undefined);
    if (markedMissed > 0) {
      this.logger.log(`Auto-marked ${markedMissed} overdue doses as MISSED`);
    }
    return markedMissed;
  }

  async reconcileOverdueForUser(
    userId: string,
  ): Promise<{ markedMissed: number }> {
    return { markedMissed: await this.reconcileMissedOccurrences(userId) };
  }

  private async reconcileMissedOccurrences(
    userId?: string,
    now = new Date(),
  ): Promise<number> {
    const candidates = await this.prisma.doseLog.findMany({
      where: {
        ...(userId ? { userId } : {}),
        status: { in: [DoseStatus.PENDING, DoseStatus.SNOOZED] },
        scheduledAt: { lt: now },
      },
      select: {
        id: true,
        status: true,
        scheduledAt: true,
        snoozeUntil: true,
        schedule: { select: { gracePeriodMinutes: true } },
      },
      take: 500,
    });

    let markedMissed = 0;
    for (const dose of candidates) {
      if (
        now.getTime() <=
        doseMissDeadline({
          scheduledAt: dose.scheduledAt,
          gracePeriodMinutes: dose.schedule.gracePeriodMinutes,
          snoozeUntil: dose.snoozeUntil,
        }).getTime()
      ) {
        continue;
      }
      const result = await this.prisma.doseLog.updateMany({
        where: { id: dose.id, status: dose.status },
        data: {
          status: DoseStatus.MISSED,
          actionAt: now,
          actionSource: DoseActionSource.SYSTEM,
          snoozeUntil: null,
        },
      });
      markedMissed += result.count;
    }
    return markedMissed;
  }

  // ─────────────────────────────────────────────────────────
  // Get raw dose stats for a user and date range
  // Used internally by DashboardService
  // ─────────────────────────────────────────────────────────
  async getStatsForPeriod(
    userId: string,
    from: Date,
    to: Date,
    medicineId?: string,
  ) {
    const where = {
      userId,
      scheduledAt: { gte: from, lte: to },
      // Only count finalized statuses (not PENDING)
      status: { not: DoseStatus.PENDING },
      ...(medicineId ? { medicineId } : {}),
    };

    const [total, taken, missed, snoozed, skipped] = await Promise.all([
      this.prisma.doseLog.count({ where }),
      this.prisma.doseLog.count({
        where: { ...where, status: DoseStatus.TAKEN },
      }),
      this.prisma.doseLog.count({
        where: { ...where, status: DoseStatus.MISSED },
      }),
      this.prisma.doseLog.count({
        where: { ...where, status: DoseStatus.SNOOZED },
      }),
      this.prisma.doseLog.count({
        where: { ...where, status: DoseStatus.SKIPPED },
      }),
    ]);

    return { total, taken, missed, snoozed, skipped };
  }

  // ─────────────────────────────────────────────────────────
  // Get daily dose breakdown for chart data
  // ─────────────────────────────────────────────────────────
  async getDailyBreakdown(userId: string, from: Date, to: Date) {
    const logs = await this.prisma.doseLog.findMany({
      where: {
        userId,
        scheduledAt: { gte: from, lte: to },
        status: { not: DoseStatus.PENDING },
      },
      select: {
        scheduledAt: true,
        status: true,
        medicine: { select: { name: true } },
      },
      orderBy: { scheduledAt: 'asc' },
    });

    // Group by date string
    const breakdown: Record<
      string,
      {
        date: string;
        taken: number;
        missed: number;
        snoozed: number;
        skipped: number;
      }
    > = {};

    for (const log of logs) {
      const dateKey = log.scheduledAt.toISOString().split('T')[0]; // YYYY-MM-DD
      if (!breakdown[dateKey]) {
        breakdown[dateKey] = {
          date: dateKey,
          taken: 0,
          missed: 0,
          snoozed: 0,
          skipped: 0,
        };
      }
      const statusKey = log.status.toLowerCase() as
        | 'taken'
        | 'missed'
        | 'snoozed'
        | 'skipped';
      breakdown[dateKey][statusKey]++;
    }

    return Object.values(breakdown);
  }
}
