import { IsNotEmpty, IsNumber, IsOptional, IsString, Max, Min } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class RequestAmbulanceDto {
  @ApiProperty({ description: 'Patient latitude', example: 17.385044 })
  @IsNumber()
  @Min(-90)
  @Max(90)
  latitude: number;

  @ApiProperty({ description: 'Patient longitude', example: 78.486671 })
  @IsNumber()
  @Min(-180)
  @Max(180)
  longitude: number;

  @ApiPropertyOptional({ description: 'Patient textual address or landmark', example: 'Beside Apollo Pharmacy, Main Road' })
  @IsOptional()
  @IsString()
  address?: string;

  @ApiPropertyOptional({ description: 'Type of emergency', example: 'cardiac' })
  @IsOptional()
  @IsString()
  emergencyType?: string;

  @ApiPropertyOptional({ description: 'Emergency notes / symptoms', example: 'Patient experiencing severe chest tightness' })
  @IsOptional()
  @IsString()
  notes?: string;

  @ApiPropertyOptional({ description: 'Hospital ID or name preference', example: 'Apollo Emergency Center' })
  @IsOptional()
  @IsString()
  destinationHospital?: string;

  @ApiPropertyOptional({ description: 'Contact phone number' })
  @IsOptional()
  @IsString()
  contactPhone?: string;
}

export class UpdateAmbulanceLocationDto {
  @ApiProperty({ description: 'Ambulance current latitude' })
  @IsNumber()
  @Min(-90)
  @Max(90)
  latitude: number;

  @ApiProperty({ description: 'Ambulance current longitude' })
  @IsNumber()
  @Min(-180)
  @Max(180)
  longitude: number;

  @ApiPropertyOptional({ description: 'Current speed in km/h', example: 48 })
  @IsOptional()
  @IsNumber()
  speed?: number;

  @ApiPropertyOptional({
    description: 'Dispatch status',
    enum: ['REQUESTED', 'DISPATCHED', 'ON_THE_WAY', 'ARRIVED', 'TRANSPORTING', 'COMPLETED', 'CANCELLED'],
  })
  @IsOptional()
  @IsString()
  status?: 'REQUESTED' | 'DISPATCHED' | 'ON_THE_WAY' | 'ARRIVED' | 'TRANSPORTING' | 'COMPLETED' | 'CANCELLED';
}

export class EmergencySosDto {
  @ApiProperty({ description: 'Latitude' })
  @IsNumber()
  latitude: number;

  @ApiProperty({ description: 'Longitude' })
  @IsNumber()
  longitude: number;

  @ApiPropertyOptional({ description: 'Emergency type' })
  @IsOptional()
  @IsString()
  emergencyType?: string;

  @ApiPropertyOptional({ description: 'Symptoms list', isArray: true, type: String })
  @IsOptional()
  symptoms?: string[];

  @ApiPropertyOptional({ description: 'Severity score or rating' })
  @IsOptional()
  @IsString()
  severity?: 'critical' | 'urgent' | 'standard';
}
