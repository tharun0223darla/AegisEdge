import {
  IsInt,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  Length,
  Max,
  Min,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class SyncReadingDto {
  @ApiProperty({
    description:
      'Vital readings dynamic object e.g., { systolic: 120, diastolic: 80 }',
    example: { systolic: 118, diastolic: 76 },
  })
  @IsObject()
  @IsNotEmpty()
  value: Record<string, unknown>;

  @ApiProperty({
    description: 'ISO timestamp reported by the device.',
    required: false,
  })
  @IsString()
  @IsOptional()
  recordedAt?: string;

  @ApiProperty({
    description: 'Stable record ID from the device or platform.',
    required: false,
  })
  @IsString()
  @Length(1, 160)
  @IsOptional()
  clientRecordId?: string;

  @ApiProperty({
    description:
      'Measurement unit, when the device is not using the canonical unit.',
    required: false,
  })
  @IsString()
  @IsOptional()
  unit?: string;

  @ApiProperty({
    description: 'UTC offset at capture time in minutes.',
    required: false,
  })
  @IsInt()
  @Min(-840)
  @Max(840)
  @IsOptional()
  timezoneOffsetMinutes?: number;
}
