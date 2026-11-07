import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import type { QueryResultRow } from 'pg';
import { DatabaseService } from '../database/database.service';
import { CARD_FIELDS } from './card.types';
import type {
  CardExtraction,
  CardField,
  CardSource,
  CurrentCardData,
  EvidenceMap,
  FieldChange,
  JobSummary,
  ObservationInput,
} from './card.types';
import { SEED_CARDS, type SeedCard } from './seed-cards';

interface CardRow extends QueryResultRow {
  id: string;
  slug: string;
  name: string;
  issuer: string;
  source_url: string;
  fallback_source_url: string | null;
  enabled: boolean;
}

interface CurrentCardRow extends QueryResultRow {
  card_id: string;
  card_name: string | null;
  issuer: string | null;
  purchase_apr: string | null;
  balance_transfer_apr: string | null;
  annual_fee: string | null;
  other_fees: string | null;
  welcome_bonus: string | null;
  rewards_and_benefits: string | null;
  introductory_apr: string | null;
  restrictions: string | null;
  source_url: string;
  evidence: EvidenceMap;
  observation_id: string | null;
  verified_at: Date | null;
  updated_at: Date;
}

interface ObservationSummaryRow extends QueryResultRow {
  id: string;
  source_content_hash: string;
  observed_at: Date;
  status: 'verified' | 'pending_review' | 'failed';
  error: string | null;
}

interface HistoryRow extends QueryResultRow {
  change_id: string;
  observation_id: string;
  observed_at: Date;
  observation_status: 'verified' | 'pending_review' | 'failed';
  verification: Record<string, unknown>;
  source_url: string;
  source_mode: 'live' | 'fixture';
  field: CardField;
  old_value: string | null;
  new_value: string | null;
  status: FieldChange['status'];
  evidence: string | null;
}

export interface CardWithCurrent {
  card: CardSource;
  current: CurrentCardData | null;
}

export interface HistoryEntry {
  changeId: string;
  observationId: string;
  observedAt: string;
  observationStatus: 'verified' | 'pending_review' | 'failed';
  verification: Record<string, unknown>;
  sourceUrl: string;
  sourceMode: 'live' | 'fixture';
  field: CardField;
  oldValue: string | null;
  newValue: string | null;
  status: FieldChange['status'];
  evidence: string | null;
}

const CURRENT_COLUMN_BY_FIELD: Record<CardField, string> = {
  cardName: 'card_name',
  issuer: 'issuer',
  purchaseApr: 'purchase_apr',
  balanceTransferApr: 'balance_transfer_apr',
  annualFee: 'annual_fee',
  otherFees: 'other_fees',
  welcomeBonus: 'welcome_bonus',
  rewardsAndBenefits: 'rewards_and_benefits',
  introductoryApr: 'introductory_apr',
  restrictions: 'restrictions',
};

@Injectable()
export class CardsRepository implements OnModuleInit {
  private readonly logger = new Logger(CardsRepository.name);

  constructor(private readonly database: DatabaseService) {}

  async onModuleInit(): Promise<void> {
    try {
      const result = await this.database.queryOne<{ count: string }>(
        'SELECT COUNT(*)::text AS count FROM cards',
      );
      if (result && Number(result.count) === 0) {
        this.logger.log(
          'No cards found in database. Auto-seeding initial 10 credit cards...',
        );
        await this.upsertSeedCards(SEED_CARDS);
        this.logger.log(
          `Successfully seeded ${SEED_CARDS.length} credit cards into database.`,
        );
      }
    } catch {
      // Ignored if DB is offline or table does not exist yet
    }
  }

  async listEnabledCards(): Promise<CardSource[]> {
    const rows = await this.database.query<CardRow>(
      `SELECT id, slug, name, issuer, source_url, fallback_source_url, enabled
       FROM cards
       WHERE enabled = TRUE
       ORDER BY issuer, name`,
    );

    return rows.map((row) => this.mapCard(row));
  }

  async getCardById(idOrSlug: string): Promise<CardSource | null> {
    const isUuid =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        idOrSlug,
      );

    const row = isUuid
      ? await this.database.queryOne<CardRow>(
          `SELECT id, slug, name, issuer, source_url, fallback_source_url, enabled
           FROM cards
           WHERE id = $1`,
          [idOrSlug],
        )
      : await this.database.queryOne<CardRow>(
          `SELECT id, slug, name, issuer, source_url, fallback_source_url, enabled
           FROM cards
           WHERE slug = $1`,
          [idOrSlug],
        );

