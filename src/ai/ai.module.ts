import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { CoreAIService } from './core-ai.service';

@Global()
@Module({
  imports: [ConfigModule],
  providers: [CoreAIService],
  exports: [CoreAIService],
})
export class AiModule {}
