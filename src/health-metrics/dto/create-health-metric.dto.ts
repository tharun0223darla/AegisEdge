import {
  IsEnum,
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
import { MetricType, MetricSource } from '@prisma/client';
import type {
  HealthMetricSource,
  HealthMetricType,
} from '../health-metric.types';

export class CreateHealthMetricDto {
  @ApiProperty({ enum: MetricType, example: 'BLOOD_PRESSURE' })
  @IsEnum(MetricType)
  @IsNotEmpty()
  metricType: HealthMetricType;

  @ApiProperty({
    description:
      'Dynamic JSON payload containing metric details. e.g., { systolic: 120, diastolic: 80 }',
    example: { systolic: 120, diastolic: 80 },
  })
  @IsObject()
  @IsNotEmpty()
  value: Record<string, unknown>;

  @ApiProperty({
    description: 'ISO date string when metrics were captured',
    example: '2026-06-09T21:50:00Z',
  })
  @IsString()
  @IsNotEmpty()
  recordedAt: string;

  @ApiProperty({
    description:
      'Measurement unit. Defaults to the canonical unit for the metric.',
    required: false,
  })
  @IsString()
  @IsOptional()
  unit?: string;

  @ApiProperty({
    description: 'Stable source record ID used to prevent duplicate imports.',
    required: false,
  })
  @IsString()
  @Length(1, 160)
  @IsOptional()
  clientRecordId?: string;

  @ApiProperty({
    description: 'UTC offset at capture time in minutes.',
    required: false,
    example: 330,
  })
  @IsInt()
  @Min(-840)
  @Max(840)
  @IsOptional()
  timezoneOffsetMinutes?: number;

  @ApiProperty({
    enum: MetricSource,
    required: false,
    deprecated: true,
    description:
      'Compatibility field only. The server always records this endpoint as MANUAL.',
  })
  @IsEnum(MetricSource)
  @IsOptional()
  source?: HealthMetricSource;
}
