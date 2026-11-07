import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import type {
  AiProvider,
  AiProviderRequest,
  AiProviderResponse,
} from './ai-provider.interface';

interface OpenAiResponse {
  choices?: Array<{
    message?: {
      content?: string | null;
    };
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
  };
}

export class OpenAiCompatibleProvider implements AiProvider {
  readonly name = 'openai-compatible';
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly model: string;
  private readonly timeoutMs: number;
  private readonly inputCostPerMillion: number;
  private readonly outputCostPerMillion: number;

  constructor(private readonly configService: ConfigService) {
    this.baseUrl = (
      this.configService.get<string>('AI_BASE_URL') ??
      'https://api.openai.com/v1'
    ).replace(/\/$/, '');
    this.apiKey = this.configService.get<string>('AI_API_KEY') ?? '';
    this.model = this.configService.get<string>('AI_MODEL') ?? 'gpt-4o-mini';
    this.timeoutMs = Number(this.configService.get('AI_TIMEOUT_MS', 120000));
    this.inputCostPerMillion = Number(
      this.configService.get('AI_INPUT_COST_PER_1M', 0),
    );
    this.outputCostPerMillion = Number(
      this.configService.get('AI_OUTPUT_COST_PER_1M', 0),
    );
  }

  async generate(request: AiProviderRequest): Promise<AiProviderResponse> {
    if (!this.apiKey) {
      throw new Error(
        'AI_API_KEY is required for the OpenAI-compatible provider',
      );
    }

    const startedAt = Date.now();
    const response = await axios.post<OpenAiResponse>(
      `${this.baseUrl}/chat/completions`,
      {
        model: this.model,
        temperature: 0,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: request.system },
          { role: 'user', content: request.prompt },
        ],
      },
      {
        timeout: this.timeoutMs,
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
      },
    );

    const text = response.data.choices?.[0]?.message?.content;
    if (!text) {
      throw new Error('AI provider returned an empty response');
    }

    const inputTokens = response.data.usage?.prompt_tokens ?? 0;
    const outputTokens = response.data.usage?.completion_tokens ?? 0;

    return {
      text,
      model: this.model,
      inputTokens,
      outputTokens,
      estimatedCostUsd:
        (inputTokens / 1_000_000) * this.inputCostPerMillion +
        (outputTokens / 1_000_000) * this.outputCostPerMillion,
      durationMs: Date.now() - startedAt,
    };
  }
}
