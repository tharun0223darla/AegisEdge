import { BadRequestException, NotFoundException } from '@nestjs/common';
import { DoseBarrierReason, DoseStatus, Prisma } from '@prisma/client';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { PrismaService } from '../prisma/prisma.service';
import { DoseLogsService } from './dose-logs.service';

describe('DoseLogsService adherence barriers', () => {
  const findUnique = jest.fn();
  const updateMany = jest.fn<
    Promise<{ count: number }>,
    [Prisma.DoseLogUpdateManyArgs]
  >();
  const groupBy = jest.fn();
  const count = jest.fn();
  const auditLog = jest.fn();
  const prisma = {
    doseLog: { findUnique, updateMany, groupBy, count },
  } as unknown as PrismaService;
  const audit = { log: auditLog } as unknown as AuditLogsService;
  const service = new DoseLogsService(prisma, audit);

  beforeEach(() => jest.clearAllMocks());

  it('records a structured reason for an owned missed dose', async () => {
    findUnique
      .mockResolvedValueOnce({
        id: 'dose-1',
        userId: 'patient-1',
        status: DoseStatus.MISSED,
        barrierReason: null,
        barrierRecordedAt: null,
      })
      .mockResolvedValueOnce({
        id: 'dose-1',
        userId: 'patient-1',
        status: DoseStatus.MISSED,
        barrierReason: DoseBarrierReason.FORGOT,
      });
    updateMany.mockResolvedValue({ count: 1 });

    const result = await service.recordBarrierReason(
      'patient-1',
      'dose-1',
      DoseBarrierReason.FORGOT,
    );

    expect(updateMany.mock.calls[0]?.[0]).toMatchObject({
      where: {
        id: 'dose-1',
        userId: 'patient-1',
        status: { in: [DoseStatus.MISSED, DoseStatus.SKIPPED] },
      },
    });
    expect(auditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'patient-1',
        action: 'DOSE_BARRIER_RECORDED',
        entityId: 'dose-1',
      }),
    );
    expect(result).toMatchObject({
      id: 'dose-1',
      barrierReason: DoseBarrierReason.FORGOT,
    });
  });

  it('does not reveal or update another patient dose', async () => {
    findUnique.mockResolvedValue({
      id: 'dose-1',
      userId: 'patient-2',
      status: DoseStatus.MISSED,
      barrierReason: null,
      barrierRecordedAt: null,
    });

    await expect(
      service.recordBarrierReason(
        'patient-1',
        'dose-1',
        DoseBarrierReason.RAN_OUT,
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(updateMany).not.toHaveBeenCalled();
    expect(auditLog).not.toHaveBeenCalled();
  });

  it('rejects reasons on non-final dose states', async () => {
    findUnique.mockResolvedValue({
      id: 'dose-1',
      userId: 'patient-1',
      status: DoseStatus.PENDING,
      barrierReason: null,
      barrierRecordedAt: null,
    });

    await expect(
      service.recordBarrierReason(
        'patient-1',
        'dose-1',
        DoseBarrierReason.FORGOT,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(updateMany).not.toHaveBeenCalled();
  });

  it('returns counted patterns and fail-safe guidance without medicine advice', async () => {
    groupBy.mockResolvedValue([
      {
        barrierReason: DoseBarrierReason.SIDE_EFFECT_CONCERN,
        _count: { id: 2 },
      },
      {
        barrierReason: DoseBarrierReason.FORGOT,
        _count: { id: 1 },
      },
    ]);
    count.mockResolvedValue(4);

    const result = await service.barrierSummary('patient-1', 30);

    expect(result).toMatchObject({
      periodDays: 30,
      finalized: 4,
      recorded: 3,
      unrecorded: 1,
      coveragePercent: 75,
    });
    expect(result.reasons[0]).toMatchObject({
      reason: DoseBarrierReason.SIDE_EFFECT_CONCERN,
      count: 2,
      urgent: true,
    });
    expect(result.reasons[0].guidance).toContain('Do not stop');
    expect(result.disclaimer).toContain('do not diagnose');
  });
});
