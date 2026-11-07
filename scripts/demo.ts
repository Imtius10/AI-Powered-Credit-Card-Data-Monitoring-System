import 'dotenv/config';
import { randomUUID } from 'crypto';
import { cp, mkdtemp, readFile, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join, resolve } from 'path';
import { NestFactory } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import type { INestApplicationContext } from '@nestjs/common';
import { AppModule } from '../src/app.module';
import { CardsRepository } from '../src/cards/cards.repository';
import type {
  CardWithCurrent,
  HistoryEntry,
} from '../src/cards/cards.repository';
import { CardsService } from '../src/cards/cards.service';
import { SEED_CARDS } from '../src/cards/seed-cards';
import type { SeedCard } from '../src/cards/seed-cards';
import type {
  CardExtraction,
  CardSource,
  CurrentCardData,
  FieldChange,
  JobSummary,
  ObservationInput,
} from '../src/cards/card.types';
import { MonitoringService } from '../src/monitoring/monitoring.service';
import { SourceCacheRepository } from '../src/scraper/source-cache.repository';
import type { CachedSource } from '../src/scraper/source-cache.repository';
import { DatabaseService } from '../src/database/database.service';

const ROOT = resolve(__dirname, '..');
const SAMPLES_DIR = join(ROOT, 'samples');
const CHANGED_SLUG = 'brac-visa-infinite';

class InMemoryCardsRepository {
  private cards = new Map<string, CardSource>();
  private currentCards = new Map<string, CurrentCardData>();
  private observations = new Map<string, any>();
  private cardObservations = new Map<string, any[]>();
  private changes: Array<any> = [];
  private jobRuns = new Map<string, any>();

  async upsertSeedCards(cards: SeedCard[]): Promise<void> {
    for (const card of cards) {
      const existing = Array.from(this.cards.values()).find(
        (c) => c.slug === card.slug,
      );
      const id = existing?.id ?? randomUUID();
      this.cards.set(id, {
        id,
        slug: card.slug,
        name: card.name,
        issuer: card.issuer,
        sourceUrl: card.sourceUrl,
        fallbackSourceUrl: card.fallbackSourceUrl,
        enabled: true,
      });
    }
  }

  async listEnabledCards(): Promise<CardSource[]> {
    return Array.from(this.cards.values()).filter((c) => c.enabled);
  }

  async getCardById(id: string): Promise<CardSource | null> {
    return this.cards.get(id) ?? null;
  }

  async getCardBySlug(slug: string): Promise<CardSource | null> {
    return Array.from(this.cards.values()).find((c) => c.slug === slug) ?? null;
  }

  async getCurrentCard(cardId: string): Promise<CurrentCardData | null> {
    return this.currentCards.get(cardId) ?? null;
  }

  async getLatestObservation(cardId: string): Promise<any | null> {
    const list = this.cardObservations.get(cardId) ?? [];
    return list[list.length - 1] ?? null;
  }

  async saveObservation(input: ObservationInput): Promise<string> {
    const id = randomUUID();
    const obs = {
      id,
      card_id: input.cardId,
      source_content_hash: input.sourceContentHash,
      observed_at: new Date(),
      status: input.status,
      error: input.error,
      extraction: input.extraction,
      verification: input.verification,
      source_url: input.sourceUrl,
      source_mode: input.sourceMode,
    };
    this.observations.set(id, obs);
    const list = this.cardObservations.get(input.cardId) ?? [];
    list.push(obs);
    this.cardObservations.set(input.cardId, list);
    return id;
  }

  async upsertCurrentCard(
    cardId: string,
    extraction: CardExtraction,
    sourceUrl: string,
    observationId: string,
  ): Promise<void> {
    const now = new Date();
    this.currentCards.set(cardId, {
      cardId,
      cardName: extraction.cardName,
      issuer: extraction.issuer,
      purchaseApr: extraction.purchaseApr,
      balanceTransferApr: extraction.balanceTransferApr,
      annualFee: extraction.annualFee,
      otherFees: extraction.otherFees,
      welcomeBonus: extraction.welcomeBonus,
      rewardsAndBenefits: extraction.rewardsAndBenefits,
      introductoryApr: extraction.introductoryApr,
      restrictions: extraction.restrictions,
      sourceUrl,
      evidence: extraction.evidence,
      observationId,
      verifiedAt: now,
      updatedAt: now,
    });
  }

