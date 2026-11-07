import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { mapWithConcurrency } from '../common/retry';
import type {
  CardExtraction,
  CardProcessingResult,
  CardSource,
  JobSummary,
} from '../cards/card.types';
import { CardsRepository } from '../cards/cards.repository';
import { AiService } from '../ai/ai.service';
import { SourceService } from '../scraper/source.service';
import type { CardSourceContent } from '../scraper/source.types';
import { ChangeDetectionService } from './change-detection.service';
import { VerificationService } from './verification.service';

@Injectable()
export class MonitoringService {
  private readonly logger = new Logger(MonitoringService.name);
  private readonly concurrency: number;

  constructor(
    private readonly cardsRepository: CardsRepository,
    private readonly sourceService: SourceService,
    private readonly aiService: AiService,
    private readonly verificationService: VerificationService,
    private readonly changeDetectionService: ChangeDetectionService,
    private readonly configService: ConfigService,
  ) {
    this.concurrency = Number(this.configService.get('MONITOR_CONCURRENCY', 3));
  }

  async runDailyJob(): Promise<JobSummary> {
    const startedAt = new Date();
    const jobRunId = await this.cardsRepository.startJobRun();
    const cards = await this.cardsRepository.listEnabledCards();

    this.logger.log(
      `Starting daily monitoring job ${jobRunId} for ${cards.length} cards with concurrency ${this.concurrency}`,
    );

    const results = await mapWithConcurrency(
      cards,
      this.concurrency,
      async (card) => this.processCard(card),
    );

    const cardsFailed = results.filter(
      (result) => result.status === 'failed',
    ).length;
    const cardsPendingReview = results.filter(
      (result) => result.status === 'pending_review',
    ).length;
    const cardsVerified = results.filter(
      (result) => result.status === 'verified',
    ).length;
    const changesDetected = results.reduce(
      (total, result) => total + result.changesDetected,
      0,
    );
    const inputTokens = results.reduce(
      (total, result) => total + result.inputTokens,
      0,
    );
    const outputTokens = results.reduce(
      (total, result) => total + result.outputTokens,
      0,
    );
    const estimatedCostUsd = results.reduce(
      (total, result) => total + result.estimatedCostUsd,
      0,
    );

    const finishedAt = new Date();
    const status: JobSummary['status'] =
      cards.length > 0 && cardsFailed === cards.length
        ? 'failed'
        : cardsFailed > 0
          ? 'partial_failure'
          : 'succeeded';

    const summary: JobSummary = {
      jobRunId,
      status,
      startedAt: startedAt.toISOString(),
      finishedAt: finishedAt.toISOString(),
      durationMs: finishedAt.getTime() - startedAt.getTime(),
      cardsProcessed: results.length - cardsFailed,
      cardsFailed,
      changesDetected,
      cardsVerified,
      cardsPendingReview,
      inputTokens,
      outputTokens,
      estimatedCostUsd,
      results,
    };

    await this.cardsRepository.finishJobRun(jobRunId, summary, status, null);

    this.logger.log(
      `Finished job ${jobRunId}: ${summary.cardsVerified} verified, ${summary.cardsPendingReview} pending review, ${summary.cardsFailed} failed, ${changesDetected} changes`,
    );

    return summary;
  }

  async getLatestJobRun() {
    return this.cardsRepository.getLatestJobRun();
  }

