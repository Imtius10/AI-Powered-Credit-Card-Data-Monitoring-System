import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import type {
  AiProvider,
  AiProviderRequest,
  AiProviderResponse,
} from './ai-provider.interface';

interface OllamaResponse {
  response?: string;
  prompt_eval_count?: number;
  eval_count?: number;
}

class AsyncMutex {
  private queue: Array<() => void> = [];
  private locked = false;

  async acquire(): Promise<() => void> {
    if (!this.locked) {
      this.locked = true;
      return () => this.release();
    }
    return new Promise((resolve) => {
      this.queue.push(() => {
        this.locked = true;
        resolve(() => this.release());
      });
    });
  }

  private release(): void {
    const next = this.queue.shift();
    if (next) {
      next();
    } else {
      this.locked = false;
    }
  }
}

export class OllamaProvider implements AiProvider {
  readonly name = 'ollama';
  private readonly baseUrl: string;
  private readonly model: string;
  private readonly timeoutMs: number;
  private readonly mutex = new AsyncMutex();

  constructor(private readonly configService: ConfigService) {
    this.baseUrl = (
      this.configService.get<string>('OLLAMA_BASE_URL') ??
      this.configService.get<string>('AI_BASE_URL') ??
      'http://localhost:11434'
    ).replace(/\/$/, '');
    this.model =
      this.configService.get<string>('OLLAMA_MODEL') ??
      this.configService.get<string>('AI_MODEL') ??
      'qwen2.5-coder:3b';
    this.timeoutMs = Number(
      this.configService.get('OLLAMA_TIMEOUT') ??
        this.configService.get('AI_TIMEOUT_MS', 300000),
    );
  }

  async generate(request: AiProviderRequest): Promise<AiProviderResponse> {
    const release = await this.mutex.acquire();
    const startedAt = Date.now();

    try {
      const response = await axios.post<OllamaResponse>(
        `${this.baseUrl}/api/generate`,
        {
          model: this.model,
          prompt: `${request.system}\n\n${request.prompt}`,
          stream: false,
          format: 'json',
          keep_alive: '15m',
          options: {
            temperature: 0,
            num_predict: 1200,
          },
        },
        { timeout: this.timeoutMs },
      );

      const text = response.data.response;
      if (!text) {
        throw new Error('Ollama returned an empty response');
      }

      const outputTokens = response.data.eval_count ?? 0;

      return {
        text,
        model: this.model,
        inputTokens: response.data.prompt_eval_count ?? 0,
        outputTokens,
        estimatedCostUsd: 0,
        durationMs: Date.now() - startedAt,
      };
    } finally {
      release();
    }
  }
}