  async insertChanges(
    cardId: string,
    observationId: string,
    changes: FieldChange[],
  ): Promise<void> {
    for (const change of changes) {
      this.changes.push({
        id: randomUUID(),
        cardId,
        observationId,
        field: change.field,
        oldValue: change.oldValue,
        newValue: change.newValue,
        status: change.status,
        evidence: change.evidence,
        detectedAt: new Date(),
      });
    }
  }

  async getCardsWithCurrent(): Promise<CardWithCurrent[]> {
    const enabled = await this.listEnabledCards();
    return enabled.map((card) => ({
      card,
      current: this.currentCards.get(card.id) ?? null,
    }));
  }

  async getHistory(cardId: string): Promise<HistoryEntry[]> {
    const cardChanges = this.changes.filter((c) => c.cardId === cardId);
    return cardChanges.map((change) => {
      const obs = this.observations.get(change.observationId);
      return {
        changeId: change.id,
        observationId: change.observationId,
        observedAt: obs?.observedAt?.toISOString() ?? new Date().toISOString(),
        observationStatus: obs?.status ?? 'verified',
        verification: obs?.verification ?? {},
        sourceUrl: obs?.source_url ?? '',
        sourceMode: obs?.source_mode ?? 'fixture',
        field: change.field,
        oldValue: change.oldValue,
        newValue: change.newValue,
        status: change.status,
        evidence: change.evidence,
      };
    });
  }

  async startJobRun(): Promise<string> {
    const id = randomUUID();
    this.jobRuns.set(id, { id, startedAt: new Date() });
    return id;
  }

  async finishJobRun(
    jobRunId: string,
    summary: JobSummary,
    status: JobSummary['status'],
    error: string | null,
  ): Promise<void> {
    const job = this.jobRuns.get(jobRunId) ?? {};
    this.jobRuns.set(jobRunId, {
      ...job,
      finishedAt: new Date(),
      summary,
      status,
      error,
    });
  }
}

class InMemorySourceCacheRepository {
  private cache = new Map<string, CachedSource>();

  async get(url: string): Promise<CachedSource | null> {
    return this.cache.get(url) ?? null;
  }

  async save(input: {
    url: string;
    etag: string | null;
    lastModified: string | null;
    contentHash: string;
    content: string;
    contentType: string | null;
  }): Promise<void> {
    this.cache.set(input.url, {
      ...input,
      fetchedAt: new Date(),
    });
  }
}

// Shared in-memory instances across createContext calls within the same demo process
const sharedInMemoryCardsRepository = new InMemoryCardsRepository();
const sharedInMemorySourceCacheRepository = new InMemorySourceCacheRepository();

async function isDatabaseReachable(): Promise<boolean> {
  try {
    const testApp = await NestFactory.createApplicationContext(AppModule, {
      logger: false,
    });
    try {
      const db = testApp.get(DatabaseService);
      await db.ping();
      return true;
    } finally {
      await testApp.close();
    }
  } catch {
    return false;
  }
}

let cachedDbReachable: boolean | null = null;

async function createContext(): Promise<INestApplicationContext> {
  if (cachedDbReachable === null) {
    cachedDbReachable = await isDatabaseReachable();
    if (!cachedDbReachable) {
      console.log(
        'Note: PostgreSQL is not reachable locally. Running demo using in-memory repository store.',
      );
    }
  }

  if (cachedDbReachable) {
    return NestFactory.createApplicationContext(AppModule, {
      logger: ['error', 'warn'],
    });
  }

  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  })
    .overrideProvider(CardsRepository)
    .useValue(sharedInMemoryCardsRepository)
    .overrideProvider(SourceCacheRepository)
    .useValue(sharedInMemorySourceCacheRepository)
    .compile();

  return moduleRef;
}

async function writeSample(name: string, value: unknown): Promise<void> {
  await writeFile(
    join(SAMPLES_DIR, name),
    `${JSON.stringify(value, null, 2)}\n`,
    'utf8',
  );
}

