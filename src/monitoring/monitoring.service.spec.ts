import { ConfigService } from '@nestjs/config';
import { AiService } from '../ai/ai.service';
import { CARD_FIELDS } from '../cards/card.types';
import type {
  AiVerification,
  CardExtraction,
  CardSource,
  CurrentCardData,
} from '../cards/card.types';
import { CardsRepository } from '../cards/cards.repository';
import type { CardSourceContent } from '../scraper/source.types';
import { SourceService } from '../scraper/source.service';
import { ChangeDetectionService } from './change-detection.service';
import { MonitoringService } from './monitoring.service';
import { VerificationService } from './verification.service';

const card: CardSource = {
  id: 'card-1',
  slug: 'example-card',
  name: 'Example Card',
  issuer: 'Example Bank',
  sourceUrl: 'https://example.com/card',
  fallbackSourceUrl: null,
  enabled: true,
};

const content = [
  'Card: Example Card',
  'Issuer: Example Bank',
  'Purchase APR: 25%',
  'Annual Fee: BDT 1,500',
].join(' ');

const source: CardSourceContent = {
  url: card.sourceUrl,
  finalUrl: card.sourceUrl,
  statusCode: 200,
  fetchedAt: new Date().toISOString(),
  title: card.name,
  contentType: 'text/plain',
  content,
  contentHash: 'source-hash',
  fromCache: false,
  notModified: false,
  mode: 'fixture',
};

const extraction: CardExtraction = {
  cardName: 'Example Card',
  issuer: 'Example Bank',
  purchaseApr: '25%',
  balanceTransferApr: null,
  annualFee: 'BDT 1,500',
  otherFees: null,
  welcomeBonus: null,
  rewardsAndBenefits: null,
  introductoryApr: null,
  restrictions: null,
  evidence: {
    cardName: 'Card: Example Card',
    issuer: 'Issuer: Example Bank',
    purchaseApr: 'Purchase APR: 25%',
    annualFee: 'Annual Fee: BDT 1,500',
  },
};

function aiVerification(): AiVerification {
  return {
    overallStatus: 'verified',
    fields: CARD_FIELDS.map((field) => ({
      field,
      value: extraction[field],
      evidence: extraction.evidence[field] ?? null,
      status: extraction[field] === null ? 'missing' : 'verified',
      reason:
        extraction[field] === null
          ? 'Not stated in the supplied source.'
          : 'Confirmed against the source.',
    })),
    notes: 'Independent pass completed.',
  };
}

const current: CurrentCardData = {
  cardId: card.id,
  cardName: extraction.cardName,
  issuer: extraction.issuer,
  purchaseApr: extraction.purchaseApr,
  balanceTransferApr: extraction.balanceTransferApr,
  annualFee: 'BDT 1,000',
  otherFees: extraction.otherFees,
  welcomeBonus: extraction.welcomeBonus,
  rewardsAndBenefits: extraction.rewardsAndBenefits,
  introductoryApr: extraction.introductoryApr,
  restrictions: extraction.restrictions,
  sourceUrl: card.sourceUrl,
  evidence: {},
  observationId: 'obs-0',
  verifiedAt: new Date(),
  updatedAt: new Date(),
};

const usage = {
  provider: 'mock',
  model: 'mock-fixture',
  inputTokens: 10,
  outputTokens: 5,
  estimatedCostUsd: 0,
  durationMs: 1,
};

