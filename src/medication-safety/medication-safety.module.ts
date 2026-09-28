import { Module } from '@nestjs/common';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { MedicationSafetyController } from './medication-safety.controller';
import { MedicationSafetyService } from './medication-safety.service';

@Module({
  imports: [AuditLogsModule],
  controllers: [MedicationSafetyController],
  providers: [MedicationSafetyService],
  exports: [MedicationSafetyService],
})
export class MedicationSafetyModule {}
