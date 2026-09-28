import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { DoseStatus, RiskLevel } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

// ─────────────────────────────────────────────────────────
// MEDICAL SAFETY RULES (enforced throughout this service):
// 1. Adherence % is a personal tracking metric — NOT a clinical diagnosis
// 2. All wording is patient-safe and non-clinical
// 3. Risk levels drive UI styling only — NOT clinical risk
// 4. No "recovery percentage" or clinical outcome language
// 5. Disclaimer included in all dashboard responses
// ─────────────────────────────────────────────────────────

export type PeriodOption = '7d' | '14d' | '30d' | '90d';

export interface AdherenceBand {
  label: string;
  color: string;
  riskLevel: RiskLevel;
  message: string;
}

interface DoseStats {
  total: number;
  taken: number;
  missed: number;
  snoozed: number;
  skipped: number;
  pending: number;
}

@Injectable()
export class DashboardService {
  private readonly logger = new Logger(DashboardService.name);

  private readonly MEDICAL_DISCLAIMER =
    'This adherence indicator is for personal tracking only. ' +
    "Always follow your doctor's prescribed schedule. " +
    'Consult your doctor before making any changes to your medication.';

  constructor(private prisma: PrismaService) {}

  // ─────────────────────────────────────────────────────────
  // SUMMARY — lightweight home screen widget data
  // ─────────────────────────────────────────────────────────
  async getSummary(userId: string) {
    const now = new Date();
    const today = this.getDayBounds(now);
    const { from: weekFrom } = this.buildDateRange('7d');

    const [
      todayStats,
      weekStats,
      nextDose,
      activeMedicinesList,
      activeScheduleCount,
      activeMedicineCount,
      latestSnapshot,
    ] = await Promise.all([
      // Today full stats including PENDING
      this.getRawStats(userId, today.start, today.end, true),
      // 7-day stats (finalized only)
      this.getRawStats(userId, weekFrom, now, false),
      // Next upcoming PENDING dose
      this.prisma.doseLog.findFirst({
        where: { userId, status: DoseStatus.PENDING, scheduledAt: { gte: now } },
        orderBy: { scheduledAt: 'asc' },
        include: { medicine: { select: { id: true, name: true, form: true, strength: true } } },
      }),
      // Active medicines to compute custom low stock alert thresholds
      this.prisma.medicine.findMany({
        where: { userId, isActive: true },
        select: { id: true, name: true, remainingQuantity: true, form: true, refillThreshold: true, unit: true },
      }),
      this.prisma.medicineSchedule.count({ where: { userId, isActive: true } }),
      this.prisma.medicine.count({ where: { userId, isActive: true } }),
      // Latest adherence snapshot (most recent daily compute)
      this.prisma.adherenceSnapshot.findFirst({
        where: { userId },
        orderBy: { snapshotDate: 'desc' },
      }),
    ]);

    const todayFinalized = todayStats.taken + todayStats.missed + todayStats.snoozed + todayStats.skipped;
    const todayAdherencePercent = todayFinalized > 0
      ? Math.round((todayStats.taken / todayFinalized) * 100)
      : 0;

    const weekFinalized = weekStats.taken + weekStats.missed + weekStats.snoozed + weekStats.skipped;
    const weekAdherencePercent = weekFinalized > 0
      ? Math.round((weekStats.taken / weekFinalized) * 100)
      : 0;

    const lowStockAlerts = activeMedicinesList
      .filter((m) => {
        if (m.remainingQuantity === null) return false;
        const threshold = m.refillThreshold ?? 5;
        return m.remainingQuantity <= threshold;
      })
      .map((m) => ({
        id: m.id,
        name: m.name,
        remainingQuantity: m.remainingQuantity,
        form: m.form,
        unit: m.unit,
      }))
      .sort((a, b) => (a.remainingQuantity ?? 0) - (b.remainingQuantity ?? 0));

    return {
      today: {
        date: now.toISOString().split('T')[0],
        total: todayStats.total,
        taken: todayStats.taken,
        pending: todayStats.pending,
        missed: todayStats.missed,
        snoozed: todayStats.snoozed,
        skipped: todayStats.skipped,
        completionPercent: todayAdherencePercent,
      },
      week: {
        adherencePercent: weekAdherencePercent,
        taken: weekStats.taken,
        missed: weekStats.missed,
        total: weekFinalized,
      },
      nextDose: nextDose
        ? {
            id: nextDose.id,
            medicineName: nextDose.medicine.name,
            medicineForm: nextDose.medicine.form,
            strength: nextDose.medicine.strength,
            scheduledAt: nextDose.scheduledAt.toISOString(),
            minutesUntil: Math.round((nextDose.scheduledAt.getTime() - now.getTime()) / 60000),
          }
        : null,
      activeMedicines: activeMedicineCount,
      activeSchedules: activeScheduleCount,
      lowStockAlerts,
      currentStreak: latestSnapshot?.currentStreak ?? 0,
      riskLevel: latestSnapshot?.riskLevel ?? RiskLevel.LOW,
      disclaimer: this.MEDICAL_DISCLAIMER,
    };
  }

