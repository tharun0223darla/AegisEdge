import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional } from 'class-validator';

export class UpdateNotificationPreferencesDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  emailEnabled?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  missedDoseEmails?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  refillEmails?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  includeMedicineNames?: boolean;
}
