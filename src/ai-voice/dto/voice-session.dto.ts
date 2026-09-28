import { IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class SpeakToSessionDto {
  @ApiProperty({
    description: 'Transcription text of the user spoken response',
    example: 'I feel fine, just a little tired today.',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  message: string;
}
