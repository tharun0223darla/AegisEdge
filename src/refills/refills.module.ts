import { Module } from '@nestjs/common';
import { RefillsService } from './refills.service';
import { RefillsController } from './refills.controller';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';

@Module({
  imports: [AuditLogsModule],
  controllers: [RefillsController],
  providers: [RefillsService],
  exports: [RefillsService],
})
export class RefillsModule {}