  // ─────────────────────────────────────────────────────────
  // ADHERENCE DASHBOARD — full analytics for a time period
  // ─────────────────────────────────────────────────────────
  async getAdherenceDashboard(userId: string, period: PeriodOption = '30d') {
    const { from, to } = this.buildDateRange(period);

    const [
      overallStats,
      dailyBreakdown,
      perMedicineBreakdown,
      streakData,
      activeScheduleCount,
      activeMedicineCount,
    ] = await Promise.all([
      this.getRawStats(userId, from, to, false),
      this.getDailyBreakdown(userId, from, to),
      this.getPerMedicineBreakdown(userId, from, to),
      this.calculateStreaks(userId),
      this.prisma.medicineSchedule.count({ where: { userId, isActive: true } }),
      this.prisma.medicine.count({ where: { userId, isActive: true } }),
    ]);

    const finalized = overallStats.taken + overallStats.missed + overallStats.snoozed + overallStats.skipped;
    const adherencePercent = this.calcPercent(overallStats.taken, finalized);
    const progressIndicator = this.getProgressIndicator(adherencePercent);

    return {
      summary: {
        period,
        from: from.toISOString().split('T')[0],
        to: to.toISOString().split('T')[0],
        activeMedicines: activeMedicineCount,
        activeSchedules: activeScheduleCount,
        totalFinalized: finalized,
        dosesTaken: overallStats.taken,
        dosesMissed: overallStats.missed,
        dosesSnoozed: overallStats.snoozed,
        dosesSkipped: overallStats.skipped,
        dosesPending: overallStats.pending,
      },
      adherence: {
        percent: adherencePercent,
        progressIndicator,
        disclaimer: this.MEDICAL_DISCLAIMER,
      },
      streak: streakData,
      dailyBreakdown,
      medicines: perMedicineBreakdown,
    };
  }

