import { Module } from '@nestjs/common';
import { SchedulesService } from './schedules.service';
import { SchedulesController } from './schedules.controller';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { MedicinesModule } from '../medicines/medicines.module';
import { MedicationSafetyModule } from '../medication-safety/medication-safety.module';

@Module({
  imports: [AuditLogsModule, MedicinesModule, MedicationSafetyModule],
  controllers: [SchedulesController],
  providers: [SchedulesService],
  exports: [SchedulesService],
})
export class SchedulesModule {}
