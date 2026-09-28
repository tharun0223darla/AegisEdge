import {
  BadRequestException,
  Injectable,
  NotFoundException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { InventoryEventType, RefillOrderStatus } from '@prisma/client/index';
import { PrismaService } from '../prisma/prisma.service';
import {
  isAllowedPharmacyProductUrl,
  isPharmacyProvider,
  PHARMACY_PROVIDERS,
} from './pharmacy-provider.config';
import { findJanAushadhiSubstitute } from './jan-aushadhi.config';
import { buildPharmacySearchQuery } from './pharmacy-search-query';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { CorrectStockDto } from './dto/correct-stock.dto';
import { CreateRefillOrderDto } from './dto/create-refill-order.dto';
import { ReceiveRefillOrderDto } from './dto/receive-refill-order.dto';

const VERIFIED_PURCHASE_LINK_MAX_AGE_MS = 180 * 24 * 60 * 60 * 1000;

interface RefillForecastSchedule {
  frequency: string;
  timesOfDay: string[];
  daysOfWeek: number[];
  startDate: Date;
  endDate: Date | null;
  dosesPerIntake: number;
}

interface RefillForecastMedicine {
  id: string;
  medicinePackageId: string | null;
  name: string;
  form: string;
  strength: string | null;
  unit: string | null;
  remainingQuantity: number | null;
  totalQuantity: number | null;
  refillThreshold: number | null;
  schedules: RefillForecastSchedule[];
  refillLogs: Array<{
    dailyUsage: number;
    expectedFinishDate: Date;
    refillReminderDate: Date;
    totalQuantity: number;
    createdAt: Date;
  }>;
  refillOrders: Array<{
    id: string;
    status: string;
    provider: string | null;
    expectedQuantity: number | null;
    orderedAt: Date;
    expectedAt: Date | null;
  }>;
  inventoryEvents: Array<{
    id: string;
    type: string;
    delta: number;
    quantityBefore: number | null;
    quantityAfter: number;
    reason: string | null;
    createdAt: Date;
  }>;
  medicinePackage?: {
    id: string;
    packSize: string | null;
  } | null;
  medicineMaster?: {
    brandName: string;
    composition: string | null;
    manufacturer: string | null;
    strength: string | null;
    purchaseLinks: Array<{
      provider: string;
      productUrl: string;
      verifiedAt: Date | null;
      lastCheckedAt: Date | null;
      medicinePackage: {
        id: string;
        packSize: string | null;
      } | null;
    }>;
  } | null;
}

export interface RefillPurchaseOption {
  provider: string;
  providerLabel: string;
  url: string;
  matchType: 'VERIFIED_PRODUCT' | 'PROVIDER_SEARCH';
  queryPrefilled: boolean;
  packSize: string | null;
  verifiedAt: string | null;
  matchScope: 'PACKAGE' | 'MEDICINE' | null;
}

@Injectable()
export class RefillsService {
  private readonly logger = new Logger(RefillsService.name);

  constructor(
    private prisma: PrismaService,
    private auditLogs: AuditLogsService,
  ) {}

  // ─────────────────────────────────────────────────────────
  // LIST: all refill logs for the user (paginated)
  // ─────────────────────────────────────────────────────────
  async findAll(userId: string, page = 1, limit = 20) {
    const skip = (page - 1) * limit;

    const [total, logs] = await Promise.all([
      this.prisma.refillLog.count({ where: { userId } }),
      this.prisma.refillLog.findMany({
        where: { userId },
        skip,
        take: Math.min(limit, 50),
        orderBy: { createdAt: 'desc' },
        include: {
          medicine: {
            select: {
              id: true,
              name: true,
              form: true,
              strength: true,
              remainingQuantity: true,
            },
          },
        },
      }),
    ]);

    return {
      data: logs.map((log) => this.enrichRefillLog(log)),
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }

  // ─────────────────────────────────────────────────────────
  // GET ONE: single refill log by id
  // ─────────────────────────────────────────────────────────
  async findOne(userId: string, id: string) {
    const log = await this.prisma.refillLog.findUnique({
      where: { id },
      include: {
        medicine: {
          select: {
            id: true,
            name: true,
            form: true,
            strength: true,
            remainingQuantity: true,
            totalQuantity: true,
          },
        },
      },
    });

    if (!log) throw new NotFoundException('Refill log not found');
    if (log.userId !== userId) {
      throw new ForbiddenException('You do not have access to this refill log');
    }

    return this.enrichRefillLog(log);
  }

  // ─────────────────────────────────────────────────────────
  // UPCOMING: medicines whose refill reminder date is coming soon
  // Returns logs where refillReminderDate <= today + lookAheadDays
  // ─────────────────────────────────────────────────────────
  async getUpcoming(userId: string, lookAheadDays = 7) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const windowEnd = new Date(today);
    windowEnd.setDate(windowEnd.getDate() + lookAheadDays);
    windowEnd.setHours(23, 59, 59, 999);

    // Also include any that are already past due (overdue refills)
    const upcomingLogs = await this.prisma.refillLog.findMany({
      where: {
        userId,
        refillReminderDate: { lte: windowEnd },
      },
      orderBy: { refillReminderDate: 'asc' },
      include: {
        medicine: {
          select: {
            id: true,
            name: true,
            form: true,
            strength: true,
            remainingQuantity: true,
          },
        },
      },
    });

    const now = new Date();

    return {
      lookAheadDays,
      count: upcomingLogs.length,
      data: upcomingLogs.map((log) => {
        const enriched = this.enrichRefillLog(log);
        const daysUntilReminder = Math.ceil(
          (log.refillReminderDate.getTime() - now.getTime()) /
            (1000 * 60 * 60 * 24),
        );

        return {
          ...enriched,
          daysUntilReminder,
          urgency:
            daysUntilReminder <= 0
              ? 'overdue'
              : daysUntilReminder <= 2
                ? 'urgent'
                : daysUntilReminder <= 5
                  ? 'soon'
                  : 'upcoming',
        };
      }),
    };
  }

  // ─────────────────────────────────────────────────────────
  // JAN AUSHADHI: generic substitute mapping
  // ─────────────────────────────────────────────────────────
  async getGenericSubstitute(userId: string, medicineId: string) {
    const medicine = await this.prisma.medicine.findFirst({
      where: { id: medicineId, userId, isActive: true },
      include: {
        medicineMaster: {
          select: { composition: true, brandName: true },
        },
      },
    });

    if (!medicine) throw new NotFoundException('Active medicine not found');

    const substitute = findJanAushadhiSubstitute(
      medicine.name,
      medicine.medicineMaster?.composition,
    );

    return {
      medicineId: medicine.id,
      medicineName: medicine.name,
      strength: medicine.strength,
      substitute,
      hasJanAushadhiEquivalent: Boolean(substitute),
      estimatedSavingsPercent: substitute
        ? Math.round(
            ((substitute.brandedAveragePrice - substitute.janAushadhiPrice) /
              substitute.brandedAveragePrice) *
              100,
          )
        : 0,
    };
  }

  // ─────────────────────────────────────────────────────────
  // SUMMARY: per-medicine current stock status
  // Combines Medicine.remainingQuantity with latest RefillLog
  // ─────────────────────────────────────────────────────────
  async getStockSummary(userId: string) {
    const medicines = (await this.prisma.medicine.findMany({
      where: { userId, isActive: true },
      select: {
        id: true,
        medicinePackageId: true,
        name: true,
        form: true,
        strength: true,
        unit: true,
        remainingQuantity: true,
        totalQuantity: true,
        refillThreshold: true,
        schedules: {
          where: { isActive: true },
          select: {
            frequency: true,
            timesOfDay: true,
            daysOfWeek: true,
            startDate: true,
            endDate: true,
            dosesPerIntake: true,
          },
        },
        refillLogs: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: {
            dailyUsage: true,
            expectedFinishDate: true,
            refillReminderDate: true,
            totalQuantity: true,
            createdAt: true,
          },
        },
        refillOrders: {
          where: { status: RefillOrderStatus.ORDERED },
          orderBy: { orderedAt: 'desc' },
          take: 1,
          select: {
            id: true,
            status: true,
            provider: true,
            expectedQuantity: true,
            orderedAt: true,
            expectedAt: true,
          },
        },
        inventoryEvents: {
          orderBy: { createdAt: 'desc' },
          take: 5,
          select: {
            id: true,
            type: true,
            delta: true,
            quantityBefore: true,
            quantityAfter: true,
            reason: true,
            createdAt: true,
          },
        },
        medicinePackage: {
          select: {
            id: true,
            packSize: true,
          },
        },
        medicineMaster: {
          select: {
            brandName: true,
            composition: true,
            manufacturer: true,
            strength: true,
            purchaseLinks: {
              where: {
                isActive: true,
                isVerified: true,
              },
              orderBy: [{ provider: 'asc' }, { verifiedAt: 'desc' }],
              select: {
                provider: true,
                productUrl: true,
                verifiedAt: true,
                lastCheckedAt: true,
                medicinePackage: {
                  select: {
                    id: true,
                    packSize: true,
                  },
                },
              },
            },
          },
        },
      },
      orderBy: { name: 'asc' },
    })) as unknown as RefillForecastMedicine[];

    const today = new Date();

    return medicines.map((med) => {
      const latestRefill = med.refillLogs[0];
      const pendingOrder = med.refillOrders?.[0] ?? null;
      const recentInventoryEvents = med.inventoryEvents ?? [];
      const latestReceivedEvent = recentInventoryEvents.find(
        (event) => event.type === InventoryEventType.REFILL_RECEIVED,
      );
      const remaining = med.remainingQuantity;
      const scheduledDailyUsage = this.scheduledDailyUsage(
        med.schedules,
        today,
      );
      const refillDailyUsage =
        latestRefill?.dailyUsage && latestRefill.dailyUsage > 0
          ? latestRefill.dailyUsage
          : null;
      const dailyUsage = scheduledDailyUsage ?? refillDailyUsage;
      const forecastBasis =
        scheduledDailyUsage !== null
          ? 'ACTIVE_SCHEDULE'
          : refillDailyUsage !== null
            ? 'REFILL_HISTORY'
            : med.refillThreshold !== null
              ? 'THRESHOLD_ONLY'
              : 'NONE';

      const pharmacySearchQuery = buildPharmacySearchQuery({
        name: med.medicineMaster?.brandName ?? med.name,
        strength: med.strength ?? med.medicineMaster?.strength,
        form: med.form,
      });
      const estimatedDaysRemaining =
        remaining !== null && dailyUsage && dailyUsage > 0
          ? Math.floor(remaining / dailyUsage)
          : null;

      const estimatedFinishDate =
        estimatedDaysRemaining !== null
          ? this.addUtcDays(today, estimatedDaysRemaining)
              .toISOString()
              .slice(0, 10)
          : null;
      const suggestedRefillDate =
        estimatedDaysRemaining !== null
          ? this.addUtcDays(today, Math.max(0, estimatedDaysRemaining - 5))
              .toISOString()
              .slice(0, 10)
          : null;
      const stockStatus = this.getForecastStockStatus(
        remaining,
        estimatedDaysRemaining,
        med.refillThreshold,
      );

      return {
        medicineId: med.id,
        medicineName: med.name,
        medicineForm: med.form,
        strength: med.strength,
        unit: med.unit,
        remainingQuantity: remaining,
        totalQuantity: med.totalQuantity,
        refillThreshold: med.refillThreshold,
        dailyUsage,
        estimatedDaysRemaining,
        estimatedFinishDate,
        suggestedRefillDate,
        stockStatus,
        needsRefill: ['OUT', 'CRITICAL', 'LOW'].includes(stockStatus),
        forecastBasis,
        forecastConfidence:
          forecastBasis === 'ACTIVE_SCHEDULE'
            ? 'SCHEDULE_BASED'
            : forecastBasis === 'REFILL_HISTORY'
              ? 'HISTORY_BASED'
              : 'LIMITED',
        pharmacySearchQuery,
        pharmacyIdentity: {
          brandName: med.medicineMaster?.brandName ?? med.name,
          composition: med.medicineMaster?.composition ?? null,
          manufacturer: med.medicineMaster?.manufacturer ?? null,
          packSize: med.medicinePackage?.packSize ?? null,
          identityLevel: med.medicinePackage
            ? 'PACKAGE'
            : med.medicineMaster
              ? 'MEDICINE'
              : 'MANUAL',
        },
        purchaseOptions: this.buildPurchaseOptions(med, pharmacySearchQuery),
        pendingOrder: pendingOrder
          ? {
              ...pendingOrder,
              orderedAt: pendingOrder.orderedAt.toISOString(),
              expectedAt: pendingOrder.expectedAt?.toISOString() ?? null,
            }
          : null,
        recentInventoryEvents: recentInventoryEvents.map((event) => ({
          ...event,
          createdAt: event.createdAt.toISOString(),
        })),
        lastRefillDate: this.latestDate(
          latestRefill?.createdAt ?? null,
          latestReceivedEvent?.createdAt ?? null,
        ),
        janAushadhiSubstitute: findJanAushadhiSubstitute(
          med.name,
          med.medicineMaster?.composition,
        ),
      };
    });
  }

  async createOrder(
    userId: string,
    medicineId: string,
    dto: CreateRefillOrderDto,
    idempotencyKey: string,
  ) {
    const result = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`refill-order:${medicineId}`}))`;

      const replay = await tx.refillOrder.findFirst({
        where: { userId, idempotencyKey },
      });
      if (replay) {
        if (replay.medicineId !== medicineId) {
          throw new BadRequestException(
            'This idempotency key was already used for another medicine.',
          );
        }
        return { order: replay, replayed: true, created: false };
      }

      const medicine = await tx.medicine.findFirst({
        where: { id: medicineId, userId, isActive: true },
        select: { id: true, name: true },
      });
      if (!medicine) throw new NotFoundException('Active medicine not found');

      const pending = await tx.refillOrder.findFirst({
        where: { userId, medicineId, status: RefillOrderStatus.ORDERED },
        orderBy: { orderedAt: 'desc' },
      });
      if (pending) return { order: pending, replayed: true, created: false };

      const order = await tx.refillOrder.create({
        data: {
          userId,
          medicineId,
          provider: dto.provider?.trim() || null,
          expectedQuantity: dto.expectedQuantity,
          externalReference: dto.externalReference?.trim() || null,
          expectedAt: dto.expectedAt ? new Date(dto.expectedAt) : null,
          notes: dto.notes?.trim() || null,
          idempotencyKey,
        },
      });
      return {
        order,
        replayed: false,
        created: true,
        medicineName: medicine.name,
      };
    });

    if (result.created) {
      await this.auditLogs.log({
        userId,
        action: 'REFILL_LOGGED',
        entityType: 'RefillOrder',
        entityId: result.order.id,
        newValues: {
          medicineId,
          provider: result.order.provider,
          expectedQuantity: result.order.expectedQuantity,
          status: result.order.status,
        },
      });
    }

    return { ...result.order, replayed: result.replayed };
  }

  async receiveOrder(
    userId: string,
    orderId: string,
    dto: ReceiveRefillOrderDto,
    idempotencyKey: string,
  ) {
    const result = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`refill-receive:${orderId}`}))`;

      const order = await tx.refillOrder.findFirst({
        where: { id: orderId, userId },
        include: { medicine: true },
      });
      if (!order) throw new NotFoundException('Refill order not found');

      const replayEvent = await tx.medicineInventoryEvent.findFirst({
        where: { userId, idempotencyKey },
      });
      if (replayEvent) {
        if (replayEvent.sourceReference !== order.id) {
          throw new BadRequestException(
            'This idempotency key was already used for another inventory change.',
          );
        }
        if (order.status !== RefillOrderStatus.RECEIVED) {
          throw new BadRequestException(
            'The previous refill receipt is incomplete. No stock was changed.',
          );
        }
        return {
          order,
          medicine: order.medicine,
          replayed: true,
          changed: false,
        };
      }

      if (order.status === RefillOrderStatus.RECEIVED) {
        return {
          order,
          medicine: order.medicine,
          replayed: true,
          changed: false,
        };
      }
      if (order.status === RefillOrderStatus.CANCELLED) {
        throw new BadRequestException(
          'A cancelled refill order cannot be received.',
        );
      }

      const quantity = dto.quantity ?? order.expectedQuantity;
      if (!quantity || quantity < 1) {
        throw new BadRequestException('Received quantity is required.');
      }

      const quantityBefore = order.medicine.remainingQuantity;
      const quantityAfter = (quantityBefore ?? 0) + quantity;
      const medicine = await tx.medicine.update({
        where: { id: order.medicineId },
        data: {
          remainingQuantity: quantityAfter,
          totalQuantity: (order.medicine.totalQuantity ?? 0) + quantity,
          lastStockAlertLevel: null,
          lastStockAlertAt: null,
        },
      });
      const updatedOrder = await tx.refillOrder.update({
        where: { id: order.id },
        data: {
          status: RefillOrderStatus.RECEIVED,
          receivedQuantity: quantity,
          receivedAt: new Date(),
          notes: dto.notes?.trim() || order.notes,
        },
      });
      await tx.medicineInventoryEvent.create({
        data: {
          userId,
          medicineId: order.medicineId,
          type: InventoryEventType.REFILL_RECEIVED,
          delta: quantity,
          quantityBefore,
          quantityAfter,
          reason: dto.notes?.trim() || 'Refill received',
          sourceReference: order.id,
          idempotencyKey,
        },
      });

      return { order: updatedOrder, medicine, replayed: false, changed: true };
    });

    if (result.changed) {
      await this.auditLogs.log({
        userId,
        action: 'REFILL_LOGGED',
        entityType: 'RefillOrder',
        entityId: result.order.id,
        newValues: {
          medicineId: result.order.medicineId,
          status: result.order.status,
          receivedQuantity: result.order.receivedQuantity,
          stockAfter: result.medicine.remainingQuantity,
        },
      });
    }

    return {
      order: result.order,
      medicine: result.medicine,
      replayed: result.replayed,
    };
  }

  async cancelOrder(userId: string, orderId: string) {
    const result = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`refill-cancel:${orderId}`}))`;
      const order = await tx.refillOrder.findFirst({
        where: { id: orderId, userId },
      });
      if (!order) throw new NotFoundException('Refill order not found');
      if (order.status === RefillOrderStatus.RECEIVED) {
        throw new BadRequestException(
          'A received refill order cannot be cancelled.',
        );
      }
      if (order.status === RefillOrderStatus.CANCELLED) {
        return { order, changed: false };
      }
      const cancelledOrder = await tx.refillOrder.update({
        where: { id: order.id },
        data: { status: RefillOrderStatus.CANCELLED, cancelledAt: new Date() },
      });
      return { order: cancelledOrder, changed: true };
    });

    if (result.changed) {
      await this.auditLogs.log({
        userId,
        action: 'UPDATED',
        entityType: 'RefillOrder',
        entityId: result.order.id,
        newValues: { status: result.order.status },
      });
    }
    return result.order;
  }

  async correctStock(
    userId: string,
    medicineId: string,
    dto: CorrectStockDto,
    idempotencyKey: string,
  ) {
    const result = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`stock-correction:${medicineId}`}))`;

      const replay = await tx.medicineInventoryEvent.findFirst({
        where: { userId, idempotencyKey },
      });
      if (replay) {
        if (replay.medicineId !== medicineId) {
          throw new BadRequestException(
            'This idempotency key was already used for another medicine.',
          );
        }
        return { event: replay, replayed: true, changed: false };
      }

      const medicine = await tx.medicine.findFirst({
        where: { id: medicineId, userId, isActive: true },
      });
      if (!medicine) throw new NotFoundException('Active medicine not found');

      const quantityBefore = medicine.remainingQuantity;
      const quantityAfter = dto.quantity;
      await tx.medicine.update({
        where: { id: medicine.id },
        data: {
          remainingQuantity: quantityAfter,
          totalQuantity: medicine.totalQuantity ?? quantityAfter,
          lastStockAlertLevel: null,
          lastStockAlertAt: null,
        },
      });
      const event = await tx.medicineInventoryEvent.create({
        data: {
          userId,
          medicineId,
          type: InventoryEventType.MANUAL_CORRECTION,
          delta: quantityAfter - (quantityBefore ?? 0),
          quantityBefore,
          quantityAfter,
          reason: dto.reason.trim(),
          idempotencyKey,
        },
      });
      return { event, replayed: false, changed: true };
    });

    if (result.changed) {
      await this.auditLogs.log({
        userId,
        action: 'UPDATED',
        entityType: 'MedicineInventory',
        entityId: result.event.id,
        oldValues: { quantity: result.event.quantityBefore },
        newValues: {
          medicineId,
          quantity: result.event.quantityAfter,
          reason: result.event.reason,
        },
      });
    }
    return { ...result.event, replayed: result.replayed };
  }

  async getMedicineHistory(userId: string, medicineId: string, limit: number) {
    const medicine = await this.prisma.medicine.findFirst({
      where: { id: medicineId, userId },
      select: { id: true, name: true, remainingQuantity: true, unit: true },
    });
    if (!medicine) throw new NotFoundException('Medicine not found');

    const [orders, inventoryEvents] = await Promise.all([
      this.prisma.refillOrder.findMany({
        where: { userId, medicineId },
        orderBy: { createdAt: 'desc' },
        take: limit,
      }),
      this.prisma.medicineInventoryEvent.findMany({
        where: { userId, medicineId },
        orderBy: { createdAt: 'desc' },
        take: limit,
      }),
    ]);

    return { medicine, orders, inventoryEvents };
  }

  private latestDate(left: Date | null, right: Date | null) {
    if (!left && !right) return null;
    const latest = !left ? right : !right ? left : left > right ? left : right;
    return latest?.toISOString().slice(0, 10) ?? null;
  }

  private buildPurchaseOptions(
    medicine: RefillForecastMedicine,
    searchQuery: string,
  ): RefillPurchaseOption[] {
    const selectedPackageId =
      medicine.medicinePackageId ?? medicine.medicinePackage?.id ?? null;
    const exactByProvider = new Map<string, RefillPurchaseOption>();

    for (const link of medicine.medicineMaster?.purchaseLinks ?? []) {
      if (
        !isPharmacyProvider(link.provider) ||
        !isAllowedPharmacyProductUrl(link.provider, link.productUrl)
      ) {
        continue;
      }

      const linkPackageId = link.medicinePackage?.id ?? null;
      if (
        linkPackageId &&
        (!selectedPackageId || linkPackageId !== selectedPackageId)
      ) {
        continue;
      }

      const checkedAt = link.lastCheckedAt ?? link.verifiedAt;
      if (
        !checkedAt ||
        Date.now() - checkedAt.getTime() > VERIFIED_PURCHASE_LINK_MAX_AGE_MS
      ) {
        continue;
      }

      const provider = link.provider;
      const option: RefillPurchaseOption = {
        provider,
        providerLabel: PHARMACY_PROVIDERS[provider].label,
        url: link.productUrl,
        matchType: 'VERIFIED_PRODUCT',
        queryPrefilled: true,
        packSize: link.medicinePackage?.packSize ?? null,
        verifiedAt: checkedAt.toISOString().slice(0, 10),
        matchScope: linkPackageId ? 'PACKAGE' : 'MEDICINE',
      };
      const current = exactByProvider.get(provider);
      if (
        !current ||
        (option.matchScope === 'PACKAGE' && current.matchScope !== 'PACKAGE') ||
        (option.matchScope === current.matchScope &&
          option.verifiedAt! > current.verifiedAt!)
      ) {
        exactByProvider.set(provider, option);
      }
    }

    const exact = Object.keys(PHARMACY_PROVIDERS).flatMap((provider) => {
      const option = exactByProvider.get(provider);
      return option ? [option] : [];
    });

    const providersWithExactLinks = new Set(
      exact.map((option) => option.provider),
    );
    const searches = Object.entries(PHARMACY_PROVIDERS)
      .filter(([provider]) => !providersWithExactLinks.has(provider))
      .map(([provider, config]) => ({
        provider,
        providerLabel: config.label,
        url: config.searchUrl(searchQuery),
        matchType: 'PROVIDER_SEARCH' as const,
        queryPrefilled: config.queryPrefilled,
        packSize: null,
        verifiedAt: null,
        matchScope: null,
      }));

    return [...exact, ...searches];
  }

  private scheduledDailyUsage(
    schedules: RefillForecastSchedule[],
    now: Date,
  ): number | null {
    const active = schedules.filter(
      (schedule) =>
        schedule.frequency !== 'AS_NEEDED' &&
        schedule.startDate.getTime() <= now.getTime() &&
        (!schedule.endDate || schedule.endDate.getTime() >= now.getTime()) &&
        schedule.timesOfDay.length > 0 &&
        schedule.dosesPerIntake > 0,
    );
    if (active.length === 0) return null;

    const perDay = active.reduce((total, schedule) => {
      const daysPerWeek =
        schedule.daysOfWeek.length > 0
          ? new Set(schedule.daysOfWeek.filter((day) => day >= 0 && day <= 6))
              .size
          : 7;
      return (
        total +
        schedule.timesOfDay.length * schedule.dosesPerIntake * (daysPerWeek / 7)
      );
    }, 0);

    return perDay > 0 ? Math.round(perDay * 100) / 100 : null;
  }

  private addUtcDays(date: Date, days: number): Date {
    const result = new Date(date);
    result.setUTCDate(result.getUTCDate() + days);
    return result;
  }

  private getForecastStockStatus(
    remaining: number | null,
    daysRemaining: number | null,
    refillThreshold: number | null,
  ): 'OUT' | 'CRITICAL' | 'LOW' | 'ADEQUATE' | 'GOOD' | 'UNKNOWN' {
    if (remaining === null) return 'UNKNOWN';
    if (remaining <= 0) return 'OUT';
    if (daysRemaining !== null && daysRemaining <= 3) return 'CRITICAL';
    if (
      (refillThreshold !== null && remaining <= refillThreshold) ||
      (daysRemaining !== null && daysRemaining <= 7)
    ) {
      return 'LOW';
    }
    if (daysRemaining !== null && daysRemaining <= 14) return 'ADEQUATE';
    if (daysRemaining === null && refillThreshold === null) return 'UNKNOWN';
    return 'GOOD';
  }

  // ─────────────────────────────────────────────────────────
  // Helpers
  // ─────────────────────────────────────────────────────────
  private enrichRefillLog(log: {
    id: string;
    userId: string;
    medicineId: string;
    totalQuantity: number;
    dailyUsage: number;
    remainingQuantity: number;
    expectedFinishDate: Date;
    refillReminderDate: Date;
    notes: string | null;
    createdAt: Date;
    updatedAt: Date;
    medicine?: {
      id: string;
      name: string;
      form: string;
      strength: string | null;
      remainingQuantity: number | null;
    };
  }) {
    const today = new Date();
    const daysRemaining = Math.ceil(
      (log.expectedFinishDate.getTime() - today.getTime()) /
        (1000 * 60 * 60 * 24),
    );

    return {
      ...log,
      expectedFinishDate: log.expectedFinishDate.toISOString().split('T')[0],
      refillReminderDate: log.refillReminderDate.toISOString().split('T')[0],
      daysUntilExpected: daysRemaining,
      stockStatus: this.getStockStatus(log.remainingQuantity, daysRemaining),
    };
  }

  private getStockStatus(
    remaining: number,
    daysRemaining: number | null,
  ): 'critical' | 'low' | 'adequate' | 'good' {
    if (remaining <= 0) return 'critical';
    if (remaining <= 5 || (daysRemaining !== null && daysRemaining <= 3))
      return 'critical';
    if (remaining <= 10 || (daysRemaining !== null && daysRemaining <= 7))
      return 'low';
    if (daysRemaining !== null && daysRemaining <= 14) return 'adequate';
    return 'good';
  }
}
