import { Module } from '@nestjs/common';
import { DashboardService } from './dashboard.service';
import { DashboardController } from './dashboard.controller';

@Module({
  // Phase 3: DashboardService now uses PrismaService directly (global)
  // instead of importing DoseLogsModule — removes the circular dep risk
  controllers: [DashboardController],
  providers: [DashboardService],
  exports: [DashboardService], // exported so notification-scheduler can call writeAdherenceSnapshot
})
export class DashboardModule {}