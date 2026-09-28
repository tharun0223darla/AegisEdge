import { z } from 'zod';

// Mirror of the Prisma ScheduleFrequency enum. Kept as a const tuple so the
// Zod schema can constrain the LLM output to exactly these values.
export const SCHEDULE_FREQUENCIES = [
  'DAILY',
  'TWICE_DAILY',
  'THREE_TIMES_DAILY',
  'FOUR_TIMES_DAILY',
  'WEEKLY',
  'AS_NEEDED',
  'CUSTOM',
] as const;

export const ALLOWED_DOSAGE_UNITS = [
  'mg',
  'ml',
  'mcg',
  'g',
  'iu',
  'unit',
  'units',
] as const;

const nullableString = z.string().trim().min(1).nullable().catch(null);

export const StrengthSchema = z
  .object({
    value: z.union([z.number(), z.string()]).nullable().catch(null),
    unit: z.string().nullable().catch(null),
  })
  .nullable()
  .catch(null);

export const LlmMedicineSchema = z.object({
  name: nullableString,
  brandName: nullableString,
  strength: StrengthSchema,
  // Coerce unknown frequencies to null rather than rejecting the whole row.
  frequency: z
    .enum(SCHEDULE_FREQUENCIES)
    .nullable()
    .catch(null),
  durationDays: z.number().int().positive().nullable().catch(null),
  quantity: z.number().int().positive().nullable().catch(null),
  instructions: nullableString,
  confidence: z.number().min(0).max(1).catch(0.5),
  sourceText: z.string().nullable().catch(null),
});

export const LlmExtractionSchema = z.object({
  medicines: z.array(LlmMedicineSchema).catch([]),
});

export type LlmMedicine = z.infer<typeof LlmMedicineSchema>;
export type LlmExtraction = z.infer<typeof LlmExtractionSchema>;
