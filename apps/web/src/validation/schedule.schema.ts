import { z } from 'zod';

const timeRegex = /^([01]\d|2[0-3]):[0-5]\d$/;

export const scheduleSchema = z
  .object({
    medicineId: z.string().min(1, 'Select a medicine'),
    dosesPerIntake: z.coerce.number().min(0.5, 'Minimum dose is 0.5').max(10, 'Maximum dose is 10'),
    unit: z.string().trim().min(1, 'Unit is required').max(40),
    frequency: z.enum([
      'DAILY',
      'TWICE_DAILY',
      'THREE_TIMES_DAILY',
      'FOUR_TIMES_DAILY',
      'WEEKLY',
      'CUSTOM',
      'AS_NEEDED',
    ]),
    timesOfDay: z.array(z.string().regex(timeRegex, 'Use HH:mm format')),
    daysOfWeek: z.array(z.number().int().min(0).max(6)).optional(),
    startDate: z.string().min(1, 'Start date is required'),
    endDate: z.string().optional().or(z.literal('')),
    notes: z.string().trim().max(500).optional().or(z.literal('')),
  })
  .superRefine((data, context) => {
    if (data.frequency !== 'AS_NEEDED' && data.timesOfDay.length === 0) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['timesOfDay'],
        message: 'Add at least one time',
      });
    }
    if (data.frequency === 'WEEKLY' && (!data.daysOfWeek || data.daysOfWeek.length === 0)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['daysOfWeek'],
        message: 'Pick at least one day of the week',
      });
    }
    if (data.endDate && data.startDate && data.endDate <= data.startDate) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['endDate'],
        message: 'End date must be after start date',
      });
    }
  });

export type ScheduleFormValues = z.infer<typeof scheduleSchema>;
