import { z } from 'zod';

export const medicineFormEnum = z.enum([
  'TABLET',
  'CAPSULE',
  'SYRUP',
  'INJECTION',
  'DROPS',
  'INHALER',
  'PATCH',
  'CREAM',
  'OINTMENT',
  'POWDER',
  'OTHER',
]);

export const medicineSchema = z.object({
  medicineMasterId: z.string().trim().optional().or(z.literal('')),
  medicinePackageId: z.string().trim().optional().or(z.literal('')),
  name: z.string().trim().min(1, 'Medicine name is required').max(120),
  genericName: z.string().trim().max(160).optional().or(z.literal('')),
  brandName: z.string().trim().max(120).optional().or(z.literal('')),
  form: medicineFormEnum,
  strength: z.string().trim().max(40).optional().or(z.literal('')),
  unit: z.string().trim().max(20).optional().or(z.literal('')),
  stockQuantity: z.coerce.number().int().min(0, 'Stock cannot be negative').default(0),
  refillThreshold: z.coerce.number().int().min(0).optional(),
  source: z
    .enum(['MANUAL', 'BILL', 'BARCODE', 'PRESCRIPTION', 'PACKAGE_IMAGE', 'IMPORT'])
    .default('MANUAL'),
  userStripImageUrl: z.string().trim().max(500).optional().or(z.literal('')),
  userStripOcrText: z.string().trim().max(30_000).optional().or(z.literal('')),
  userStripOcrEngine: z.string().trim().max(80).optional().or(z.literal('')),
  visualConfirmed: z.boolean().default(false),
  notes: z.string().trim().max(500).optional().or(z.literal('')),
});
export type MedicineFormValues = z.infer<typeof medicineSchema>;
