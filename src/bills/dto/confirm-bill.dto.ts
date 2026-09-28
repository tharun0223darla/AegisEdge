import { Type } from 'class-transformer';
import {
  IsArray,
  IsDateString,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { MedicineForm } from '@prisma/client';

// ─────────────────────────────────────────────────────────
// Bill confirmation is simpler than prescription confirmation:
// The patient confirms QUANTITY of medicines purchased.
// This feeds into RefillLog for refill prediction.
// No schedule creation — bill confirmation only tracks stock.
// ─────────────────────────────────────────────────────────

export class ConfirmedBillMedicineDto {
  @ApiPropertyOptional({
    description: 'The OCR extracted medicine row being confirmed',
    example: 'clxextracted123...',
  })
  @IsOptional()
  @IsString()
  extractedMedicineId?: string;

  @ApiPropertyOptional({
    description: 'Link to an existing Medicine record in the system',
    example: 'clxyz123...',
  })
  @IsOptional()
  @IsString()
  medicineId?: string;

  @ApiPropertyOptional({
    description: 'Confirmed Medicine Master match selected by the user',
    example: 'clxmaster123...',
  })
  @IsOptional()
  @IsString()
  medicineMasterId?: string;

  @ApiPropertyOptional({
    description: 'Confirmed physical package selected by the user',
    example: 'clxpackage123...',
  })
  @IsOptional()
  @IsString()
  medicinePackageId?: string;

  @ApiProperty({ example: 'Metformin 500mg', description: 'Medicine name as on bill' })
  @IsString()
  @IsNotEmpty()
  medicineName: string;

  @ApiPropertyOptional({ example: 'DOLO 650 TAB 15S 1 30.00' })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  billLine?: string;

  @ApiPropertyOptional({ example: '650mg' })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  strength?: string;

  @ApiPropertyOptional({ enum: MedicineForm, default: MedicineForm.TABLET })
  @IsOptional()
  @IsEnum(MedicineForm)
  form?: MedicineForm;

  @ApiPropertyOptional({ example: 'tablets' })
  @IsOptional()
  @IsString()
  @MaxLength(30)
  unit?: string;

  @ApiProperty({ example: 60, description: 'Quantity purchased (number of tablets/units)' })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  quantityPurchased: number;

  @ApiPropertyOptional({
    example: 2,
    description:
      'How many units consumed per day (used to calculate expected finish date). ' +
      'Leave empty to skip refill prediction for this medicine.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0.5)
  dailyUsage?: number;

  @ApiPropertyOptional({ example: '15.5', description: 'Price per unit on this bill' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  pricePerUnit?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(300)
  notes?: string;
}

export class ConfirmBillDto {
  @ApiProperty({ type: [ConfirmedBillMedicineDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ConfirmedBillMedicineDto)
  medicines: ConfirmedBillMedicineDto[];

  @ApiPropertyOptional({ example: 'Apollo Pharmacy' })
  @IsOptional()
  @IsString()
  pharmacyName?: string;

  @ApiPropertyOptional({ example: '2024-01-15' })
  @IsOptional()
  @IsDateString()
  purchaseDate?: string;

  @ApiPropertyOptional({ example: 850.5 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  totalAmount?: number;
}
