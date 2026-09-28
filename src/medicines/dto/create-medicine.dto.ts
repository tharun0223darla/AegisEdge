import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';

export enum MedicineForm {
  TABLET = 'TABLET',
  CAPSULE = 'CAPSULE',
  SYRUP = 'SYRUP',
  INJECTION = 'INJECTION',
  DROPS = 'DROPS',
  INHALER = 'INHALER',
  PATCH = 'PATCH',
  CREAM = 'CREAM',
  OINTMENT = 'OINTMENT',
  POWDER = 'POWDER',
  OTHER = 'OTHER',
}

export enum MedSource {
  MANUAL = 'MANUAL',
  BILL = 'BILL',
  BARCODE = 'BARCODE',
  PRESCRIPTION = 'PRESCRIPTION',
  PACKAGE_IMAGE = 'PACKAGE_IMAGE',
  IMPORT = 'IMPORT',
}

export class CreateMedicineDto {
  @ApiPropertyOptional({ example: 'clxmedicineid123' })
  @IsOptional()
  @IsString()
  medicineMasterId?: string;

  @ApiPropertyOptional({ example: 'clxpackageid123' })
  @IsOptional()
  @IsString()
  medicinePackageId?: string;

  @ApiProperty({ example: 'Metformin' })
  @IsString()
  @IsNotEmpty({ message: 'Medicine name is required' })
  name: string;

  @ApiPropertyOptional({ example: 'Metformin Hydrochloride' })
  @IsOptional()
  @IsString()
  genericName?: string;

  @ApiPropertyOptional({ example: 'Glycomet' })
  @IsOptional()
  @IsString()
  brandName?: string;

  @ApiPropertyOptional({ enum: MedicineForm, default: MedicineForm.TABLET })
  @IsOptional()
  @IsEnum(MedicineForm)
  form?: MedicineForm;

  @ApiPropertyOptional({ example: '500mg' })
  @IsOptional()
  @IsString()
  strength?: string;

  @ApiPropertyOptional({ example: 'White' })
  @IsOptional()
  @IsString()
  color?: string;

  @ApiPropertyOptional({ example: 'Round' })
  @IsOptional()
  @IsString()
  shape?: string;

  @ApiPropertyOptional({ example: 'Take with food after meals' })
  @IsOptional()
  @IsString()
  instructions?: string;

  @ApiPropertyOptional({
    example: 'May cause nausea initially',
    description: 'Patient-facing note only — not clinical advice',
  })
  @IsOptional()
  @IsString()
  sideEffects?: string;

  @ApiPropertyOptional({
    example: 60,
    description: 'Total quantity in strip/bottle',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  totalQuantity?: number;

  @ApiPropertyOptional({
    example: 60,
    description: 'Current remaining quantity',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  remainingQuantity?: number;

  @ApiPropertyOptional({ example: 30 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  stockQuantity?: number;

  @ApiPropertyOptional({ example: 'tablets' })
  @IsOptional()
  @IsString()
  unit?: string;

  @ApiPropertyOptional({ example: 5 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  refillThreshold?: number;

  @ApiPropertyOptional({ example: 'Prescribed by Dr. Sharma on 2024-01-15' })
  @IsOptional()
  @IsString()
  notes?: string;

  @ApiPropertyOptional({ enum: MedSource, default: MedSource.MANUAL })
  @IsOptional()
  @IsEnum(MedSource)
  source?: MedSource;

  @ApiPropertyOptional({ example: '/uploads/user-strips/strip.jpg' })
  @IsOptional()
  @IsString()
  userStripImageUrl?: string;

  @ApiPropertyOptional({
    description: 'Private OCR reference captured from the patient strip',
  })
  @IsOptional()
  @IsString()
  @MaxLength(30_000)
  userStripOcrText?: string;

  @ApiPropertyOptional({ example: 'mlkit-android-latin-v2' })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  userStripOcrEngine?: string;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  visualConfirmed?: boolean;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
