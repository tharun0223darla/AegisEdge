import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AiVoiceController } from './ai-voice.controller';
import { AiVoiceService } from './ai-voice.service';
import { PatientCompanionSafetyService } from './patient-companion-safety.service';

@Module({
  imports: [PrismaModule],
  controllers: [AiVoiceController],
  providers: [AiVoiceService, PatientCompanionSafetyService],
  exports: [AiVoiceService],
})
export class AiVoiceModule {}
