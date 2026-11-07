import { Module } from '@nestjs/common';
import { AiModule } from '../ai/ai.module';
import { CardsModule } from '../cards/cards.module';
import { ScraperModule } from '../scraper/scraper.module';
import { ChangeDetectionService } from './change-detection.service';
import { MonitoringController } from './monitoring.controller';
import { MonitoringService } from './monitoring.service';
import { VerificationService } from './verification.service';

@Module({
  imports: [AiModule, CardsModule, ScraperModule],
  controllers: [MonitoringController],
  providers: [MonitoringService, VerificationService, ChangeDetectionService],
  exports: [MonitoringService],
})
export class MonitoringModule {}
