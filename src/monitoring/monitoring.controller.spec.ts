import { Test, TestingModule } from '@nestjs/testing';
import { MonitoringController } from './monitoring.controller';
import { MonitoringService } from './monitoring.service';
import type { JobSummary } from '../cards/card.types';

describe('MonitoringController', () => {
  let controller: MonitoringController;
  let service: {
    runDailyJob: jest.Mock;
  };

  beforeEach(async () => {
    service = {
      runDailyJob: jest.fn(),
      getLatestJobRun: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [MonitoringController],
      providers: [
        {
          provide: MonitoringService,
          useValue: service,
        },
      ],
    }).compile();

    controller = module.get<MonitoringController>(MonitoringController);
  });

  it('POST /monitoring/run triggers runDailyJob and returns wrapped summary', async () => {
    const mockSummary: JobSummary = {
      jobRunId: 'job-1',
      status: 'succeeded',
      startedAt: '2026-11-06T10:00:00.000Z',
      finishedAt: '2026-11-06T10:00:05.000Z',
      durationMs: 5000,
      cardsProcessed: 1,
      cardsFailed: 0,
      changesDetected: 0,
      cardsVerified: 1,
      cardsPendingReview: 0,
      inputTokens: 100,
      outputTokens: 50,
      estimatedCostUsd: 0.0001,
      results: [],
    };
    service.runDailyJob.mockResolvedValue(mockSummary);

    const result = await controller.runDailyJob();
    expect(result).toEqual({ data: mockSummary });
    expect(service.runDailyJob).toHaveBeenCalledTimes(1);
  });

  it('GET /monitoring/status returns latest job run info', async () => {
    service.getLatestJobRun.mockResolvedValue({ id: 'job-1', status: 'succeeded' });

    const result = await controller.getStatus();
    expect(result).toEqual({ success: true, data: { id: 'job-1', status: 'succeeded' } });
    expect(service.getLatestJobRun).toHaveBeenCalledTimes(1);
  });
});
