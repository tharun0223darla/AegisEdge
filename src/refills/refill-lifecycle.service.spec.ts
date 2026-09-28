import { BadRequestException } from '@nestjs/common';
import { InventoryEventType, RefillOrderStatus } from '@prisma/client/index';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { PrismaService } from '../prisma/prisma.service';
import { RefillsService } from './refills.service';

describe('RefillsService closed-loop inventory lifecycle', () => {
  const tx = {
    $executeRaw: jest.fn(),
    medicine: {
      findFirst: jest.fn(),
      update: jest.fn(),
    },
    refillOrder: {
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    medicineInventoryEvent: {
      findFirst: jest.fn(),
      create: jest.fn(),
    },
  };
  const prisma = {
    $transaction: jest.fn(
      async (operation: (client: typeof tx) => Promise<unknown>) =>
        operation(tx),
    ),
  } as unknown as PrismaService;
  const auditLog = jest.fn().mockResolvedValue(undefined);
  const auditLogs = {
    log: auditLog,
  } as unknown as AuditLogsService;
  const service = new RefillsService(prisma, auditLogs);

  beforeEach(() => {
    jest.clearAllMocks();
    tx.$executeRaw.mockResolvedValue(1);
  });

  it('records an order without changing medicine stock', async () => {
    tx.refillOrder.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null);
    tx.medicine.findFirst.mockResolvedValue({
      id: 'medicine-1',
      name: 'Dolo 650',
    });
    tx.refillOrder.create.mockResolvedValue({
      id: 'order-1',
      userId: 'user-1',
      medicineId: 'medicine-1',
      provider: 'Local pharmacy',
      expectedQuantity: 15,
      status: RefillOrderStatus.ORDERED,
    });

    const result = await service.createOrder(
      'user-1',
      'medicine-1',
      { provider: 'Local pharmacy', expectedQuantity: 15 },
      'order-request-1',
    );

    expect(result).toMatchObject({ id: 'order-1', replayed: false });
    expect(tx.medicine.update).not.toHaveBeenCalled();
    expect(auditLog).toHaveBeenCalledTimes(1);
  });

  it('adds received stock exactly once when a request is replayed', async () => {
    const pendingOrder = {
      id: 'order-1',
      userId: 'user-1',
      medicineId: 'medicine-1',
      status: RefillOrderStatus.ORDERED,
      expectedQuantity: 10,
      notes: null,
      medicine: {
        id: 'medicine-1',
        remainingQuantity: 5,
        totalQuantity: 10,
      },
    };
    const receivedOrder = {
      ...pendingOrder,
      status: RefillOrderStatus.RECEIVED,
      receivedQuantity: 10,
    };
    const receiptEvent = {
      id: 'event-1',
      userId: 'user-1',
      medicineId: 'medicine-1',
      sourceReference: 'order-1',
    };
    tx.refillOrder.findFirst
      .mockResolvedValueOnce(pendingOrder)
      .mockResolvedValueOnce(receivedOrder);
    tx.medicineInventoryEvent.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(receiptEvent);
    tx.medicine.update.mockResolvedValue({
      id: 'medicine-1',
      remainingQuantity: 15,
      totalQuantity: 20,
    });
    tx.refillOrder.update.mockResolvedValue(receivedOrder);
    tx.medicineInventoryEvent.create.mockResolvedValue({
      ...receiptEvent,
      type: InventoryEventType.REFILL_RECEIVED,
      delta: 10,
      quantityBefore: 5,
      quantityAfter: 15,
    });

    const first = await service.receiveOrder(
      'user-1',
      'order-1',
      { quantity: 10 },
      'receive-request-1',
    );
    const replay = await service.receiveOrder(
      'user-1',
      'order-1',
      { quantity: 10 },
      'receive-request-1',
    );

    expect(first.replayed).toBe(false);
    expect(replay.replayed).toBe(true);
    expect(tx.medicine.update).toHaveBeenCalledTimes(1);
    expect(tx.medicineInventoryEvent.create).toHaveBeenCalledTimes(1);
    expect(auditLog).toHaveBeenCalledTimes(1);
  });

  it('replays a stock correction without applying it twice', async () => {
    const event = {
      id: 'event-2',
      userId: 'user-1',
      medicineId: 'medicine-1',
      type: InventoryEventType.MANUAL_CORRECTION,
      delta: -3,
      quantityBefore: 8,
      quantityAfter: 5,
      reason: 'Physical count',
    };
    tx.medicineInventoryEvent.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(event);
    tx.medicine.findFirst.mockResolvedValue({
      id: 'medicine-1',
      remainingQuantity: 8,
      totalQuantity: 10,
    });
    tx.medicine.update.mockResolvedValue({
      id: 'medicine-1',
      remainingQuantity: 5,
    });
    tx.medicineInventoryEvent.create.mockResolvedValue(event);

    await service.correctStock(
      'user-1',
      'medicine-1',
      { quantity: 5, reason: 'Physical count' },
      'correction-request-1',
    );
    const replay = await service.correctStock(
      'user-1',
      'medicine-1',
      { quantity: 5, reason: 'Physical count' },
      'correction-request-1',
    );

    expect(replay.replayed).toBe(true);
    expect(tx.medicine.update).toHaveBeenCalledTimes(1);
    expect(tx.medicineInventoryEvent.create).toHaveBeenCalledTimes(1);
  });

  it('rejects an idempotency key previously used for another medicine', async () => {
    tx.refillOrder.findFirst.mockResolvedValue({
      id: 'order-other',
      userId: 'user-1',
      medicineId: 'medicine-other',
    });

    await expect(
      service.createOrder('user-1', 'medicine-1', {}, 'reused-request-key'),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(tx.refillOrder.create).not.toHaveBeenCalled();
  });
});
