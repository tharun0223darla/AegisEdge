import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { ExtractionService } from './extraction.service';
import { DrugNormalizer } from './drug-normalizer';

@Module({
  imports: [HttpModule.register({ timeout: 120000, maxRedirects: 0 })],
  providers: [ExtractionService, DrugNormalizer],
  exports: [ExtractionService],
})
export class ExtractionModule {}