  async processCard(card: CardSource): Promise<CardProcessingResult> {
    const startedAt = Date.now();
    let source: CardSourceContent | null = null;

    try {
      source = await this.sourceService.getCardContent(card);
      const latestObservation = await this.cardsRepository.getLatestObservation(
        card.id,
      );

      if (
        latestObservation &&
        latestObservation.source_content_hash === source.contentHash &&
        latestObservation.status !== 'failed' &&
        !latestObservation.error
      ) {
        this.logger.log(
          `Source content unchanged for ${card.slug}; skipping AI calls`,
        );

        return {
          cardId: card.id,
          slug: card.slug,
          status: 'unchanged_source',
          changesDetected: 0,
          durationMs: Date.now() - startedAt,
          inputTokens: 0,
          outputTokens: 0,
          estimatedCostUsd: 0,
        };
      }

      const extractionResult = await this.aiService.extractCardData(
        card,
        source.content,
      );

      const enableSecondPass =
        this.configService.get<string>('AI_SECOND_PASS', 'true') === 'true';

      const aiVerification = enableSecondPass
        ? await this.aiService.verifyCardData(
            card,
            source.content,
            extractionResult.data,
          )
        : this.aiService.buildDeterministicVerification(
            card,
            source.content,
            extractionResult.data,
          );

      const verification = this.verificationService.evaluate(
        card,
        source.content,
        extractionResult.data,
        aiVerification.data,
      );

      const current = await this.cardsRepository.getCurrentCard(card.id);
      const changes = this.changeDetectionService.compare(
        current,
        extractionResult.data,
      );
      const pendingChanges =
        this.changeDetectionService.countPendingChanges(changes);

      const observationId = await this.cardsRepository.saveObservation({
        cardId: card.id,
        sourceUrl: source.url,
        sourceMode: source.mode,
        sourceContentHash: source.contentHash,
        extraction: extractionResult.data,
        verification: {
          status: verification.status,
          fields: verification.fields,
          notes: verification.notes,
          ai: aiVerification.data,
          usage: {
            extraction: extractionResult.usage,
            verification: aiVerification.usage,
          },
        },
        status: verification.status,
        aiModel: [
          extractionResult.usage.model,
          aiVerification.usage.model,
        ].join(' + '),
        inputTokens:
          extractionResult.usage.inputTokens + aiVerification.usage.inputTokens,
        outputTokens:
          extractionResult.usage.outputTokens +
          aiVerification.usage.outputTokens,
        estimatedCostUsd:
          extractionResult.usage.estimatedCostUsd +
          aiVerification.usage.estimatedCostUsd,
        durationMs: Date.now() - startedAt,
        error: null,
      });

      const canPublish =
        verification.status === 'verified' &&
        (current === null ||
          current.verifiedAt === null ||
          pendingChanges === 0);

      if (canPublish) {
        await this.cardsRepository.upsertCurrentCard(
          card.id,
          extractionResult.data,
          source.url,
          observationId,
        );
      }

      await this.cardsRepository.insertChanges(
        card.id,
        observationId,
        changes.filter((change) => change.status !== 'UNCHANGED'),
      );

      const status = canPublish ? 'verified' : 'pending_review';
      const inputTokens =
        extractionResult.usage.inputTokens + aiVerification.usage.inputTokens;
      const outputTokens =
        extractionResult.usage.outputTokens + aiVerification.usage.outputTokens;

      this.logger.log(
        `${card.slug}: ${status} (${pendingChanges} pending changes, ${inputTokens}/${outputTokens} tokens)`,
      );

      return {
        cardId: card.id,
        slug: card.slug,
        status,
        changesDetected: pendingChanges,
        durationMs: Date.now() - startedAt,
        inputTokens,
        outputTokens,
        estimatedCostUsd:
          extractionResult.usage.estimatedCostUsd +
          aiVerification.usage.estimatedCostUsd,
      };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);

      this.logger.error(`Failed to process ${card.slug}: ${message}`);

      if (source) {
        await this.saveFailedObservation(card, source, message, startedAt);
      }

      return {
        cardId: card.id,
        slug: card.slug,
        status: 'failed',
        changesDetected: 0,
        durationMs: Date.now() - startedAt,
        inputTokens: 0,
        outputTokens: 0,
        estimatedCostUsd: 0,
        error: message,
      };
    }
  }

  private async saveFailedObservation(
    card: CardSource,
    source: CardSourceContent,
    errorMessage: string,
    startedAt: number,
  ): Promise<void> {
    const emptyExtraction = this.emptyExtraction();

    try {
      await this.cardsRepository.saveObservation({
        cardId: card.id,
        sourceUrl: source.url,
        sourceMode: source.mode,
        sourceContentHash: source.contentHash,
        extraction: emptyExtraction,
        verification: {
          status: 'pending_review',
          fields: [],
          notes: 'Processing failed before verification completed.',
          ai: {
            overallStatus: 'needs_review',
            fields: [],
            notes: null,
          },
          usage: {
            extraction: {
              provider: 'none',
              model: 'none',
              inputTokens: 0,
              outputTokens: 0,
              estimatedCostUsd: 0,
              durationMs: 0,
            },
            verification: {
              provider: 'none',
              model: 'none',
              inputTokens: 0,
              outputTokens: 0,
              estimatedCostUsd: 0,
              durationMs: 0,
            },
          },
        },
        status: 'failed',
        aiModel: null,
        inputTokens: 0,
        outputTokens: 0,
        estimatedCostUsd: 0,
        durationMs: Date.now() - startedAt,
        error: errorMessage,
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `Could not persist failed observation for ${card.slug}: ${message}`,
      );
    }
  }

  private emptyExtraction(): CardExtraction {
    return {
      cardName: null,
      issuer: null,
      purchaseApr: null,
      balanceTransferApr: null,
      annualFee: null,
      otherFees: null,
      welcomeBonus: null,
      rewardsAndBenefits: null,
      introductoryApr: null,
      restrictions: null,
      evidence: {},
    };
  }
}
