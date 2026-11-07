import { NestFactory } from '@nestjs/core';
import type { INestApplicationContext } from '@nestjs/common';
import { handler } from './lambda';
import { MonitoringService } from './monitoring/monitoring.service';
import type { JobSummary } from './cards/card.types';

jest.mock('@nestjs/core', () => ({
  NestFactory: {
    createApplicationContext: jest.fn(),
  },
}));

describe('Lambda Handler', () => {
  let mockMonitoringService: { runDailyJob: jest.Mock };
  let mockApp: Partial<INestApplicationContext>;

  beforeEach(() => {
    jest.clearAllMocks();
    mockMonitoringService = {
      runDailyJob: jest.fn(),
    };
    mockApp = {
      get: jest.fn().mockImplementation((token) => {
        if (token === MonitoringService) {
          return mockMonitoringService;
        }
        return null;
      }),
    };
    (NestFactory.createApplicationContext as jest.Mock).mockResolvedValue(
      mockApp,
    );
  });

  it('initializes application context and delegates to MonitoringService.runDailyJob', async () => {
    const mockSummary: JobSummary = {
      jobRunId: 'job-lambda-1',
      status: 'succeeded',
      startedAt: '2026-11-06T10:00:00.000Z',
      finishedAt: '2026-11-06T10:00:15.000Z',
      durationMs: 15000,
      cardsProcessed: 10,
      cardsFailed: 0,
      changesDetected: 0,
      cardsVerified: 10,
      cardsPendingReview: 0,
      inputTokens: 1000,
      outputTokens: 500,
      estimatedCostUsd: 0.001,
      results: [],
    };
    mockMonitoringService.runDailyJob.mockResolvedValue(mockSummary);

    const result = await (handler as any)({}, {} as any, () => {});

    expect(result).toEqual(mockSummary);
    expect(mockMonitoringService.runDailyJob).toHaveBeenCalledTimes(1);
  });
});
