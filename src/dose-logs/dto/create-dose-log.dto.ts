import {
  IsDateString,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export enum DoseActionStatus {
  TAKEN = 'TAKEN',
  MISSED = 'MISSED',
  SNOOZED = 'SNOOZED',
  SKIPPED = 'SKIPPED',
}

export enum ClientDoseActionSource {
  APP = 'APP',
  DEVICE_NOTIFICATION = 'DEVICE_NOTIFICATION',
  OFFLINE_SYNC = 'OFFLINE_SYNC',
}

export class CreateDoseLogDto {
  @ApiPropertyOptional({
    example: '0190f6b4-31ca-7e8b-b9c7-3e63a8fd9201',
    description:
      'Stable client-generated identifier. Reusing it safely replays the same action.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  clientActionId?: string;

  @ApiProperty({ example: 'clxyz...' })
  @IsString()
  @IsNotEmpty({ message: 'Schedule ID is required' })
  scheduleId: string;

  @ApiProperty({ example: '2024-01-15T08:00:00.000Z' })
  @IsDateString({}, { message: 'scheduledAt must be a valid ISO date' })
  scheduledAt: string;

  @ApiProperty({ enum: DoseActionStatus })
  @IsEnum(DoseActionStatus, {
    message: 'Status must be TAKEN, MISSED, SNOOZED, or SKIPPED',
  })
  status: DoseActionStatus;

  @ApiPropertyOptional({
    enum: ClientDoseActionSource,
    default: ClientDoseActionSource.APP,
  })
  @IsOptional()
  @IsEnum(ClientDoseActionSource)
  source?: ClientDoseActionSource;

  @ApiPropertyOptional({
    example: '2024-01-15T08:05:00.000Z',
    description: 'If SNOOZED, when to re-remind (ISO date)',
  })
  @IsOptional()
  @IsDateString()
  snoozeUntil?: string;

  @ApiPropertyOptional({ example: 'Took it slightly late, after breakfast' })
  @IsOptional()
  @IsString()
  notes?: string;
}
