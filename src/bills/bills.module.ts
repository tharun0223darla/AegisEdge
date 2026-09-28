import { Module } from '@nestjs/common';
import { BillsService } from './bills.service';
import { BillsController } from './bills.controller';
import { BillCaptureService } from './bill-capture.service';
import { OcrModule } from '../ocr/ocr.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { MedicinesModule } from '../medicines/medicines.module';

@Module({
  imports: [
    OcrModule,
    AuditLogsModule,
    MedicinesModule,
  ],
  controllers: [BillsController],
  providers: [BillsService, BillCaptureService],
  exports: [BillsService],
})
export class BillsModule {}
