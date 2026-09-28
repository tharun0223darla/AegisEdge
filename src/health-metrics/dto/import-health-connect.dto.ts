import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsIn,
  IsInt,
  IsISO8601,
  IsObject,
  IsOptional,
  IsString,
  Length,
  Matches,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import type { HealthMetricType } from '../health-metric.types';

export const HEALTH_CONNECT_METRIC_TYPES = [
  'BLOOD_PRESSURE',
  'BLOOD_GLUCOSE',
  'HEART_RATE',
  'OXYGEN_SATURATION',
] as const satisfies readonly HealthMetricType[];

export type HealthConnectMetricType =
  (typeof HEALTH_CONNECT_METRIC_TYPES)[number];

export class HealthConnectMetricDto {
  @ApiProperty({ enum: HEALTH_CONNECT_METRIC_TYPES })
  @IsIn(HEALTH_CONNECT_METRIC_TYPES)
  metricType: HealthConnectMetricType;

  @ApiProperty({ example: { heartRate: 72 } })
  @IsObject()
  value: Record<string, unknown>;

  @ApiProperty({ example: '2026-07-14T10:00:00Z' })
  @IsISO8601({ strict: true })
  recordedAt: string;

  @ApiProperty({ example: 'bpm' })
  @IsString()
  @Length(1, 32)
  unit: string;

  @ApiProperty({ description: 'Stable Health Connect record identifier.' })
  @IsString()
  @Length(4, 200)
  @Matches(/^hc:\S+$/, {
    message: 'clientRecordId must be a non-empty Health Connect record ID.',
  })
  clientRecordId: string;

  @ApiProperty({ example: 'com.google.android.apps.fitness' })
  @IsString()
  @Length(3, 255)
  @Matches(/^[A-Za-z0-9_]+(?:\.[A-Za-z0-9_]+)+$/, {
    message: 'originPackage must be an Android package name.',
  })
  originPackage: string;

  @ApiProperty({ example: 330, required: false })
  @IsOptional()
  @IsInt()
  @Min(-840)
  @Max(840)
  timezoneOffsetMinutes?: number;
}

export class ImportHealthConnectBatchDto {
  @ApiProperty({ type: [HealthConnectMetricDto], maxItems: 200 })
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => HealthConnectMetricDto)
  records: HealthConnectMetricDto[];
}
