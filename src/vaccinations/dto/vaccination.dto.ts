import {
  IsString,
  IsOptional,
  IsNumber,
  IsBoolean,
  IsArray,
  Min,
  Max,
} from 'class-validator';
import { Type } from 'class-transformer';
import type { CenterType, VaccineCategory, VaccinationStatus } from '../vaccination.types';

export class GetVaccineDirectoryDto {
  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsString()
  category?: VaccineCategory | 'ALL';

  @IsOptional()
  @IsBoolean()
  @Type(() => Boolean)
  isMandatoryOnly?: boolean;

  @IsOptional()
  @IsBoolean()
  @Type(() => Boolean)
  isUipFreeOnly?: boolean;
}

export class GetVaccineScheduleDto {
  @IsOptional()
  @IsString()
  memberId?: string;

  @IsOptional()
  @IsString()
  status?: VaccinationStatus | 'ALL';
}

export class RecordVaccineAdministeredDto {
  @IsString()
  vaccineId: string;

  @IsOptional()
  @IsString()
  memberId?: string;

  @IsOptional()
  @IsString()
  memberName?: string;

  @IsNumber()
  doseNumber: number;

  @IsString()
  administeredDate: string; // YYYY-MM-DD

  @IsOptional()
  @IsString()
  administeredBy?: string;

  @IsOptional()
  @IsString()
  clinicOrCenterName?: string;

  @IsOptional()
  @IsString()
  centerLocation?: string;

  @IsOptional()
  @IsString()
  batchNumber?: string;

  @IsOptional()
  @IsString()
  brandName?: string;

  @IsOptional()
  @IsString()
  adverseReactions?: string;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsString()
  certificateUrl?: string;
}

export class UpdateVaccineRecordDto {
  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @IsString()
  administeredDate?: string;

  @IsOptional()
  @IsString()
  administeredBy?: string;

  @IsOptional()
  @IsString()
  clinicOrCenterName?: string;

  @IsOptional()
  @IsString()
  batchNumber?: string;

  @IsOptional()
  @IsString()
  brandName?: string;

  @IsOptional()
  @IsString()
  adverseReactions?: string;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsBoolean()
  reminderEnabled?: boolean;

  @IsOptional()
  @IsArray()
  reminderDaysBefore?: number[];
}

export class AddCustomVaccineDto {
  @IsOptional()
  @IsString()
  memberId?: string;

  @IsOptional()
  @IsString()
  memberName?: string;

  @IsString()
  vaccineName: string;

  @IsOptional()
  @IsString()
  vaccineCode?: string;

  @IsNumber()
  doseNumber: number;

  @IsNumber()
  totalDoses: number;

  @IsString()
  dueDate: string; // YYYY-MM-DD

  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @IsString()
  administeredDate?: string;

  @IsOptional()
  @IsString()
  administeredBy?: string;

  @IsOptional()
  @IsString()
  clinicOrCenterName?: string;

  @IsOptional()
  @IsString()
  batchNumber?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}

export class FindNearbyCentersDto {
  @IsNumber()
  @Type(() => Number)
  latitude: number;

  @IsNumber()
  @Type(() => Number)
  longitude: number;

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  @Min(1000)
  @Max(100000)
  radius?: number; // In meters (default 25000 = 25km)

  @IsOptional()
  @IsString()
  type?: CenterType | 'ALL';

  @IsOptional()
  @IsBoolean()
  @Type(() => Boolean)
  isGovtFreeOnly?: boolean;

  @IsOptional()
  @IsString()
  vaccineQuery?: string;

  @IsOptional()
  @IsString()
  searchQuery?: string;
}

export class BookVaccineAppointmentDto {
  @IsOptional()
  @IsString()
  memberId?: string;

  @IsString()
  memberName: string;

  @IsString()
  vaccineId: string;

  @IsString()
  vaccineName: string;

  @IsNumber()
  doseNumber: number;

  @IsString()
  centerId: string;

  @IsString()
  appointmentDate: string; // YYYY-MM-DD

  @IsString()
  timeSlot: string;

  @IsOptional()
  @IsString()
  notes?: string;
}

export class TriggerVaccineReminderDto {
  @IsString()
  recordId: string;

  @IsOptional()
  @IsString()
  customMessage?: string;
}
