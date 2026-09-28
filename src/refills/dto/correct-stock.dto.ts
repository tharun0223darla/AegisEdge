import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsString, MaxLength, Min, MinLength } from 'class-validator';

export class CorrectStockDto {
  @ApiProperty({
    example: 18,
    description: 'The physically counted stock on hand.',
  })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  quantity!: number;

  @ApiProperty({ example: 'Counted the tablets in the opened strip.' })
  @IsString()
  @MinLength(5)
  @MaxLength(300)
  reason!: string;
}
