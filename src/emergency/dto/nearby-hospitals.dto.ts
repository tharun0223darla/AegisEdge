import { IsNumber, IsOptional, Max, Min, IsString } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class NearbyHospitalsDto {
  @ApiPropertyOptional({ description: 'Latitude of user location', example: 17.385044 })
  @IsNumber()
  @Min(-90)
  @Max(90)
  @Type(() => Number)
  latitude: number;

  @ApiPropertyOptional({ description: 'Longitude of user location', example: 78.486671 })
  @IsNumber()
  @Min(-180)
  @Max(180)
  @Type(() => Number)
  longitude: number;

  @ApiPropertyOptional({ description: 'Search radius in meters (default 15000)', default: 15000 })
  @IsOptional()
  @IsNumber()
  @Min(500)
  @Max(100000)
  @Type(() => Number)
  radius?: number;

  @ApiPropertyOptional({ description: 'Facility filter category', enum: ['all', 'emergency', 'hospital', 'clinic', 'pharmacy'] })
  @IsOptional()
  @IsString()
  category?: 'all' | 'emergency' | 'hospital' | 'clinic' | 'pharmacy';
}