function buildHarness() {
  const repository = {
    startJobRun: jest.fn().mockResolvedValue('job-1'),
    listEnabledCards: jest.fn().mockResolvedValue([card]),
    finishJobRun: jest.fn().mockResolvedValue(undefined),
    getLatestObservation: jest.fn().mockResolvedValue(null),
    getCurrentCard: jest.fn().mockResolvedValue(null),
    saveObservation: jest.fn().mockResolvedValue('obs-1'),
    upsertCurrentCard: jest.fn().mockResolvedValue(undefined),
    insertChanges: jest.fn().mockResolvedValue(undefined),
  };
  const sourceService = {
    getCardContent: jest.fn().mockResolvedValue(source),
  };
  const aiService = {
    extractCardData: jest.fn().mockResolvedValue({ data: extraction, usage }),
    verifyCardData: jest
      .fn()
      .mockResolvedValue({ data: aiVerification(), usage }),
  };
  const config = {
    get: jest.fn((key: string, fallback?: unknown) =>
      key === 'MONITOR_CONCURRENCY' ? 1 : fallback,
    ),
  };

  const service = new MonitoringService(
    repository as unknown as CardsRepository,
    sourceService as unknown as SourceService,
    aiService as unknown as AiService,
    new VerificationService(),
    new ChangeDetectionService(),
    config as unknown as ConfigService,
  );

  return { service, repository, sourceService, aiService };
}

describe('MonitoringService', () => {
  it('publishes a verified card on first observation', async () => {
    const { service, repository } = buildHarness();

    const result = await service.processCard(card);

    expect(result.status).toBe('verified');
    expect(repository.upsertCurrentCard).toHaveBeenCalledWith(
      card.id,
      extraction,
      source.url,
      'obs-1',
    );
    expect(repository.insertChanges).toHaveBeenCalledWith(
      card.id,
      'obs-1',
      expect.arrayContaining([
        expect.objectContaining({
          field: 'cardName',
          status: 'INITIAL',
        }),
      ]),
    );
  });

  it('skips AI calls when the source hash is unchanged', async () => {
    const { service, repository, aiService } = buildHarness();
    repository.getLatestObservation.mockResolvedValue({
      id: 'obs-1',
      source_content_hash: source.contentHash,
      observed_at: new Date(),
      status: 'verified',
    });

    const result = await service.processCard(card);

    expect(result.status).toBe('unchanged_source');
    expect(aiService.extractCardData).not.toHaveBeenCalled();
    expect(repository.saveObservation).not.toHaveBeenCalled();
  });

  it('keeps changed values in review and does not overwrite approved data', async () => {
    const { service, repository } = buildHarness();
    repository.getCurrentCard.mockResolvedValue(current);

    const result = await service.processCard(card);

    expect(result.status).toBe('pending_review');
    expect(result.changesDetected).toBe(1);
    expect(repository.upsertCurrentCard).not.toHaveBeenCalled();
    expect(repository.insertChanges).toHaveBeenCalledWith(
      card.id,
      'obs-1',
      expect.arrayContaining([
        expect.objectContaining({
          field: 'annualFee',
          oldValue: 'BDT 1,000',
          newValue: 'BDT 1,500',
          status: 'PENDING_REVIEW',
        }),
      ]),
    );
  });

  it('records a failed observation when processing fails after fetching', async () => {
    const { service, repository, aiService } = buildHarness();
    aiService.extractCardData.mockRejectedValue(new Error('AI unavailable'));

    const result = await service.processCard(card);

    expect(result.status).toBe('failed');
    expect(result.error).toBe('AI unavailable');
    expect(repository.saveObservation).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'failed', error: 'AI unavailable' }),
    );
  });

  it('does not record an observation when the source cannot be fetched', async () => {
    const { service, repository, sourceService } = buildHarness();
    sourceService.getCardContent.mockRejectedValue(new Error('network error'));

    const result = await service.processCard(card);

    expect(result.status).toBe('failed');
    expect(repository.saveObservation).not.toHaveBeenCalled();
  });

  it('aggregates a successful daily job', async () => {
    const { service, repository } = buildHarness();

    const summary = await service.runDailyJob();

    expect(summary.status).toBe('succeeded');
    expect(summary.cardsProcessed).toBe(1);
    expect(summary.cardsVerified).toBe(1);
    expect(summary.changesDetected).toBe(0);
    expect(repository.finishJobRun).toHaveBeenCalledWith(
      'job-1',
      summary,
      'succeeded',
      null,
    );
  });
});
