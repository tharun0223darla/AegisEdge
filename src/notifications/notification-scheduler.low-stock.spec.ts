import { StockAlertLevel } from '@prisma/client/index';
import { DashboardService } from '../dashboard/dashboard.service';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationSchedulerService } from './notification-scheduler.service';
import { NotificationsService } from './notifications.service';
import { SchedulesService } from '../schedules/schedules.service';

describe('NotificationSchedulerService low-stock deduplication', () => {
  const findMany = jest.fn();
  const updateMany = jest.fn();
  const sendLowStockAlert = jest.fn();
  const prisma = {
    medicine: { findMany, updateMany },
  } as unknown as PrismaService;
  const notifications = {
    sendLowStockAlert,
  } as unknown as NotificationsService;
  const dashboard = {} as DashboardService;
  const schedules = {} as SchedulesService;
  const scheduler = new NotificationSchedulerService(
    prisma,
    notifications,
    dashboard,
    schedules,
  );

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('uses a database claim so concurrent runs send one alert', async () => {
    findMany.mockResolvedValue([
      {
        id: 'medicine-1',
        userId: 'user-1',
        name: 'Dolo 650',
        remainingQuantity: 2,
        refillThreshold: 5,
        lastStockAlertLevel: null,
        user: { isActive: true },
      },
    ]);
    updateMany
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 });
    sendLowStockAlert.mockResolvedValue(undefined);

    await scheduler.checkLowStock();
    await scheduler.checkLowStock();

    expect(sendLowStockAlert).toHaveBeenCalledTimes(1);
    expect(sendLowStockAlert).toHaveBeenCalledWith(
      expect.objectContaining({
        medicineId: 'medicine-1',
        alertLevel: StockAlertLevel.CRITICAL,
      }),
    );
  });

  it('does not repeat an alert at the same severity', async () => {
    findMany.mockResolvedValue([
      {
        id: 'medicine-1',
        userId: 'user-1',
        name: 'Dolo 650',
        remainingQuantity: 4,
        refillThreshold: 5,
        lastStockAlertLevel: StockAlertLevel.LOW,
        user: { isActive: true },
      },
    ]);

    await scheduler.checkLowStock();

    expect(updateMany).not.toHaveBeenCalled();
    expect(sendLowStockAlert).not.toHaveBeenCalled();
  });

  it('clears the alert state after stock recovers', async () => {
    findMany.mockResolvedValue([
      {
        id: 'medicine-1',
        userId: 'user-1',
        name: 'Dolo 650',
        remainingQuantity: 12,
        refillThreshold: 5,
        lastStockAlertLevel: StockAlertLevel.CRITICAL,
        user: { isActive: true },
      },
    ]);
    updateMany.mockResolvedValue({ count: 1 });

    await scheduler.checkLowStock();

    expect(updateMany).toHaveBeenCalledWith({
      where: {
        id: 'medicine-1',
        lastStockAlertLevel: StockAlertLevel.CRITICAL,
      },
      data: { lastStockAlertLevel: null, lastStockAlertAt: null },
    });
    expect(sendLowStockAlert).not.toHaveBeenCalled();
  });
});
