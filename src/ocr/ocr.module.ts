import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { OcrService } from './ocr.service';

@Module({
  imports: [
    // Used to call the optional Python preprocessing + PaddleOCR sidecar.
    // Generous timeout: PaddleOCR cold start can be slow on first request.
    HttpModule.register({ timeout: 30000, maxRedirects: 0 }),
  ],
  providers: [OcrService],
  exports: [OcrService], // exported so Prescriptions and Bills modules can use it
})
export class OcrModule {}