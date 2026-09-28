import {
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
  IsIn,
  Length,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { UserRole } from '../../common/enums/userrole.enum';

export class RegisterDto {
  @ApiProperty({ example: 'patient@example.com' })
  @IsEmail({}, { message: 'Please provide a valid email address' })
  @IsNotEmpty()
  email: string;

  @ApiPropertyOptional({ example: '+919876543210' })
  @IsOptional()
  @IsString()
  @Matches(/^\+?[1-9]\d{7,14}$/, {
    message: 'Please provide a valid phone number',
  })
  phone?: string;

  @ApiProperty({ example: 'SecurePass@123', minLength: 8 })
  @IsString()
  @MinLength(8, { message: 'Password must be at least 8 characters' })
  @MaxLength(64, { message: 'Password must be at most 64 characters' })
  @Matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]/, {
    message:
      'Password must contain uppercase, lowercase, number, and special character',
  })
  password: string;

  @ApiPropertyOptional({
    enum: [UserRole.PATIENT, UserRole.CAREGIVER],
    example: UserRole.PATIENT,
  })
  @IsOptional()
  @IsIn([UserRole.PATIENT, UserRole.CAREGIVER], {
    message: 'Role must be PATIENT or CAREGIVER',
  })
  role?: UserRole;

  @ApiPropertyOptional({
    description:
      'Private Care Circle invitation token, when registration began from an invitation',
  })
  @IsOptional()
  @IsString()
  @Length(32, 256)
  careInvitationToken?: string;
}
