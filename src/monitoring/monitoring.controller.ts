import { Controller, Get, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { MonitoringService } from './monitoring.service';
import type { JobSummary } from '../cards/card.types';

@Controller(['monitoring', 'monitor'])
export class MonitoringController {
  constructor(private readonly monitoringService: MonitoringService) {}

  @Get('status')
  async getStatus(): Promise<{ success: boolean; data: unknown }> {
    const latest = await this.monitoringService.getLatestJobRun();
    return {
      success: true,
      data: latest,
    };
  }

  @Get('latest')
  async getLatest(): Promise<{ success: boolean; data: unknown }> {
    const latest = await this.monitoringService.getLatestJobRun();
    return {
      success: true,
      data: latest,
    };
  }

  @Post('run')
  @HttpCode(HttpStatus.OK)
  async runDailyJob(): Promise<{ data: JobSummary }> {
    const summary = await this.monitoringService.runDailyJob();
    return { data: summary };
  }
}
