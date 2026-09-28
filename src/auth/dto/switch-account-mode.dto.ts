import { IsIn } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { UserRole } from '../../common/enums/userrole.enum';

export class SwitchAccountModeDto {
  @ApiProperty({
    enum: [UserRole.PATIENT, UserRole.CAREGIVER],
    example: UserRole.PATIENT,
  })
  @IsIn([UserRole.PATIENT, UserRole.CAREGIVER], {
    message: 'Mode must be PATIENT or CAREGIVER',
  })
  role!: UserRole.PATIENT | UserRole.CAREGIVER;
}
