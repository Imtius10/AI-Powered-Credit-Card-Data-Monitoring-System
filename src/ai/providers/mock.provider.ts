import { readFile } from 'fs/promises';
import { resolve } from 'path';
import { ConfigService } from '@nestjs/config';
import type {
  AiProvider,
  AiProviderRequest,
  AiProviderResponse,
} from './ai-provider.interface';

interface MockAiFixture {
  extract?: Record<string, unknown>;
  verify?: Record<string, unknown>;
}

type MockAiFixtures = Record<string, MockAiFixture>;

export class MockProvider implements AiProvider {
  readonly name = 'mock';
  private readonly fixtureFile: string;
  private cachedFixtures: MockAiFixtures | null = null;

  constructor(private readonly configService: ConfigService) {
    this.fixtureFile = resolve(
      this.configService.get<string>(
        'MOCK_AI_RESPONSES_FILE',
        'fixtures/ai-responses.json',
      ),
    );
  }

  async generate(request: AiProviderRequest): Promise<AiProviderResponse> {
    const startedAt = Date.now();
    const fixtures = await this.loadFixtures();
    const response = fixtures[request.cardSlug]?.[request.task];

    if (!response) {
      throw new Error(
        `No mock AI ${request.task} response for card "${request.cardSlug}"`,
      );
    }

    const text = JSON.stringify(response);
    const inputTokens = Math.ceil(
      (request.system.length + request.prompt.length) / 4,
    );
    const outputTokens = Math.ceil(text.length / 4);

    return {
      text,
      model: 'mock-fixture',
      inputTokens,
      outputTokens,
      estimatedCostUsd: 0,
      durationMs: Date.now() - startedAt,
    };
  }

  private async loadFixtures(): Promise<MockAiFixtures> {
    if (this.cachedFixtures) {
      return this.cachedFixtures;
    }

    const content = await readFile(this.fixtureFile, 'utf8');
    this.cachedFixtures = JSON.parse(content) as MockAiFixtures;
    return this.cachedFixtures;
  }
}
