import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsNotEmpty, IsNumber, IsOptional, IsString } from 'class-validator';

export const TEST_ALARM_SCENARIOS = [
  'SPO2_CRASH',
  'HYPERTENSION',
  'TACHYCARDIA',
  'GLUCOSE_CRASH',
  'FALL_IMPACT',
  'NEWS2_CRITICAL',
] as const;

export type TestAlarmScenario = (typeof TEST_ALARM_SCENARIOS)[number];

export class TestAlarmDto {
  @ApiProperty({
    enum: TEST_ALARM_SCENARIOS,
    description: 'The anomaly or alarm scenario to test/simulate',
    example: 'SPO2_CRASH',
  })
  @IsEnum(TEST_ALARM_SCENARIOS)
  @IsNotEmpty()
  scenario!: TestAlarmScenario;

  @ApiPropertyOptional({
    description: 'Simulated parameter value (e.g., 76 for SpO2, 165 for HR)',
    example: 76,
  })
  @IsNumber()
  @IsOptional()
  value?: number;

  @ApiPropertyOptional({
    description: 'Optional clinical context or source device',
    example: 'boAt Wave Watch / Google Health Connect integration test',
  })
  @IsString()
  @IsOptional()
  notes?: string;
}

export class DismissAlarmDto {
  @ApiProperty({
    description: 'The scenario identifier that was dismissed',
    example: 'SPO2_CRASH',
  })
  @IsString()
  @IsNotEmpty()
  scenario!: string;

  @ApiPropertyOptional({
    description: 'Resolution or reason for dismissal',
    example: 'Patient confirmed conscious and safe (False alarm resolved)',
  })
  @IsString()
  @IsOptional()
  reason?: string;
}