    return row ? this.mapCard(row) : null;
  }

  async getCardBySlug(slug: string): Promise<CardSource | null> {
    const row = await this.database.queryOne<CardRow>(
      `SELECT id, slug, name, issuer, source_url, fallback_source_url, enabled
       FROM cards
       WHERE slug = $1`,
      [slug],
    );

    return row ? this.mapCard(row) : null;
  }

  async getCurrentCard(cardId: string): Promise<CurrentCardData | null> {
    const row = await this.database.queryOne<CurrentCardRow>(
      `SELECT *
       FROM card_current
       WHERE card_id = $1`,
      [cardId],
    );

    return row ? this.mapCurrentCard(row) : null;
  }

  async getLatestObservation(
    cardId: string,
  ): Promise<ObservationSummaryRow | null> {
    return this.database.queryOne<ObservationSummaryRow>(
      `SELECT id, source_content_hash, observed_at, status, error
       FROM card_observations
       WHERE card_id = $1
       ORDER BY observed_at DESC
       LIMIT 1`,
      [cardId],
    );
  }

  async saveObservation(input: ObservationInput): Promise<string> {
    const row = await this.database.queryOne<{ id: string }>(
      `INSERT INTO card_observations (
         card_id,
         source_url,
         source_mode,
         source_content_hash,
         extraction,
         verification,
         status,
         ai_model,
         input_tokens,
         output_tokens,
         estimated_cost_usd,
         duration_ms,
         error
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
       RETURNING id`,
      [
        input.cardId,
        input.sourceUrl,
        input.sourceMode,
        input.sourceContentHash,
        JSON.stringify(input.extraction),
        JSON.stringify(input.verification),
        input.status,
        input.aiModel,
        input.inputTokens,
        input.outputTokens,
        input.estimatedCostUsd,
        input.durationMs,
        input.error,
      ],
    );

    if (!row) {
      throw new Error('Failed to save card observation');
    }

    return row.id;
  }

  async upsertCurrentCard(
    cardId: string,
    extraction: CardExtraction,
    sourceUrl: string,
    observationId: string,
  ): Promise<void> {
    const values = CARD_FIELDS.map((field) => extraction[field]);
    const columns = CARD_FIELDS.map((field) => CURRENT_COLUMN_BY_FIELD[field]);

    await this.database.query(
      `INSERT INTO card_current (
         card_id,
         ${columns.join(', ')},
         source_url,
         evidence,
         observation_id,
         verified_at,
         updated_at
       )
       VALUES (
         $1,
         $2, $3, $4, $5, $6, $7, $8, $9, $10, $11,
         $12, $13, $14, NOW(), NOW()
       )
       ON CONFLICT (card_id) DO UPDATE SET
         ${columns
           .map((column) => `${column} = EXCLUDED.${column}`)
           .join(', ')},
         source_url = EXCLUDED.source_url,
         evidence = EXCLUDED.evidence,
         observation_id = EXCLUDED.observation_id,
         verified_at = NOW(),
         updated_at = NOW()`,
      [
        cardId,
        ...values,
        sourceUrl,
        JSON.stringify(extraction.evidence),
        observationId,
      ],
    );
  }

  async insertChanges(
    cardId: string,
    observationId: string,
    changes: FieldChange[],
  ): Promise<void> {
    for (const change of changes) {
      await this.database.query(
        `INSERT INTO card_changes (
           card_id,
           observation_id,
           field,
           old_value,
           new_value,
           status,
           evidence
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          cardId,
          observationId,
          change.field,
          change.oldValue,
          change.newValue,
          change.status,
          change.evidence,
        ],
      );
    }
  }

  async getCardsWithCurrent(): Promise<CardWithCurrent[]> {
    const rows = await this.database.query<CardRow & Partial<CurrentCardRow>>(
      `SELECT
         c.id,
         c.slug,
         c.name,
         c.issuer,
         c.source_url,
         c.fallback_source_url,
         c.enabled,
         cc.card_id,
         cc.card_name,
         cc.issuer AS current_issuer,
         cc.purchase_apr,
         cc.balance_transfer_apr,
         cc.annual_fee,
         cc.other_fees,
         cc.welcome_bonus,
         cc.rewards_and_benefits,
         cc.introductory_apr,
         cc.restrictions,
         cc.source_url AS current_source_url,
         cc.evidence,
         cc.observation_id,
         cc.verified_at,
         cc.updated_at
       FROM cards c
       LEFT JOIN card_current cc ON cc.card_id = c.id
       WHERE c.enabled = TRUE
       ORDER BY c.issuer, c.name`,
    );

    return rows.map((row) => ({
      card: this.mapCard(row),
      current: row.card_id
        ? this.mapCurrentCard({
            card_id: row.card_id,
            card_name: row.card_name ?? null,
            issuer: row.current_issuer ?? null,
            purchase_apr: row.purchase_apr ?? null,
            balance_transfer_apr: row.balance_transfer_apr ?? null,
            annual_fee: row.annual_fee ?? null,
            other_fees: row.other_fees ?? null,
            welcome_bonus: row.welcome_bonus ?? null,
            rewards_and_benefits: row.rewards_and_benefits ?? null,
            introductory_apr: row.introductory_apr ?? null,
            restrictions: row.restrictions ?? null,
            source_url: row.current_source_url ?? row.source_url,
            evidence: row.evidence ?? {},
            observation_id: row.observation_id ?? null,
            verified_at: row.verified_at ?? null,
            updated_at: row.updated_at ?? new Date(),
          })
        : null,
    }));
  }

  async getHistory(cardId: string): Promise<HistoryEntry[]> {
    const rows = await this.database.query<HistoryRow>(
      `SELECT
         ch.id AS change_id,
         ch.observation_id,
         o.observed_at,
         o.status AS observation_status,
         o.verification,
         o.source_url,
         o.source_mode,
         ch.field,
         ch.old_value,
         ch.new_value,
         ch.status,
         ch.evidence
       FROM card_changes ch
       JOIN card_observations o ON o.id = ch.observation_id
       WHERE ch.card_id = $1
       ORDER BY o.observed_at DESC, ch.field ASC`,
      [cardId],
    );

    return rows.map((row) => ({
      changeId: row.change_id,
      observationId: row.observation_id,
      observedAt: row.observed_at.toISOString(),
      observationStatus: row.observation_status,
      verification: row.verification,
      sourceUrl: row.source_url,
      sourceMode: row.source_mode,
      field: row.field,
      oldValue: row.old_value,
      newValue: row.new_value,
      status: row.status,
      evidence: row.evidence,
    }));
  }

  async upsertSeedCards(cards: SeedCard[]): Promise<void> {
    await this.database.transaction(async (client) => {
      for (const card of cards) {
        await client.query(
          `INSERT INTO cards (
             slug,
             name,
             issuer,
             source_url,
             fallback_source_url
           )
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (slug) DO UPDATE SET
             name = EXCLUDED.name,
             issuer = EXCLUDED.issuer,
             source_url = EXCLUDED.source_url,
             fallback_source_url = EXCLUDED.fallback_source_url,
             updated_at = NOW()`,
          [
            card.slug,
            card.name,
            card.issuer,
            card.sourceUrl,
            card.fallbackSourceUrl,
          ],
        );
      }
    });
  }

  async startJobRun(): Promise<string> {
    const row = await this.database.queryOne<{ id: string }>(
      `INSERT INTO job_runs DEFAULT VALUES RETURNING id`,
    );

    if (!row) {
      throw new Error('Failed to create job run');
    }

    return row.id;
  }

  async finishJobRun(
    jobRunId: string,
    summary: JobSummary,
    status: JobSummary['status'],
    error: string | null,
  ): Promise<void> {
    await this.database.query(
      `UPDATE job_runs
       SET finished_at = NOW(),
           status = $2,
           cards_processed = $3,
           cards_failed = $4,
           changes_detected = $5,
           summary = $6,
           error = $7
       WHERE id = $1`,
      [
        jobRunId,
        status,
        summary.cardsProcessed,
        summary.cardsFailed,
        summary.changesDetected,
        JSON.stringify(summary),
        error,
      ],
    );
  }

  async getLatestJobRun(): Promise<{
    id: string;
    startedAt: string;
    finishedAt: string | null;
    status: string;
    cardsProcessed: number;
    cardsFailed: number;
    changesDetected: number;
    summary: JobSummary | null;
    error: string | null;
  } | null> {
    const row = await this.database.queryOne<{
      id: string;
      started_at: Date;
      finished_at: Date | null;
      status: string;
      cards_processed: number;
      cards_failed: number;
      changes_detected: number;
      summary: JobSummary | null;
      error: string | null;
    }>(
      `SELECT id, started_at, finished_at, status, cards_processed, cards_failed, changes_detected, summary, error
       FROM job_runs
       ORDER BY started_at DESC
       LIMIT 1`,
    );

    if (!row) return null;

    return {
      id: row.id,
      startedAt: row.started_at.toISOString(),
      finishedAt: row.finished_at ? row.finished_at.toISOString() : null,
      status: row.status,
      cardsProcessed: row.cards_processed,
      cardsFailed: row.cards_failed,
      changesDetected: row.changes_detected,
      summary: row.summary,
      error: row.error,
    };
  }

  private mapCard(row: CardRow): CardSource {
    return {
      id: row.id,
      slug: row.slug,
      name: row.name,
      issuer: row.issuer,
      sourceUrl: row.source_url,
      fallbackSourceUrl: row.fallback_source_url,
      enabled: row.enabled,
    };
  }

  private mapCurrentCard(row: CurrentCardRow): CurrentCardData {
    return {
      cardId: row.card_id,
      cardName: row.card_name,
      issuer: row.issuer,
      purchaseApr: row.purchase_apr,
      balanceTransferApr: row.balance_transfer_apr,
      annualFee: row.annual_fee,
      otherFees: row.other_fees,
      welcomeBonus: row.welcome_bonus,
      rewardsAndBenefits: row.rewards_and_benefits,
      introductoryApr: row.introductory_apr,
      restrictions: row.restrictions,
      sourceUrl: row.source_url,
      evidence: row.evidence ?? {},
      observationId: row.observation_id,
      verifiedAt: row.verified_at,
      updatedAt: row.updated_at,
    };
  }
}
