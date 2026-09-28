import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import {
  DoseActionSource,
  DoseStatus,
  StockAlertLevel,
} from '@prisma/client/index';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from './notifications.service';
import { DashboardService } from '../dashboard/dashboard.service';
import { SchedulesService } from '../schedules/schedules.service';
import { doseMissDeadline } from '../dose-logs/dose-occurrence';

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Phase 3: Enhanced Notification Scheduler
//
// CRON 1 â€” every minute:
//   â€¢ Send dose reminders for doses due in next 15 min (dedup by notif log)
//   â€¢ Re-trigger expired snooze reminders
//
// CRON 2 â€” every 5 minutes:
//   â€¢ Grace-period aware missed marking (per-schedule gracePeriodMinutes)
//
// CRON 3 â€” midnight:
//   â€¢ Generate 7-day dose logs for active schedules
//   â€¢ Write daily AdherenceSnapshot for all users
//
// CRON 4 â€” 09:00:
//   â€¢ Low stock alerts
//
// CRON 5 â€” 23:30:
//   â€¢ Write today's adherence snapshot (pre-midnight)
//
// Phase 5 will replace cron jobs with BullMQ queues.
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

@Injectable()
export class NotificationSchedulerService {
  private readonly logger = new Logger(NotificationSchedulerService.name);

  constructor(
    private prisma: PrismaService,
    private notificationsService: NotificationsService,
    private dashboardService: DashboardService,
    private schedulesService: SchedulesService,
  ) {}

  // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // CRON 1 â€” Every minute
  // Send dose reminders + re-trigger expired snoozes
  // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  @Cron(CronExpression.EVERY_MINUTE)
  async sendUpcomingReminders(): Promise<void> {
    try {
      const now = new Date();
      const windowEnd = new Date(now.getTime() + 15 * 60 * 1000);

      // â”€â”€ 1A. Normal upcoming doses â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
      const upcomingDoses = await this.prisma.doseLog.findMany({
        where: {
          status: DoseStatus.PENDING,
          scheduledAt: { gte: now, lte: windowEnd },
          schedule: { isActive: true },
          user: { isActive: true },
        },
        include: {
          medicine: { select: { id: true, name: true } },
          schedule: {
            select: {
              id: true,
              dosesPerIntake: true,
              unit: true,
              isActive: true,
            },
          },
          user: { select: { id: true, isActive: true } },
        },
      });

      for (const dose of upcomingDoses) {
        if (!dose.schedule.isActive || !dose.user.isActive) continue;

        // Dedup: only send one reminder per doseLogId per scheduling window
        const alreadyNotified = await this.prisma.notificationLog.findFirst({
          where: {
            userId: dose.userId,
            metadata: { path: ['doseLogId'], equals: dose.id },
          },
        });
        if (alreadyNotified) continue;

        const doseTime = dose.scheduledAt.toLocaleTimeString('en-IN', {
          hour: '2-digit',
          minute: '2-digit',
          hour12: true,
        });

        await this.notificationsService.sendDoseReminder({
          userId: dose.userId,
          medicineName: dose.medicine.name,
          doseTime,
          scheduleId: dose.schedule.id,
          doseLogId: dose.id,
          dosesPerIntake: dose.schedule.dosesPerIntake,
          unit: dose.schedule.unit,
        });
      }

      // â”€â”€ 1B. Re-trigger expired snoozes â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
      const expiredSnoozes = await this.prisma.doseLog.findMany({
        where: {
          status: DoseStatus.SNOOZED,
          snoozeUntil: { lte: now },
          user: { isActive: true },
        },
        include: {
          medicine: { select: { id: true, name: true } },
          schedule: { select: { id: true, dosesPerIntake: true, unit: true } },
          user: { select: { id: true, isActive: true } },
        },
      });

      for (const dose of expiredSnoozes) {
        if (!dose.user.isActive) continue;

        // Dedup: check we haven't already sent a post-snooze reminder
        const snoozeNotifKey = `snooze-retrigger-${dose.id}-${dose.snoozeUntil?.toISOString()}`;
        const alreadySent = await this.prisma.notificationLog.findFirst({
          where: {
            userId: dose.userId,
            metadata: { path: ['snoozeRetriggerKey'], equals: snoozeNotifKey },
          },
        });
        if (alreadySent) continue;

        await this.notificationsService.sendSnoozedDoseReminder({
          userId: dose.userId,
          medicineName: dose.medicine.name,
          scheduleId: dose.schedule.id,
          doseLogId: dose.id,
          snoozeRetriggerKey: snoozeNotifKey,
        });

        this.logger.log(
          `Snooze re-triggered for doseLogId: ${dose.id} (${dose.medicine.name})`,
        );
      }

      if (upcomingDoses.length > 0 || expiredSnoozes.length > 0) {
        this.logger.log(
          `Reminders: ${upcomingDoses.length} upcoming sent, ${expiredSnoozes.length} snooze(s) retriggered`,
        );
      }
    } catch (error) {
      this.logger.error(
        `sendUpcomingReminders failed: ${(error as Error).message}`,
        (error as Error).stack,
      );
    }
  }

  // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // CRON 2 â€” Every 5 minutes
  // Grace-period aware: mark PENDING doses as MISSED only after
  // scheduledAt + schedule.gracePeriodMinutes has elapsed.
  // This is more precise than the hourly flat 60-min cutoff.
  // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  @Cron('*/5 * * * *')
  async markOverdueAsMissed(): Promise<void> {
    try {
      const now = new Date();

      // Fetch unresolved doses that are past their scheduled time.
      const overdueCandidates = await this.prisma.doseLog.findMany({
        where: {
          status: { in: [DoseStatus.PENDING, DoseStatus.SNOOZED] },
          scheduledAt: { lt: now },
        },
        include: {
          schedule: { select: { gracePeriodMinutes: true } },
        },
        take: 500, // safety cap per run
      });

      const toMiss: string[] = [];
      for (const log of overdueCandidates) {
        const deadline = doseMissDeadline({
          scheduledAt: log.scheduledAt,
          gracePeriodMinutes: log.schedule.gracePeriodMinutes,
          snoozeUntil: log.snoozeUntil,
        });
        if (now > deadline) {
          toMiss.push(log.id);
        }
      }

      if (toMiss.length === 0) return;

      const claimedIds: string[] = [];
      for (const id of toMiss) {
        const candidate = overdueCandidates.find((dose) => dose.id === id);
        if (!candidate) continue;
        const claim = await this.prisma.doseLog.updateMany({
          where: { id, status: candidate.status },
          data: {
            status: DoseStatus.MISSED,
            actionAt: now,
            actionSource: DoseActionSource.SYSTEM,
            snoozeUntil: null,
          },
        });
        if (claim.count === 1) claimedIds.push(id);
      }
      if (claimedIds.length === 0) return;

      this.logger.log(
        `Auto-marked ${claimedIds.length} overdue dose(s) as MISSED`,
      );

      // Group by userId for notifications
      const byUser: Record<string, number> = {};
      for (const log of overdueCandidates.filter((l) =>
        claimedIds.includes(l.id),
      )) {
        byUser[log.userId] = (byUser[log.userId] ?? 0) + 1;
      }

      for (const [uid, count] of Object.entries(byUser)) {
        try {
          // Get a sample medicine name for the notification
          const sample = overdueCandidates.find(
            (l) => l.userId === uid && claimedIds.includes(l.id),
          );
          if (!sample) continue;

          const sampleMed = await this.prisma.medicine.findUnique({
            where: { id: sample.medicineId },
            select: { name: true },
          });

          const medicineName =
            count === 1
              ? (sampleMed?.name ?? 'medicine')
              : `${sampleMed?.name ?? 'medicine'} and ${count - 1} other(s)`;

          await this.notificationsService.sendMissedDoseAlert({
            userId: uid,
            medicineName,
            scheduledAt: sample.scheduledAt,
            dedupeKey: `missed:${sample.id}`,
          });
        } catch (notifErr) {
          this.logger.error(
            `Failed to send missed-dose alert to user ${uid}: ${(notifErr as Error).message}`,
          );
        }
      }
    } catch (error) {
      this.logger.error(
        `markOverdueAsMissed failed: ${(error as Error).message}`,
        (error as Error).stack,
      );
    }
  }

  // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // CRON 3 â€” Every day at midnight
  // Generate next 7 days of dose logs + write adherence snapshots
  // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async dailyMaintenance(): Promise<void> {
    await this.generateWeeklyDoseLogs();
    await this.writeYesterdaySnapshots();
  }

  private async generateWeeklyDoseLogs(): Promise<void> {
    try {
      const totalCreated =
        await this.schedulesService.reconcileAllActiveDoseLogs(7);
      this.logger.log(
        `Daily dose log generation: ${totalCreated} timezone-safe new log(s)`,
      );
    } catch (error) {
      this.logger.error(
        `generateWeeklyDoseLogs failed: ${(error as Error).message}`,
        (error as Error).stack,
      );
    }
  }

  private async writeYesterdaySnapshots(): Promise<void> {
    try {
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      yesterday.setHours(0, 0, 0, 0);

      // Get all unique active users who have dose logs
      const activeUsers = await this.prisma.doseLog.groupBy({
        by: ['userId'],
        where: {
          scheduledAt: {
            gte: yesterday,
            lt: new Date(yesterday.getTime() + 24 * 60 * 60 * 1000),
          },
        },
      });

      let written = 0;
      for (const { userId } of activeUsers) {
        try {
          await this.dashboardService.writeAdherenceSnapshot(userId, yesterday);
          written++;
        } catch (err) {
          this.logger.error(
            `Snapshot failed for user ${userId}: ${(err as Error).message}`,
          );
        }
      }

      this.logger.log(
        `Adherence snapshots written: ${written}/${activeUsers.length} user(s) for ${yesterday.toISOString().split('T')[0]}`,
      );
    } catch (error) {
      this.logger.error(
        `writeYesterdaySnapshots failed: ${(error as Error).message}`,
        (error as Error).stack,
      );
    }
  }

  // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // CRON 4 â€” 09:00 daily: low stock alerts
  // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  @Cron('0 9 * * *')
  async checkLowStock(): Promise<void> {
    try {
      const medicines = await this.prisma.medicine.findMany({
        where: {
          isActive: true,
          remainingQuantity: { not: null },
          user: { isActive: true },
        },
        select: {
          id: true,
          userId: true,
          name: true,
          remainingQuantity: true,
          refillThreshold: true,
          lastStockAlertLevel: true,
          user: { select: { isActive: true } },
        },
      });

      let sent = 0;
      for (const medicine of medicines) {
        if (!medicine.user.isActive || medicine.remainingQuantity === null)
          continue;
        const level = this.stockAlertLevel(
          medicine.remainingQuantity,
          medicine.refillThreshold ?? 5,
        );

        if (!level) {
          if (medicine.lastStockAlertLevel) {
            await this.prisma.medicine.updateMany({
              where: {
                id: medicine.id,
                lastStockAlertLevel: medicine.lastStockAlertLevel,
              },
              data: { lastStockAlertLevel: null, lastStockAlertAt: null },
            });
          }
          continue;
        }

        if (
          medicine.lastStockAlertLevel &&
          this.stockAlertSeverity(level) <=
            this.stockAlertSeverity(medicine.lastStockAlertLevel)
        ) {
          continue;
        }

        const claimedAt = new Date();
        const claim = await this.prisma.medicine.updateMany({
          where: {
            id: medicine.id,
            lastStockAlertLevel: medicine.lastStockAlertLevel,
          },
          data: { lastStockAlertLevel: level, lastStockAlertAt: claimedAt },
        });
        if (claim.count !== 1) continue;

        try {
          await this.notificationsService.sendLowStockAlert({
            userId: medicine.userId,
            medicineId: medicine.id,
            medicineName: medicine.name,
            remainingQuantity: medicine.remainingQuantity,
            alertLevel: level,
          });
          sent++;
        } catch (error) {
          await this.prisma.medicine.updateMany({
            where: {
              id: medicine.id,
              lastStockAlertLevel: level,
              lastStockAlertAt: claimedAt,
            },
            data: {
              lastStockAlertLevel: medicine.lastStockAlertLevel,
              lastStockAlertAt: null,
            },
          });
          this.logger.error(
            `Low-stock notification failed for medicine ${medicine.id}: ${(error as Error).message}`,
          );
        }
      }

      if (sent > 0)
        this.logger.log(`Low stock check: ${sent} new alert(s) sent`);
    } catch (error) {
      this.logger.error(
        `checkLowStock failed: ${(error as Error).message}`,
        (error as Error).stack,
      );
    }
  }

  private stockAlertLevel(
    remaining: number,
    threshold: number,
  ): StockAlertLevel | null {
    if (remaining <= 0) return StockAlertLevel.OUT;
    if (remaining <= Math.max(1, Math.floor(threshold / 2))) {
      return StockAlertLevel.CRITICAL;
    }
    if (remaining <= threshold) return StockAlertLevel.LOW;
    return null;
  }

  private stockAlertSeverity(level: StockAlertLevel) {
    return level === StockAlertLevel.OUT
      ? 3
      : level === StockAlertLevel.CRITICAL
        ? 2
        : 1;
  }

  // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // CRON 5 â€” 23:30 daily: write today's snapshot early
  // Captures adherence data before midnight, useful for day-in-progress view
  // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  @Cron('30 23 * * *')
  async writeTodaySnapshot(): Promise<void> {
    try {
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const activeUsers = await this.prisma.doseLog.groupBy({
        by: ['userId'],
        where: {
          scheduledAt: {
            gte: today,
            lt: new Date(today.getTime() + 24 * 60 * 60 * 1000),
          },
        },
      });

      let written = 0;
      for (const { userId } of activeUsers) {
        try {
          await this.dashboardService.writeAdherenceSnapshot(userId, today);
          written++;
        } catch (err) {
          this.logger.error(
            `Today's snapshot failed for user ${userId}: ${(err as Error).message}`,
          );
        }
      }

      this.logger.log(
        `Today's adherence snapshots: ${written}/${activeUsers.length} written`,
      );
    } catch (error) {
      this.logger.error(
        `writeTodaySnapshot failed: ${(error as Error).message}`,
        (error as Error).stack,
      );
    }
  }
}
