import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsDateString, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

// Maximum times a single dose log can be snoozed to prevent infinite loops
export const MAX_SNOOZE_COUNT = 3;

// Minimum snooze: 5 minutes | Maximum snooze: 4 hours
export const MIN_SNOOZE_MINUTES = 5;
export const MAX_SNOOZE_MINUTES = 240;

export class SnoozeReminderDto {
  @ApiProperty({
    example: 15,
    description:
      `Minutes to snooze (${MIN_SNOOZE_MINUTES}–${MAX_SNOOZE_MINUTES}). ` +
      'Provide either snoozeMinutes OR snoozeUntil, not both.',
    minimum: MIN_SNOOZE_MINUTES,
    maximum: MAX_SNOOZE_MINUTES,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(MIN_SNOOZE_MINUTES)
  @Max(MAX_SNOOZE_MINUTES)
  snoozeMinutes?: number;

  @ApiPropertyOptional({
    example: '2024-01-15T09:30:00.000Z',
    description: 'Explicit future datetime to snooze until. Alternative to snoozeMinutes.',
  })
  @IsOptional()
  @IsDateString({}, { message: 'snoozeUntil must be a valid ISO datetime' })
  snoozeUntil?: string;

  @ApiPropertyOptional({
    example: 'Taking a short nap first',
    description: 'Optional patient note for the snooze',
  })
  @IsOptional()
  @IsString()
  notes?: string;
}