  // ─────────────────────────────────────────────────────────
  // DAILY BREAKDOWN — for chart rendering
  // ─────────────────────────────────────────────────────────
  async getDailyBreakdownApi(userId: string, from?: string, to?: string) {
    const toDate = to ? new Date(to) : new Date();
    const fromDate = from ? new Date(from) : new Date(toDate);

    if (!from) {
      fromDate.setDate(fromDate.getDate() - 29);
    }

    if (Number.isNaN(fromDate.getTime()) || Number.isNaN(toDate.getTime())) {
      return { error: 'Invalid date range. Use YYYY-MM-DD dates.', data: [] };
    }

    fromDate.setHours(0, 0, 0, 0);
    toDate.setHours(23, 59, 59, 999);

    if (fromDate.getTime() > toDate.getTime()) {
      return { error: 'Start date must be before end date', data: [] };
    }

    // Guard: max 92 days to prevent large queries
    const diffDays = Math.round((toDate.getTime() - fromDate.getTime()) / (1000 * 60 * 60 * 24));
    if (diffDays > 92) {
      return { error: 'Date range cannot exceed 92 days', data: [] };
    }

    const breakdown = await this.getDailyBreakdown(userId, fromDate, toDate);
    return {
      from: fromDate.toISOString().split('T')[0],
      to: toDate.toISOString().split('T')[0],
      days: diffDays + 1,
      data: breakdown,
    };
  }
  async getWeeklySummary(userId: string) {
    const to = new Date();
    to.setHours(23, 59, 59, 999);
    const from = new Date(to);
    from.setDate(from.getDate() - 27); // 4 weeks
    from.setHours(0, 0, 0, 0);

    const logs = await this.prisma.doseLog.findMany({
      where: {
        userId,
        scheduledAt: { gte: from, lte: to },
        status: { not: DoseStatus.PENDING },
      },
      select: { scheduledAt: true, status: true },
      orderBy: { scheduledAt: 'asc' },
    });

    // Group into 4 ISO weeks
    const weeks: Record<string, { taken: number; missed: number; snoozed: number; skipped: number; start: Date }> = {};

    for (const log of logs) {
      const weekKey = this.getISOWeekKey(log.scheduledAt);
      if (!weeks[weekKey]) {
        const weekStart = this.getWeekStart(log.scheduledAt);
        weeks[weekKey] = { taken: 0, missed: 0, snoozed: 0, skipped: 0, start: weekStart };
      }
      const k = log.status.toLowerCase() as 'taken' | 'missed' | 'snoozed' | 'skipped';
      weeks[weekKey][k]++;
    }

    const weekSummaries = Object.entries(weeks)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([weekKey, data]) => {
        const total = data.taken + data.missed + data.snoozed + data.skipped;
        const adherencePercent = this.calcPercent(data.taken, total);
        const weekEnd = new Date(data.start);
        weekEnd.setDate(weekEnd.getDate() + 6);
        return {
          weekKey,
          weekStart: data.start.toISOString().split('T')[0],
          weekEnd: weekEnd.toISOString().split('T')[0],
          total,
          taken: data.taken,
          missed: data.missed,
          snoozed: data.snoozed,
          skipped: data.skipped,
          adherencePercent,
          progressIndicator: this.getProgressIndicator(adherencePercent),
        };
      });

    const grandTotal = weekSummaries.reduce((s, w) => s + w.total, 0);
    const grandTaken = weekSummaries.reduce((s, w) => s + w.taken, 0);

