import { Transform, type TransformFnParams } from 'class-transformer';
import { IsEmail, IsOptional, IsString, Length } from 'class-validator';

export class VerifyEmailDto {
  @IsString()
  @Length(32, 256)
  token!: string;
}

export class ResendEmailVerificationDto {
  @Transform(({ value }: TransformFnParams): unknown =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @IsEmail()
  email!: string;

  @IsOptional()
  @IsString()
  @Length(32, 256)
  careInvitationToken?: string;
}
