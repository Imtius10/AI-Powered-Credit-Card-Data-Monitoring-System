import { Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { MonitoringService } from './monitoring.service';
import type { JobSummary } from '../cards/card.types';

@Controller(['monitoring', 'monitor'])
export class MonitoringController {
  constructor(private readonly monitoringService: MonitoringService) {}

  @Post('run')
  @HttpCode(HttpStatus.OK)
  async runDailyJob(): Promise<{ data: JobSummary }> {
    const summary = await this.monitoringService.runDailyJob();
    return { data: summary };
  }
}