    return {
      from: from.toISOString().split('T')[0],
      to: to.toISOString().split('T')[0],
      overallAdherencePercent: this.calcPercent(grandTaken, grandTotal),
      weeks: weekSummaries,
    };
  }

  // ─────────────────────────────────────────────────────────
  // MONTHLY SUMMARY — current month + trend vs previous month
  // ─────────────────────────────────────────────────────────
  async getMonthlySummary(userId: string) {
    const now = new Date();

    // Current month
    const currentMonthStart = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0);
    const currentMonthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);

    // Previous month
    const prevMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1, 0, 0, 0);
    const prevMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59);

    const [currentStats, prevStats, dailyBreakdown] = await Promise.all([
      this.getRawStats(userId, currentMonthStart, currentMonthEnd, false),
      this.getRawStats(userId, prevMonthStart, prevMonthEnd, false),
      this.getDailyBreakdown(userId, currentMonthStart, currentMonthEnd),
    ]);

    const currentFinalized = currentStats.taken + currentStats.missed + currentStats.snoozed + currentStats.skipped;
    const prevFinalized = prevStats.taken + prevStats.missed + prevStats.snoozed + prevStats.skipped;

    const currentPercent = this.calcPercent(currentStats.taken, currentFinalized);
    const prevPercent = this.calcPercent(prevStats.taken, prevFinalized);
    const trend = currentPercent - prevPercent;

    return {
      currentMonth: {
        month: now.toLocaleString('en-US', { month: 'long', year: 'numeric' }),
        from: currentMonthStart.toISOString().split('T')[0],
        to: now.toISOString().split('T')[0],
        taken: currentStats.taken,
        missed: currentStats.missed,
        snoozed: currentStats.snoozed,
        skipped: currentStats.skipped,
        total: currentFinalized,
        adherencePercent: currentPercent,
        progressIndicator: this.getProgressIndicator(currentPercent),
      },
      previousMonth: {
        month: prevMonthStart.toLocaleString('en-US', { month: 'long', year: 'numeric' }),
        adherencePercent: prevPercent,
        taken: prevStats.taken,
        total: prevFinalized,
      },
      trend: {
        direction: trend > 0 ? 'improving' : trend < 0 ? 'declining' : 'stable',
        change: Math.abs(Math.round(trend)),
        message:
          trend > 5
            ? 'Great improvement this month!'
            : trend < -5
            ? 'Adherence has dropped this month. Try to stay consistent.'
            : 'Adherence is stable this month.',
      },
      dailyBreakdown,
      disclaimer: this.MEDICAL_DISCLAIMER,
    };
  }

  // ─────────────────────────────────────────────────────────
  // PER-MEDICINE ANALYTICS — single medicine detail
  // ─────────────────────────────────────────────────────────
  async getMedicineAnalytics(userId: string, medicineId: string, period: PeriodOption = '30d') {
    // Ownership check
    const medicine = await this.prisma.medicine.findUnique({
      where: { id: medicineId },
      include: {
        schedules: { where: { isActive: true }, select: { id: true, frequency: true, timesOfDay: true, dosesPerIntake: true, unit: true } },
      },
    });

    if (!medicine) throw new NotFoundException('Medicine not found');
    if (medicine.userId !== userId) throw new NotFoundException('Medicine not found');

    const { from, to } = this.buildDateRange(period);

    const [stats, dailyBreakdown] = await Promise.all([
      this.getRawStats(userId, from, to, false, medicineId),
      this.getDailyBreakdown(userId, from, to, medicineId),
    ]);

    const finalized = stats.taken + stats.missed + stats.snoozed + stats.skipped;
    const adherencePercent = this.calcPercent(stats.taken, finalized);

    return {
      medicine: {
        id: medicine.id,
        name: medicine.name,
        genericName: medicine.genericName,
        brandName: medicine.brandName,
        form: medicine.form,
        strength: medicine.strength,
        remainingQuantity: medicine.remainingQuantity,
        totalQuantity: medicine.totalQuantity,
        isActive: medicine.isActive,
        activeSchedules: medicine.schedules,
      },
      period,
      from: from.toISOString().split('T')[0],
      to: to.toISOString().split('T')[0],
      stats: {
        total: finalized,
        taken: stats.taken,
        missed: stats.missed,
        snoozed: stats.snoozed,
        skipped: stats.skipped,
        pending: stats.pending,
        adherencePercent,
        progressIndicator: this.getProgressIndicator(adherencePercent),
      },
      dailyBreakdown,
      disclaimer: this.MEDICAL_DISCLAIMER,
    };
  }

  // ─────────────────────────────────────────────────────────
  // SNAPSHOT WRITER — called nightly by scheduler
  // Writes one AdherenceSnapshot per user per day
  // Idempotent via upsert
  // ─────────────────────────────────────────────────────────
  async writeAdherenceSnapshot(userId: string, snapshotDate: Date): Promise<void> {
    const { start, end } = this.getDayBounds(snapshotDate);

    const [stats, streakData] = await Promise.all([
      this.getRawStats(userId, start, end, false),
      this.calculateStreaks(userId),
    ]);

    const finalized = stats.taken + stats.missed + stats.snoozed + stats.skipped;
    const adherencePercent = this.calcPercent(stats.taken, finalized);
    const riskLevel = this.getRiskLevel(adherencePercent);

    await this.prisma.adherenceSnapshot.upsert({
      where: { userId_snapshotDate: { userId, snapshotDate: start } },
      create: {
        userId,
        snapshotDate: start,
        totalScheduled: stats.total,
        totalTaken: stats.taken,
        totalMissed: stats.missed,
        totalSnoozed: stats.snoozed,
        totalSkipped: stats.skipped,
        adherencePercent,
        currentStreak: streakData.currentStreak,
        riskLevel,
      },
      update: {
        totalScheduled: stats.total,
        totalTaken: stats.taken,
        totalMissed: stats.missed,
        totalSnoozed: stats.snoozed,
        totalSkipped: stats.skipped,
        adherencePercent,
        currentStreak: streakData.currentStreak,
        riskLevel,
      },
    });
  }

  // ─────────────────────────────────────────────────────────
  // ADHERENCE TRENDS — from snapshots (fast read)
  // ─────────────────────────────────────────────────────────
  async getAdherenceTrends(userId: string, days = 30) {
    const safeDays = Math.min(Math.max(days, 7), 90);
    const from = new Date();
    from.setDate(from.getDate() - safeDays);
    from.setHours(0, 0, 0, 0);

    const snapshots = await this.prisma.adherenceSnapshot.findMany({
      where: { userId, snapshotDate: { gte: from } },
      orderBy: { snapshotDate: 'asc' },
    });

    const avgAdherence =
      snapshots.length > 0
        ? Math.round(snapshots.reduce((s, snap) => s + snap.adherencePercent, 0) / snapshots.length)
        : 0;

    return {
      days: safeDays,
      dataPoints: snapshots.length,
      averageAdherencePercent: avgAdherence,
      progressIndicator: this.getProgressIndicator(avgAdherence),
      trend: snapshots.map((s) => ({
        date: s.snapshotDate.toISOString().split('T')[0],
        adherencePercent: s.adherencePercent,
        taken: s.totalTaken,
        missed: s.totalMissed,
        streak: s.currentStreak,
        riskLevel: s.riskLevel,
      })),
    };
  }

  // ═══════════════════════════════════════════════════════════
  // PRIVATE HELPERS
  // ═══════════════════════════════════════════════════════════

  // ─────────────────────────────────────────────────────────
  // Raw dose stats query — single optimised batch
  // includePending = true counts PENDING in total (for today's view)
  // includePending = false excludes PENDING (for adherence calculation)
  // ─────────────────────────────────────────────────────────
  private async getRawStats(
    userId: string,
    from: Date,
    to: Date,
    includePending: boolean,
    medicineId?: string,
  ): Promise<DoseStats> {
    const baseWhere = {
      userId,
      scheduledAt: { gte: from, lte: to },
      ...(medicineId ? { medicineId } : {}),
    };

    const [total, taken, missed, snoozed, skipped, pending] = await Promise.all([
      this.prisma.doseLog.count({ where: baseWhere }),
      this.prisma.doseLog.count({ where: { ...baseWhere, status: DoseStatus.TAKEN } }),
      this.prisma.doseLog.count({ where: { ...baseWhere, status: DoseStatus.MISSED } }),
      this.prisma.doseLog.count({ where: { ...baseWhere, status: DoseStatus.SNOOZED } }),
      this.prisma.doseLog.count({ where: { ...baseWhere, status: DoseStatus.SKIPPED } }),
      this.prisma.doseLog.count({ where: { ...baseWhere, status: DoseStatus.PENDING } }),
    ]);

    return { total, taken, missed, snoozed, skipped, pending };
  }

  // ─────────────────────────────────────────────────────────
  // Daily breakdown — grouped by date for chart rendering
  // ─────────────────────────────────────────────────────────
  private async getDailyBreakdown(
    userId: string,
    from: Date,
    to: Date,
    medicineId?: string,
  ) {
    const logs = await this.prisma.doseLog.findMany({
      where: {
        userId,
        scheduledAt: { gte: from, lte: to },
        status: { not: DoseStatus.PENDING },
        ...(medicineId ? { medicineId } : {}),
      },
      select: { scheduledAt: true, status: true },
      orderBy: { scheduledAt: 'asc' },
    });

    const breakdown: Record<
      string,
      { date: string; taken: number; missed: number; snoozed: number; skipped: number; adherencePercent: number }
    > = {};

    for (const log of logs) {
      const key = log.scheduledAt.toISOString().split('T')[0];
      if (!breakdown[key]) {
        breakdown[key] = { date: key, taken: 0, missed: 0, snoozed: 0, skipped: 0, adherencePercent: 0 };
      }
      const k = log.status.toLowerCase() as 'taken' | 'missed' | 'snoozed' | 'skipped';
      breakdown[key][k]++;
    }

    // Compute adherencePercent per day
    for (const day of Object.values(breakdown)) {
      const total = day.taken + day.missed + day.snoozed + day.skipped;
      day.adherencePercent = this.calcPercent(day.taken, total);
    }

    return Object.values(breakdown);
  }

  // ─────────────────────────────────────────────────────────
  // Per-medicine breakdown — avoids N+1 with a single aggregation
  // ─────────────────────────────────────────────────────────
  private async getPerMedicineBreakdown(userId: string, from: Date, to: Date) {
    // Single query: group by medicineId + status
    const grouped = await this.prisma.doseLog.groupBy({
      by: ['medicineId', 'status'],
      where: {
        userId,
        scheduledAt: { gte: from, lte: to },
        status: { not: DoseStatus.PENDING },
      },
      _count: { id: true },
    });

    // Fetch medicine details in one query
    const medicineIds = [...new Set(grouped.map((g) => g.medicineId))];
    if (medicineIds.length === 0) return [];

    const medicines = await this.prisma.medicine.findMany({
      where: { id: { in: medicineIds } },
      select: { id: true, name: true, form: true, strength: true },
    });
    const medMap = new Map(medicines.map((m) => [m.id, m]));

    // Aggregate
    const perMed: Record<string, { taken: number; missed: number; snoozed: number; skipped: number }> = {};
    for (const row of grouped) {
      if (!perMed[row.medicineId]) {
        perMed[row.medicineId] = { taken: 0, missed: 0, snoozed: 0, skipped: 0 };
      }
      const k = row.status.toLowerCase() as 'taken' | 'missed' | 'snoozed' | 'skipped';
      perMed[row.medicineId][k] = row._count.id;
    }

    return Object.entries(perMed).map(([medId, stats]) => {
      const med = medMap.get(medId);
      const total = stats.taken + stats.missed + stats.snoozed + stats.skipped;
      const adherencePercent = this.calcPercent(stats.taken, total);
      return {
        medicineId: medId,
        medicineName: med?.name ?? 'Unknown',
        medicineForm: med?.form ?? 'TABLET',
        strength: med?.strength ?? null,
        totalDoses: total,
        taken: stats.taken,
        missed: stats.missed,
        snoozed: stats.snoozed,
        skipped: stats.skipped,
        adherencePercent,
        progressIndicator: this.getProgressIndicator(adherencePercent),
      };
    });
  }

  // ─────────────────────────────────────────────────────────
  // Streak calculator — correct algorithm
  // currentStreak: consecutive days ending today (or yesterday)
  //   where at least 1 TAKEN dose exists
  // bestStreak: longest such run in the last 90 days
  // ─────────────────────────────────────────────────────────
  async calculateStreaks(userId: string): Promise<{
    currentStreak: number;
    bestStreak: number;
    streakUnit: string;
    streakMessage: string;
  }> {
    const ninetyDaysAgo = new Date();
    ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
    ninetyDaysAgo.setHours(0, 0, 0, 0);

    const logs = await this.prisma.doseLog.findMany({
      where: {
        userId,
        scheduledAt: { gte: ninetyDaysAgo },
        status: DoseStatus.TAKEN,
      },
      select: { scheduledAt: true },
      orderBy: { scheduledAt: 'desc' },
    });

    // Build a Set of dates that have at least one TAKEN dose
    const takenDates = new Set(logs.map((l) => l.scheduledAt.toISOString().split('T')[0]));

    const today = new Date();
    let currentStreak = 0;
    let bestStreak = 0;
    let tempStreak = 0;

    for (let i = 0; i < 90; i++) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      const key = d.toISOString().split('T')[0];

      if (takenDates.has(key)) {
        tempStreak++;
        bestStreak = Math.max(bestStreak, tempStreak);

        // currentStreak: must be consecutive starting from day 0 or 1
        // (today may be incomplete so we allow gap at i=0)
        if (i === 0 || i === currentStreak) {
          currentStreak = tempStreak;
        }
      } else {
        // Today hasn't had a TAKEN dose yet — don't break the streak
        if (i > 0) {
          tempStreak = 0;
        }
      }
    }

    const streakMessage =
      currentStreak >= 14
        ? `${currentStreak}-day streak! Outstanding consistency.`
        : currentStreak >= 7
        ? 'Great consistency! Keep following your schedule.'
        : currentStreak >= 3
        ? 'Good progress — stay consistent with your schedule.'
        : currentStreak >= 1
        ? 'You\'re building a healthy routine — keep going!'
        : 'Start your streak today by taking your first dose.';

    return { currentStreak, bestStreak, streakUnit: 'days', streakMessage };
  }

  // Keep this method for backward compatibility with Phase 1 DashboardService calls
  async getAdherenceDashboardLegacy(userId: string, period: PeriodOption = '30d') {
    return this.getAdherenceDashboard(userId, period);
  }

  // Phase 1 backward compat
  async getQuickStats(userId: string) {
    return this.getSummary(userId);
  }

  // ─────────────────────────────────────────────────────────
  // Pure calculation helpers — no DB calls
  // ─────────────────────────────────────────────────────────

  private calcPercent(taken: number, total: number): number {
    // Guard: division by zero
    if (!total || total <= 0) return 0;
    if (!taken || taken < 0) return 0;
    return Math.min(100, Math.round((taken / total) * 100));
  }

  private getProgressIndicator(percent: number): AdherenceBand {
    if (percent >= 90) return { label: 'Excellent', color: 'green', riskLevel: RiskLevel.LOW, message: 'Health indicators show strong consistency. Keep following your prescribed schedule.' };
    if (percent >= 75) return { label: 'Good', color: 'lime', riskLevel: RiskLevel.LOW, message: 'Health indicators show positive progress. A few doses were missed — try to stay consistent.' };
    if (percent >= 50) return { label: 'Needs Attention', color: 'yellow', riskLevel: RiskLevel.MEDIUM, message: 'Several doses were missed. Consistent intake improves treatment effectiveness. Speak with your doctor if you are having difficulty.' };
    return { label: 'Low', color: 'red', riskLevel: RiskLevel.HIGH, message: 'Many doses have been missed. Please consult your doctor — do not stop or change medicines on your own.' };
  }

  private getRiskLevel(adherencePercent: number): RiskLevel {
    if (adherencePercent >= 80) return RiskLevel.LOW;
    if (adherencePercent >= 50) return RiskLevel.MEDIUM;
    return RiskLevel.HIGH;
  }

  private buildDateRange(period: PeriodOption): { from: Date; to: Date } {
    const to = new Date();
    to.setHours(23, 59, 59, 999);
    const from = new Date();
    const days = parseInt(period.replace('d', ''), 10);
    from.setDate(from.getDate() - (days - 1));
    from.setHours(0, 0, 0, 0);
    return { from, to };
  }

  private getDayBounds(date: Date): { start: Date; end: Date } {
    const start = new Date(date);
    start.setHours(0, 0, 0, 0);
    const end = new Date(date);
    end.setHours(23, 59, 59, 999);
    return { start, end };
  }

  private getISOWeekKey(date: Date): string {
    const d = new Date(date);
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() + 4 - (d.getDay() || 7));
    const year = d.getFullYear();
    const week = Math.ceil(((d.getTime() - new Date(year, 0, 1).getTime()) / 86400000 + 1) / 7);
    return `${year}-W${String(week).padStart(2, '0')}`;
  }

  private getWeekStart(date: Date): Date {
    const d = new Date(date);
    const day = d.getDay(); // 0 = Sunday
    d.setDate(d.getDate() - day);
    d.setHours(0, 0, 0, 0);
    return d;
  }
}