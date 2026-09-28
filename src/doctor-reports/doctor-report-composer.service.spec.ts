import { BadRequestException } from '@nestjs/common';
import { DoctorReportSection, DoseStatus } from '@prisma/client';
import { DoctorReportComposerService } from './doctor-report-composer.service';

describe('DoctorReportComposerService', () => {
  const prisma = {
    user: { findFirst: jest.fn() },
    medicine: { findMany: jest.fn() },
    doseLog: { findMany: jest.fn() },
    allergyIntolerance: { findMany: jest.fn() },
    medicationSafetyFinding: { findMany: jest.fn() },
    healthMetric: { findMany: jest.fn() },
  };

  beforeEach(() => {
    jest.resetAllMocks();
    prisma.user.findFirst.mockResolvedValue({
      patientProfile: {
        firstName: 'Asha',
        lastName: 'Rao',
        dateOfBirth: new Date('1990-01-02T00:00:00.000Z'),
        bloodGroup: 'O+',
        conditions: ['Hypertension'],
      },
    });
  });

  it('scopes dose records to the patient and uses completed outcomes for adherence', async () => {
    prisma.doseLog.findMany.mockResolvedValue([
      {
        status: DoseStatus.TAKEN,
        updatedAt: new Date('2026-08-01T08:01:00.000Z'),
        medicine: { name: 'Medicine A' },
      },
      {
        status: DoseStatus.MISSED,
        updatedAt: new Date('2026-08-02T08:01:00.000Z'),
        medicine: { name: 'Medicine A' },
      },
      {
        status: DoseStatus.SNOOZED,
        updatedAt: new Date('2026-08-03T08:01:00.000Z'),
        medicine: { name: 'Medicine A' },
      },
    ]);
    const service = new DoctorReportComposerService(prisma as never);

    const result = await service.compose('patient-1', {
      startDate: '2026-08-01',
      endDate: '2026-08-10',
      sections: [DoctorReportSection.ADHERENCE],
    });

    expect(prisma.user.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'patient-1', isActive: true } }),
    );
    const doseLogCall = prisma.doseLog.findMany.mock.calls.at(0) as unknown as [
      { where: { userId: string } },
    ];
    expect(doseLogCall[0].where.userId).toBe('patient-1');
    expect(result.snapshot.adherence).toMatchObject({
      totalScheduled: 3,
      taken: 1,
      missed: 1,
      snoozed: 1,
      recordedDoses: 2,
      adherencePercent: 50,
    });
    expect(result.snapshot.medications).toBeUndefined();
  });

  it('rejects reversed and unbounded date ranges before loading report data', async () => {
    const service = new DoctorReportComposerService(prisma as never);

    await expect(
      service.compose('patient-1', {
        startDate: '2026-08-10',
        endDate: '2026-08-01',
        sections: [DoctorReportSection.MEDICATIONS],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    await expect(
      service.compose('patient-1', {
        startDate: '2020-01-01',
        endDate: '2026-08-01',
        sections: [DoctorReportSection.MEDICATIONS],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.user.findFirst).not.toHaveBeenCalled();
  });
});
