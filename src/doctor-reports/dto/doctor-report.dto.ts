import { DoctorReportSection } from '@prisma/client';
import {
  ArrayMaxSize,
  ArrayMinSize,
  Equals,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class ComposeDoctorReportDto {
  @IsDateString({ strict: true })
  startDate!: string;

  @IsDateString({ strict: true })
  endDate!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(6)
  @IsEnum(DoctorReportSection, { each: true })
  sections!: DoctorReportSection[];

  @IsOptional()
  @IsString()
  @MaxLength(80)
  title?: string;
}

export class CreateDoctorReportShareDto {
  @IsInt()
  @Min(1)
  @Max(30)
  expiresInDays!: number;

  @IsBoolean()
  @Equals(true, {
    message: 'You must confirm consent before creating a report link.',
  })
  consentAcknowledged!: boolean;
}

export class SharedDoctorReportTokenDto {
  @IsString()
  @Matches(/^[A-Za-z0-9_-]{43}$/, {
    message: 'Invalid report link token.',
  })
  token!: string;
}
