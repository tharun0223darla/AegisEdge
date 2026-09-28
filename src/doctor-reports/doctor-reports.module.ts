import { Module } from '@nestjs/common';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { DoctorReportComposerService } from './doctor-report-composer.service';
import { DoctorReportPdfService } from './doctor-report-pdf.service';
import {
  DoctorReportsController,
  SharedDoctorReportsController,
} from './doctor-reports.controller';
import { DoctorReportsService } from './doctor-reports.service';

@Module({
  imports: [AuditLogsModule],
  controllers: [DoctorReportsController, SharedDoctorReportsController],
  providers: [
    DoctorReportsService,
    DoctorReportComposerService,
    DoctorReportPdfService,
  ],
})
export class DoctorReportsModule {}
