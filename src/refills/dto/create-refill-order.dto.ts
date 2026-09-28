import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsDateString,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';

export class CreateRefillOrderDto {
  @ApiPropertyOptional({ example: 'Tata 1mg' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  provider?: string;

  @ApiPropertyOptional({ example: 15 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  expectedQuantity?: number;

  @ApiPropertyOptional({ example: 'ORDER-1234' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  externalReference?: string;

  @ApiPropertyOptional({ example: '2026-08-01' })
  @IsOptional()
  @IsDateString()
  expectedAt?: string;

  @ApiPropertyOptional({ example: 'Ordered after confirming the exact pack.' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}
