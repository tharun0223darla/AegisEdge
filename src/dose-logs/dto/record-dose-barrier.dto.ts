import { ApiProperty } from '@nestjs/swagger';
import { DoseBarrierReason } from '@prisma/client';
import { IsEnum } from 'class-validator';

export class RecordDoseBarrierDto {
  @ApiProperty({ enum: DoseBarrierReason })
  @IsEnum(DoseBarrierReason, {
    message: 'Reason must be a supported adherence barrier',
  })
  reason: DoseBarrierReason;
}
