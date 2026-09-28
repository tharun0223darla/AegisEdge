import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

// ─────────────────────────────────────────────────────────
// SAFETY RULE:
// This DTO represents data the PATIENT has reviewed and
// explicitly confirmed. Only confirmed data creates
// Medicine and Schedule records.
// OCR output is NEVER used directly without this step.
// ─────────────────────────────────────────────────────────

export enum ConfirmFrequency {
  DAILY = 'DAILY',
  TWICE_DAILY = 'TWICE_DAILY',
  THREE_TIMES_DAILY = 'THREE_TIMES_DAILY',
  FOUR_TIMES_DAILY = 'FOUR_TIMES_DAILY',
  WEEKLY = 'WEEKLY',
  AS_NEEDED = 'AS_NEEDED',
  CUSTOM = 'CUSTOM',
}

export class ConfirmedMedicineItemDto {
  @ApiPropertyOptional({
    description:
      'ID of the ExtractedMedicine record to link (if confirming an OCR extraction). ' +
      'Omit to add a medicine directly.',
  })
  @IsOptional()
  @IsString()
  extractedMedicineId?: string;

  @ApiProperty({ example: 'Metformin' })
  @IsString()
  @IsNotEmpty({ message: 'Medicine name is required' })
  medicineName: string;

  @ApiPropertyOptional({ example: '500mg' })
  @IsOptional()
  @IsString()
  dosage?: string;

  @ApiPropertyOptional({ example: 'Glycomet' })
  @IsOptional()
  @IsString()
  brandName?: string;

  @ApiPropertyOptional({ example: 'Metformin Hydrochloride' })
  @IsOptional()
  @IsString()
  genericName?: string;

  @ApiProperty({ enum: ConfirmFrequency, example: ConfirmFrequency.TWICE_DAILY })
  @IsEnum(ConfirmFrequency)
  frequency: ConfirmFrequency;

  @ApiProperty({
    example: ['08:00', '20:00'],
    description: 'Times of day in HH:mm 24-hour format',
    isArray: true,
  })
  @IsArray()
  @IsString({ each: true })
  @Matches(/^([01]\d|2[0-3]):([0-5]\d)$/, {
    each: true,
    message: 'Each time must be HH:mm format e.g. 08:00',
  })
  timesOfDay: string[];

  @ApiPropertyOptional({ example: 30, description: 'Duration in days' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(3650)
  durationDays?: number;

  @ApiPropertyOptional({ example: 60, description: 'Total quantity/pills' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  totalQuantity?: number;

  @ApiPropertyOptional({ example: 'Take after meals' })
  @IsOptional()
  @IsString()
  instructions?: string;

  @ApiPropertyOptional({
    example: true,
    description:
      'Set to true to also create an active medicine schedule. ' +
      'If false, only the Medicine record is created.',
    default: true,
  })
  @IsOptional()
  @IsBoolean()
  createSchedule?: boolean;
}

export class ConfirmPrescriptionDto {
  @ApiProperty({
    type: [ConfirmedMedicineItemDto],
    description:
      'List of medicines the patient has reviewed and confirmed. ' +
      'Each item will create a Medicine + optional Schedule record.',
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ConfirmedMedicineItemDto)
  medicines: ConfirmedMedicineItemDto[];

  @ApiPropertyOptional({ example: 'Dr. Priya Sharma' })
  @IsOptional()
  @IsString()
  doctorName?: string;

  @ApiPropertyOptional({ example: '2024-01-15' })
  @IsOptional()
  @IsDateString()
  prescribedAt?: string;
}