async function exportApiSamples(
  app: INestApplicationContext,
  jobSampleName: string,
  summary: JobSummary,
): Promise<void> {
  const cardsService = app.get(CardsService);
  const repository = app.get(CardsRepository);
  const cardsEnvelope = await cardsService.getCardsResponse();
  const card = await repository.getCardBySlug(CHANGED_SLUG);
  const history = card ? await cardsService.getCardHistory(card.id) : null;

  await writeSample('cards-response.json', cardsEnvelope);
  await writeSample('card-history.json', history);
  await writeSample(jobSampleName, summary);
}

async function main(): Promise<void> {
  const fixtureRoot = join(ROOT, 'fixtures', 'sources');
  const responseFile = join(ROOT, 'fixtures', 'ai-responses.json');

  process.env.SOURCE_MODE = 'fixtures';
  process.env.AI_PROVIDER = 'mock';
  process.env.FIXTURE_DIR = fixtureRoot;
  process.env.MOCK_AI_RESPONSES_FILE = responseFile;

  const app = await createContext();
  let baselineSummary: JobSummary;

  try {
    await app.get(CardsRepository).upsertSeedCards(SEED_CARDS);
    baselineSummary = await app.get(MonitoringService).runDailyJob();
  } finally {
    await app.close();
  }

  const tempRoot = await mkdtemp(join(tmpdir(), 'card-monitor-demo-'));

  try {
    const changedFixtures = join(tempRoot, 'sources');
    await cp(fixtureRoot, changedFixtures, { recursive: true });

    const changedFixturePath = join(changedFixtures, `${CHANGED_SLUG}.txt`);
    const changedFixture = await readFile(changedFixturePath, 'utf8');
    await writeFile(
      changedFixturePath,
      changedFixture.replace(
        'Annual Fee- Primary Card: TK. 20,000',
        'Annual Fee- Primary Card: TK. 22,000',
      ),
      'utf8',
    );

    const responses = JSON.parse(
      await readFile(responseFile, 'utf8'),
    ) as Record<string, unknown>;
    const infinite = responses[CHANGED_SLUG] as {
      extract: {
        annualFee: string;
        evidence: Record<string, string>;
      };
      verify: {
        fields: Array<{
          field: string;
          value: string | null;
          evidence: string | null;
        }>;
      };
    };
    infinite.extract.annualFee = 'TK. 22,000';
    infinite.extract.evidence.annualFee =
      'Annual Fee- Primary Card: TK. 22,000';
    const annualFeeVerification = infinite.verify.fields.find(
      (field) => field.field === 'annualFee',
    );
    if (annualFeeVerification) {
      annualFeeVerification.value = 'TK. 22,000';
      annualFeeVerification.evidence = 'Annual Fee- Primary Card: TK. 22,000';
    }

    const changedResponses = join(tempRoot, 'ai-responses.json');
    await writeFile(
      changedResponses,
      `${JSON.stringify(responses, null, 2)}\n`,
      'utf8',
    );

    process.env.FIXTURE_DIR = changedFixtures;
    process.env.MOCK_AI_RESPONSES_FILE = changedResponses;

    const changedApp = await createContext();

    try {
      const changedSummary = await changedApp
        .get(MonitoringService)
        .runDailyJob();

      await exportApiSamples(
        changedApp,
        'job-summary-changed-source.json',
        changedSummary,
      );

      const changedCard = changedSummary.results.find(
        (result) => result.slug === CHANGED_SLUG,
      );
      console.log(
        `Changed-source demo result: ${changedCard?.status ?? 'not processed'} with ${changedCard?.changesDetected ?? 0} pending change(s).`,
      );
    } finally {
      await changedApp.close();
    }

    const baselineApp = await createContext();
    try {
      await exportApiSamples(baselineApp, 'job-summary.json', baselineSummary);
    } finally {
      await baselineApp.close();
    }
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }

  console.log(
    `Demo complete. API and job samples were written to ${SAMPLES_DIR}.`,
  );
}

void main().catch((error: unknown) => {
  console.error('Demo failed:', error);
  process.exitCode = 1;
});
