import { ArrayMaxSize, IsArray, IsIn, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export const ADMIN_CLINICAL_SOURCE_TYPES = ['ADMIN', 'WEB_ASSISTED', 'NFI_IPC', 'CDSCO', 'DailyMed', 'openFDA', 'MedlinePlus'] as const;
export type AdminClinicalSourceType = (typeof ADMIN_CLINICAL_SOURCE_TYPES)[number];

export class AdminClinicalDetailsDto {
  @ApiPropertyOptional({ example: 'Used to treat active rheumatoid arthritis or prevent transplant rejection.' })
  @IsOptional()
  @IsString()
  @MaxLength(12000)
  uses?: string;

  @ApiPropertyOptional({ example: 'Take exactly as prescribed. Dose depends on condition and blood tests.' })
  @IsOptional()
  @IsString()
  @MaxLength(12000)
  howToTake?: string;

  @ApiPropertyOptional({ example: ['Nausea', 'Vomiting', 'Low blood cell counts'] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(30)
  @IsString({ each: true })
  @MaxLength(220, { each: true })
  sideEffects?: string[];

  @ApiPropertyOptional({ example: 'May increase infection risk. Monitoring may be required.' })
  @IsOptional()
  @IsString()
  @MaxLength(12000)
  warnings?: string;

  @ApiPropertyOptional({ example: 'Store at room temperature away from moisture and heat.' })
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  storage?: string;

  @ApiPropertyOptional({ enum: ADMIN_CLINICAL_SOURCE_TYPES, example: 'NFI_IPC' })
  @IsOptional()
  @IsString()
  @IsIn(ADMIN_CLINICAL_SOURCE_TYPES)
  sourceType?: AdminClinicalSourceType;

  @ApiProperty({ example: 'National Formulary of India 2021 - Azathioprine monograph' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(220)
  sourceTitle: string;

  @ApiPropertyOptional({ example: 'https://dailymed.nlm.nih.gov/dailymed/drugInfo.cfm?setid=...' })
  @IsOptional()
  @IsString()
  @MaxLength(800)
  sourceUrl?: string;

  @ApiPropertyOptional({ example: 'Admin copied and summarized the referenced label sections.' })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  sourceNote?: string;

  @ApiPropertyOptional({ example: 'Updated missing patient guidance fields from DailyMed.' })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  adminNotes?: string;
}