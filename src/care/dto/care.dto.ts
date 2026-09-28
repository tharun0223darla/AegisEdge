import { Transform, type TransformFnParams } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  Equals,
  IsArray,
  IsEmail,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Max,
  Min,
} from 'class-validator';
import { CarePermission } from '@prisma/client';

export class CreateCareInvitationDto {
  @Transform(({ value }: TransformFnParams): unknown =>
    typeof value === 'string' ? value.trim().toLowerCase() : (value as unknown),
  )
  @IsEmail()
  email!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(4)
  @ArrayUnique()
  @IsEnum(CarePermission, { each: true })
  permissions!: CarePermission[];

  @Equals(true, {
    message: 'You must confirm that you are sharing your own adult account.',
  })
  confirmAdult!: true;

  @Equals(true, {
    message: 'Explicit consent is required before caregiver access is shared.',
  })
  consentAcknowledged!: true;

  @IsOptional()
  @IsInt()
  @Min(30)
  @Max(365)
  accessDurationDays?: number;
}

export class CareInvitationTokenDto {
  @IsString()
  @Length(32, 256)
  token!: string;
}

export class AcceptCareInvitationDto extends CareInvitationTokenDto {
  @Equals(true, {
    message: 'You must acknowledge the caregiver privacy responsibilities.',
  })
  caregiverAcknowledged!: true;
}

export class UpdateCarePermissionsDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(4)
  @ArrayUnique()
  @IsEnum(CarePermission, { each: true })
  permissions!: CarePermission[];
}
