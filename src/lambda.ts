import type { Handler } from 'aws-lambda';
import { NestFactory } from '@nestjs/core';
import type { INestApplicationContext } from '@nestjs/common';
import { AppModule } from './app.module';
import { MonitoringService } from './monitoring/monitoring.service';
import type { JobSummary } from './cards/card.types';

let cachedApp: INestApplicationContext | null = null;

async function getApplication(): Promise<INestApplicationContext> {
  if (!cachedApp) {
    cachedApp = await NestFactory.createApplicationContext(AppModule, {
      logger: ['error', 'warn', 'log'],
    });
  }

  return cachedApp;
}

export const handler: Handler<unknown, JobSummary> = async () => {
  const app = await getApplication();
  const monitoringService = app.get(MonitoringService);
  return monitoringService.runDailyJob();
};
