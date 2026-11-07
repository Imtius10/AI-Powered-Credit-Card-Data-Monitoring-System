export type AiTask = 'extract' | 'verify';

export interface AiProviderRequest {
  task: AiTask;
  cardSlug: string;
  system: string;
  prompt: string;
}

export interface AiProviderResponse {
  text: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  estimatedCostUsd: number;
  durationMs: number;
}

export interface AiProvider {
  readonly name: string;
  generate(request: AiProviderRequest): Promise<AiProviderResponse>;
}

export const AI_PROVIDER = Symbol('AI_PROVIDER');
