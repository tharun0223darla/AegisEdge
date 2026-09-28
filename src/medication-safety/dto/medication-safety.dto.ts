import { PartialType } from '@nestjs/swagger';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  AllergyCategory,
  AllergyClinicalStatus,
  AllergyCriticality,
  SafetyConditionStatus,
} from '@prisma/client';
import {
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

export class UpdateSafetyProfileDto {
  @ApiProperty({ enum: SafetyConditionStatus })
  @IsEnum(SafetyConditionStatus)
  pregnancyStatus!: SafetyConditionStatus;

  @ApiProperty({ enum: SafetyConditionStatus })
  @IsEnum(SafetyConditionStatus)
  kidneyCondition!: SafetyConditionStatus;

  @ApiProperty({ enum: SafetyConditionStatus })
  @IsEnum(SafetyConditionStatus)
  liverCondition!: SafetyConditionStatus;
}

export class CreateAllergyDto {
  @ApiProperty({ example: 'Amoxicillin' })
  @IsString()
  @MinLength(2)
  @MaxLength(160)
  substance!: string;

  @ApiPropertyOptional({ description: 'Optional exact SaltProfile identity' })
  @IsOptional()
  @IsString()
  saltProfileId?: string;

  @ApiPropertyOptional({ enum: AllergyCategory })
  @IsOptional()
  @IsEnum(AllergyCategory)
  category?: AllergyCategory;

  @ApiPropertyOptional({ enum: AllergyCriticality })
  @IsOptional()
  @IsEnum(AllergyCriticality)
  criticality?: AllergyCriticality;

  @ApiPropertyOptional({ example: 'Rash' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reaction?: string;
}

export class UpdateAllergyDto extends PartialType(CreateAllergyDto) {
  @ApiPropertyOptional({ enum: AllergyClinicalStatus })
  @IsOptional()
  @IsEnum(AllergyClinicalStatus)
  clinicalStatus?: AllergyClinicalStatus;
}

export class AcknowledgeSafetyFindingDto {
  @ApiPropertyOptional({ example: 'I will review this with my clinician.' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}
