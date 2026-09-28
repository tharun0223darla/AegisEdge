import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator';

export class ReceiveRefillOrderDto {
  @ApiPropertyOptional({
    example: 15,
    description:
      'Actual number of tablets, capsules, or other stock units received.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  quantity?: number;

  @ApiPropertyOptional({
    example: 'Pack and strength checked before adding stock.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}
