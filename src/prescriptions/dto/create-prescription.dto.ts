import { IsDateString, IsOptional, IsString, MaxLength } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class CreatePrescriptionDto {
  @ApiPropertyOptional({
    example: 'Dr. Priya Sharma',
    description: 'Name of the prescribing doctor (optional)',
  })
  @IsOptional()
  @IsString()
  @MaxLength(150)
  doctorName?: string;

  @ApiPropertyOptional({
    example: '2024-01-15',
    description: 'Date printed on the prescription (YYYY-MM-DD)',
  })
  @IsOptional()
  @IsDateString({}, { message: 'prescribedAt must be a valid date (YYYY-MM-DD)' })
  prescribedAt?: string;

  @ApiPropertyOptional({
    example: 'Prescription from Apollo Hospital visit',
    description: 'Patient-added note about this prescription',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}