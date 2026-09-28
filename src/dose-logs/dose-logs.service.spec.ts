import { BadRequestException } from '@nestjs/common';
import { DoseActionSource, DoseStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { DoseLogsService } from './dose-logs.service';
import { DoseActionStatus } from './dto/create-dose-log.dto';

describe('DoseLogsService inventory idempotency', () => {
  const schedule = {
    id: 'schedule-1',
    userId: 'user-1',
    medicineId: 'medicine-1',
    medicine: { id: 'medicine-1', name: 'Dolo 650' },
  };
  const resolvedDose = {
    id: 'dose-1',
    userId: 'user-1',
    medicineId: 'medicine-1',
    scheduleId: 'schedule-1',
    scheduledAt: new Date('2026-07-24T08:00:00.000Z'),
    status: DoseStatus.TAKEN,
    medicine: { id: 'medicine-1', name: 'Dolo 650', form: 'TABLET' },
    schedule: { id: 'schedule-1', dosesPerIntake: 1, unit: 'tablet' },
  };
  const executeRaw = jest.fn<Promise<number>, unknown[]>();
  const findUnique = jest.fn<
    Promise<Record<string, unknown> | null>,
    [unknown]
  >();
  const findUniqueOrThrow = jest.fn<Promise<typeof resolvedDose>, [unknown]>();
  const update = jest.fn<Promise<typeof resolvedDose>, [unknown]>();
  const findActionEvent = jest.fn<
    Promise<Record<string, unknown> | null>,
    [unknown]
  >();
  const createActionEvent = jest.fn<
    Promise<Record<string, unknown>>,
    [unknown]
  >();
  const tx = {
    $executeRaw: executeRaw,
    doseLog: { findUnique, findUniqueOrThrow, update },
    doseActionEvent: {
      findUnique: findActionEvent,
      create: createActionEvent,
    },
  };
  const transaction = jest.fn(
    async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx),
  );
  const prisma = {
    medicineSchedule: { findUnique: jest.fn() },
    $transaction: transaction,
  } as unknown as PrismaService;
  const auditLog = jest.fn();
  const audit = { log: auditLog } as unknown as AuditLogsService;

  const dto = {
    scheduleId: 'schedule-1',
    scheduledAt: '2026-07-24T08:00:00.000Z',
    status: DoseActionStatus.TAKEN,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    (
      prisma.medicineSchedule.findUnique as jest.MockedFunction<
        typeof prisma.medicineSchedule.findUnique
      >
    ).mockResolvedValue(schedule as never);
    executeRaw.mockResolvedValue(1);
    update.mockResolvedValue(resolvedDose);
    findUniqueOrThrow.mockResolvedValue(resolvedDose);
    findActionEvent.mockResolvedValue(null);
    createActionEvent.mockResolvedValue({ id: 'event-1' });
  });

  it('decrements inventory once when a dose first becomes taken', async () => {
    findUnique.mockResolvedValue({
      id: 'dose-1',
      userId: 'user-1',
      status: DoseStatus.PENDING,
      snoozeCount: 0,
    });

    await new DoseLogsService(prisma, audit).recordAction('user-1', dto);

    expect(update).toHaveBeenCalledTimes(1);
    expect(createActionEvent).toHaveBeenCalledTimes(1);
    expect(executeRaw).toHaveBeenCalledTimes(2);
    expect(auditLog).toHaveBeenCalledTimes(1);
  });

  it('treats a repeated taken action as an idempotent replay', async () => {
    findActionEvent.mockResolvedValue({
      id: 'event-1',
      doseLogId: 'dose-1',
      status: DoseStatus.TAKEN,
      source: DoseActionSource.APP,
    });

    const result = await new DoseLogsService(prisma, audit).recordAction(
      'user-1',
      dto,
    );

    expect(result).toEqual(resolvedDose);
    expect(executeRaw).toHaveBeenCalledTimes(1);
    expect(update).not.toHaveBeenCalled();
    expect(createActionEvent).not.toHaveBeenCalled();
    expect(auditLog).not.toHaveBeenCalled();
  });

  it('does not allow a taken dose to be rewritten as missed', async () => {
    findUnique.mockResolvedValue({
      id: 'dose-1',
      userId: 'user-1',
      status: DoseStatus.TAKEN,
      snoozeCount: 0,
    });

    await expect(
      new DoseLogsService(prisma, audit).recordAction('user-1', {
        ...dto,
        status: DoseActionStatus.MISSED,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(executeRaw).toHaveBeenCalledTimes(1);
    expect(auditLog).not.toHaveBeenCalled();
  });
});
