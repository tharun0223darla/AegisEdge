import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { HealthMetricsController } from './health-metrics.controller';
import { HealthMetricsService } from './health-metrics.service';
import { HealthObservationValidatorService } from './health-observation-validator.service';
import { HealthSafetyRulesService } from './health-safety-rules.service';
import { News2ScorerService } from './news2-scorer.service';

@Module({
  imports: [PrismaModule, NotificationsModule],
  controllers: [HealthMetricsController],
  providers: [
    HealthMetricsService,
    HealthObservationValidatorService,
    HealthSafetyRulesService,
    News2ScorerService,
  ],
  exports: [HealthMetricsService, News2ScorerService],
})
export class HealthMetricsModule {}
