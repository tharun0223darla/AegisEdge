import { Module } from '@nestjs/common';
import { RemindersService } from './reminders.service';
import { RemindersController } from './remainder.controller';
import { DoseLogsModule } from '../dose-logs/dose-logs.module';
import { SchedulesModule } from '../schedules/schedules.module';

@Module({
  imports: [DoseLogsModule, SchedulesModule],
  controllers: [RemindersController],
  providers: [RemindersService],
  exports: [RemindersService], // exported so schedulers can use it
})
export class RemindersModule {}
