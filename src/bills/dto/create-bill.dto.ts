import {
  IsDateString,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';

export class CreateBillDto {
  @ApiPropertyOptional({
    example: 'Apollo Pharmacy',
    description: 'Name of the pharmacy',
  })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  pharmacyName?: string;

  @ApiPropertyOptional({
    example: '2024-01-15',
    description: 'Date of purchase printed on the bill (YYYY-MM-DD)',
  })
  @IsOptional()
  @IsDateString(
    {},
    { message: 'purchaseDate must be a valid date (YYYY-MM-DD)' },
  )
  purchaseDate?: string;

  @ApiPropertyOptional({
    example: 850.5,
    description: 'Total bill amount in local currency',
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  totalAmount?: number;

  @ApiPropertyOptional({
    example: 'January refill batch',
    description: 'Patient-added note about this bill',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;

  @ApiPropertyOptional({ description: 'Bounded on-device ML Kit OCR text' })
  @IsOptional()
  @IsString()
  @MaxLength(30_000)
  nativeOcrText?: string;

  @ApiPropertyOptional({ description: 'JSON encoded on-device OCR lines' })
  @IsOptional()
  @IsString()
  @MaxLength(100_000)
  nativeOcrLines?: string;

  @ApiPropertyOptional({ example: 0.88 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  nativeOcrConfidence?: number;

  @ApiPropertyOptional({ example: 'mlkit-android-latin-v2' })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  nativeOcrEngine?: string;

  @ApiPropertyOptional({ example: 'ML_KIT' })
  @IsOptional()
  @IsString()
  @IsIn(['ML_KIT', 'NO_RESULT'])
  nativeOcrSource?: string;

  @ApiPropertyOptional({ example: 'true' })
  @IsOptional()
  @IsString()
  @IsIn(['true', 'false'])
  nativeOcrSuccess?: string;

  @ApiPropertyOptional({ example: 'NOT_NATIVE_PLATFORM' })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  nativeOcrFallbackReason?: string;

  @ApiPropertyOptional({ example: 420 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  nativeOcrProcessingMs?: number;

  @ApiPropertyOptional({ example: 3 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  nativeOcrBlockCount?: number;

  @ApiPropertyOptional({ example: 8 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  nativeOcrLineCount?: number;

  @ApiPropertyOptional({ example: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  nativeOcrElementCount?: number;

  @ApiPropertyOptional({ example: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  nativeOcrRotationDegrees?: number;
}
