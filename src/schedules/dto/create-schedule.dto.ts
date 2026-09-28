import {
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  Min,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';

export enum ScheduleFrequency {
  DAILY = 'DAILY',
  TWICE_DAILY = 'TWICE_DAILY',
  THREE_TIMES_DAILY = 'THREE_TIMES_DAILY',
  FOUR_TIMES_DAILY = 'FOUR_TIMES_DAILY',
  WEEKLY = 'WEEKLY',
  AS_NEEDED = 'AS_NEEDED',
  CUSTOM = 'CUSTOM',
}

export class CreateScheduleDto {
  @ApiProperty({ example: 'clxyz123...' })
  @IsString()
  @IsNotEmpty({ message: 'Medicine ID is required' })
  medicineId: string;

  @ApiProperty({
    enum: ScheduleFrequency,
    example: ScheduleFrequency.TWICE_DAILY,
  })
  @IsEnum(ScheduleFrequency)
  frequency: ScheduleFrequency;

  @ApiProperty({
    example: ['08:00', '20:00'],
    description: 'Times of day in HH:mm format (24-hour)',
    isArray: true,
  })
  @IsArray()
  @IsString({ each: true })
  @Matches(/^([01]\d|2[0-3]):([0-5]\d)$/, {
    each: true,
    message: 'Each time must be in HH:mm format (e.g., 08:00, 20:30)',
  })
  timesOfDay: string[];

  @ApiPropertyOptional({
    example: [1, 2, 3, 4, 5],
    description: 'Days of week: 0=Sun, 1=Mon, ..., 6=Sat. Empty = every day',
    isArray: true,
  })
  @IsOptional()
  @IsArray()
  @IsInt({ each: true })
  @Min(0, { each: true })
  @Max(6, { each: true })
  daysOfWeek?: number[];

  @ApiProperty({ example: '2024-01-15', description: 'Schedule start date' })
  @IsDateString({}, { message: 'Start date must be a valid date (YYYY-MM-DD)' })
  startDate: string;

  @ApiPropertyOptional({
    example: '2024-02-15',
    description: 'Schedule end date (optional)',
  })
  @IsOptional()
  @IsDateString({}, { message: 'End date must be a valid date (YYYY-MM-DD)' })
  endDate?: string;

  @ApiPropertyOptional({
    example: 1,
    description: 'Number of doses per intake (can be 0.5 for half tablet)',
    default: 1,
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0.5)
  @Max(10)
  dosesPerIntake?: number;

  @ApiPropertyOptional({ example: 'tablet', default: 'tablet' })
  @IsOptional()
  @IsString()
  unit?: string;

  @ApiPropertyOptional({ example: 'Take with food' })
  @IsOptional()
  @IsString()
  notes?: string;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({
    example: 'Asia/Kolkata',
    description: 'IANA timezone used for the schedule wall-clock times',
  })
  @IsOptional()
  @IsString()
  timezone?: string;
}
