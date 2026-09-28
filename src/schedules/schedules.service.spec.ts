import { SchedulesService } from './schedules.service';

describe('SchedulesService mobile reminder plan', () => {
  const prisma = {
    medicineSchedule: {
      create: jest.fn(),
      findMany: jest.fn(),
    },
    doseLog: {
      createMany: jest.fn(),
      findMany: jest.fn(),
    },
  };
  const auditLogs = { log: jest.fn() };
  const medicinesService = { findOne: jest.fn() };

  const service = new SchedulesService(
    prisma as any,
    auditLogs as any,
    medicinesService as any,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.doseLog.createMany.mockResolvedValue({ count: 2 });
  });

  it('builds deterministic upcoming local notification reminders from active schedules', async () => {
    prisma.medicineSchedule.findMany.mockResolvedValue([
      {
        id: 'schedule-1',
        userId: 'user-1',
        medicineId: 'medicine-1',
        frequency: 'DAILY',
        timesOfDay: ['08:00', '20:00'],
        daysOfWeek: [],
        startDate: new Date(2026, 6, 1),
        endDate: null,
        timezone: 'Asia/Kolkata',
        dosesPerIntake: 1,
        unit: 'tablet',
        isActive: true,
        createdAt: new Date(2026, 6, 1),
        updatedAt: new Date(2026, 6, 1),
        medicine: {
          id: 'medicine-1',
          name: 'Dolo 650',
          strength: '650mg',
          form: 'TABLET',
        },
      },
    ]);
    prisma.doseLog.findMany.mockResolvedValue([
      {
        id: 'dose-1',
        medicineId: 'medicine-1',
        scheduleId: 'schedule-1',
        scheduledAt: new Date(2026, 6, 9, 8, 0),
        medicine: {
          id: 'medicine-1',
          name: 'Dolo 650',
          strength: '650mg',
          form: 'TABLET',
        },
        schedule: {
          id: 'schedule-1',
          dosesPerIntake: 1,
          unit: 'tablet',
        },
      },
      {
        id: 'dose-2',
        medicineId: 'medicine-1',
        scheduleId: 'schedule-1',
        scheduledAt: new Date(2026, 6, 9, 20, 0),
        medicine: {
          id: 'medicine-1',
          name: 'Dolo 650',
          strength: '650mg',
          form: 'TABLET',
        },
        schedule: {
          id: 'schedule-1',
          dosesPerIntake: 1,
          unit: 'tablet',
        },
      },
    ]);

    const plan = await service.getMobileReminderPlan(
      'user-1',
      1,
      new Date(2026, 6, 9, 6, 30),
    );

    expect(prisma.medicineSchedule.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          userId: 'user-1',
          isActive: true,
          frequency: { not: 'AS_NEEDED' },
        },
      }),
    );
    expect(plan.horizonDays).toBe(1);
    expect(plan.reminders).toHaveLength(4);
    expect(plan.reminders[0]).toMatchObject({
      scheduleId: 'schedule-1',
      doseLogId: 'dose-1',
      medicineId: 'medicine-1',
      medicineName: 'Dolo 650 650mg',
      dosage: '1 tablet',
      title: 'Medicine reminder',
    });
    expect(new Date(plan.reminders[0].scheduledAt).getHours()).toBe(8);
    expect(plan.reminders[0].kind).toBe('PRIMARY');
    expect(plan.reminders[1].kind).toBe('FOLLOW_UP');
    expect(
      new Date(plan.reminders[1].scheduledAt).getTime() -
        new Date(plan.reminders[0].scheduledAt).getTime(),
    ).toBe(15 * 60_000);
    expect(new Date(plan.reminders[2].scheduledAt).getHours()).toBe(20);
    expect(plan.reminders[0].id).not.toBe(plan.reminders[1].id);
  });

  it('skips past times and caps the mobile planning horizon to 30 days', async () => {
    prisma.medicineSchedule.findMany.mockResolvedValue([
      {
        id: 'schedule-2',
        userId: 'user-1',
        medicineId: 'medicine-2',
        frequency: 'DAILY',
        timesOfDay: ['08:00', '21:00'],
        daysOfWeek: [],
        startDate: new Date(2026, 6, 1),
        endDate: new Date(2026, 6, 9),
        timezone: 'Asia/Kolkata',
        dosesPerIntake: 0.5,
        unit: 'tablet',
        isActive: true,
        createdAt: new Date(2026, 6, 1),
        updatedAt: new Date(2026, 6, 1),
        medicine: {
          id: 'medicine-2',
          name: 'Half Tab',
          strength: null,
          form: 'TABLET',
        },
      },
    ]);
    prisma.doseLog.createMany.mockResolvedValue({ count: 1 });
    prisma.doseLog.findMany.mockResolvedValue([
      {
        id: 'dose-3',
        medicineId: 'medicine-2',
        scheduleId: 'schedule-2',
        scheduledAt: new Date(2026, 6, 9, 21, 0),
        medicine: {
          id: 'medicine-2',
          name: 'Half Tab',
          strength: null,
          form: 'TABLET',
        },
        schedule: {
          id: 'schedule-2',
          dosesPerIntake: 0.5,
          unit: 'tablet',
        },
      },
    ]);

    const plan = await service.getMobileReminderPlan(
      'user-1',
      500,
      new Date(2026, 6, 9, 12, 0),
    );

    expect(plan.horizonDays).toBe(30);
    expect(plan.reminders).toHaveLength(2);
    expect(plan.reminders[0].dosage).toBe('0.5 tablet');
    expect(new Date(plan.reminders[0].scheduledAt).getHours()).toBe(21);
  });

  it('returns a fresh reminder plan with the created schedule', async () => {
    const schedule = {
      id: 'schedule-new',
      userId: 'user-1',
      medicineId: 'medicine-1',
      frequency: 'DAILY',
      timesOfDay: ['23:25'],
      daysOfWeek: [],
      startDate: new Date(2026, 6, 10),
      endDate: null,
      dosesPerIntake: 1,
      unit: 'tablet',
      isActive: true,
      notes: null,
      createdAt: new Date(2026, 6, 10),
      updatedAt: new Date(2026, 6, 10),
      medicine: { name: 'A Xanthin 100mg' },
    };
    const reminderPlan = {
      generatedAt: new Date(2026, 6, 10, 23, 22).toISOString(),
      horizonDays: 14,
      reminders: [
        {
          id: 123,
          doseLogId: 'dose-1',
          scheduleId: schedule.id,
          medicineId: schedule.medicineId,
          medicineName: 'A Xanthin 100mg',
          dosage: '1 tablet',
          scheduledAt: new Date(2026, 6, 10, 23, 25).toISOString(),
          doseScheduledAt: new Date(2026, 6, 10, 23, 25).toISOString(),
          kind: 'PRIMARY' as const,
          title: 'Medicine reminder',
          body: 'Time to take 1 tablet of A Xanthin 100mg.',
          actionUrl: '/dose-logs',
        },
      ],
    };

    medicinesService.findOne.mockResolvedValue({ id: schedule.medicineId });
    prisma.medicineSchedule.create.mockResolvedValue(schedule);
    jest.spyOn(service, 'generateDoseLogs').mockResolvedValue(0);
    jest
      .spyOn(service, 'getMobileReminderPlan')
      .mockResolvedValue(reminderPlan);

    const result = await service.create('user-1', {
      medicineId: schedule.medicineId,
      frequency: 'DAILY',
      timesOfDay: ['23:25'],
      startDate: '2026-07-10',
    } as any);

    expect(service.getMobileReminderPlan).toHaveBeenCalledWith('user-1', 14);
    expect(result).toEqual({ ...schedule, reminderPlan });
  });
});
