import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class VerifyMedicineStripDto {
  @ApiProperty({
    description: 'Printed text extracted from the current strip image',
  })
  @IsString()
  @MaxLength(30_000)
  ocrText!: string;

  @ApiPropertyOptional({ example: 0.86 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(100)
  ocrConfidence?: number;

  @ApiPropertyOptional({ example: 'mlkit-android-latin-v2' })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  engine?: string;
}
