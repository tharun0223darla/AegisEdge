import { IsEnum, IsOptional, IsString, MaxLength, ValidateNested } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';

export enum MedicineReviewStatusDto {
  LINKED = 'LINKED',
  VERIFIED = 'VERIFIED',
  REJECTED = 'REJECTED',
}

export class CreateMedicinePackageForReviewDto {
  @ApiPropertyOptional({ example: 'clxmaster123' })
  @IsString()
  medicineMasterId: string;

  @ApiPropertyOptional({ example: '8900000000000' })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  gtin?: string;

  @ApiPropertyOptional({ example: 'EAN13' })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  barcodeType?: string;

  @ApiPropertyOptional({ example: 'Strip of 15 tablets' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  packSize?: string;

  @ApiPropertyOptional({ example: 'https://example.com/strip.jpg' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  stripImageUrl?: string;

  @ApiPropertyOptional({ example: 'https://example.com/pill.jpg' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  pillImageUrl?: string;
}

export class ResolveMedicineReviewDto {
  @ApiPropertyOptional({ enum: MedicineReviewStatusDto })
  @IsOptional()
  @IsEnum(MedicineReviewStatusDto)
  status?: MedicineReviewStatusDto;

  @ApiPropertyOptional({ example: 'clxmaster123' })
  @IsOptional()
  @IsString()
  medicineMasterId?: string;

  @ApiPropertyOptional({ example: 'clxpackage123' })
  @IsOptional()
  @IsString()
  medicinePackageId?: string;

  @ApiPropertyOptional({ type: CreateMedicinePackageForReviewDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => CreateMedicinePackageForReviewDto)
  package?: CreateMedicinePackageForReviewDto;

  @ApiPropertyOptional({ example: 'Linked after checking strip image and brand composition.' })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  adminNotes?: string;
}
