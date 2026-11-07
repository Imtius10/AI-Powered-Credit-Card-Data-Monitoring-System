import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  CARD_FIELDS,
  type AiUsage,
  type AiVerification,
  type CardExtraction,
  type CardSource,
} from '../cards/card.types';
import { focusCardContent } from '../common/content-focuser';
import {
  cardVerificationSchema,
  parseExtractionJson,
  parseJsonObject,
} from './ai.schemas';
import {
  AI_SYSTEM_PROMPT,
  AI_VERIFICATION_SYSTEM_PROMPT,
  buildExtractionPrompt,
  buildVerificationPrompt,
} from './prompts';
import {
  AI_PROVIDER,
  type AiProvider,
  type AiProviderResponse,
} from './providers/ai-provider.interface';

export interface ExtractionResult {
  data: CardExtraction;
  usage: AiUsage;
}

export interface VerificationResult {
  data: AiVerification;
  usage: AiUsage;
}

@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);
  private readonly maxContentChars: number;

  constructor(
    @Inject(AI_PROVIDER) private readonly provider: AiProvider,
    private readonly configService: ConfigService,
  ) {
    this.maxContentChars = Number(
      this.configService.get('AI_MAX_CONTENT_CHARS', 3500),
    );
  }

  async extractCardData(
    card: Pick<CardSource, 'slug' | 'name' | 'issuer' | 'sourceUrl'>,
    content: string,
  ): Promise<ExtractionResult> {
    const focusedContent = focusCardContent(content, card.name, card.slug, {
      maxChars: this.maxContentChars,
    });

    const response = await this.provider.generate({
      task: 'extract',
      cardSlug: card.slug,
      system: AI_SYSTEM_PROMPT,
      prompt: buildExtractionPrompt(card, focusedContent),
    });

    try {
      const data = parseExtractionJson(response.text);
      const usage = this.toUsage(response);

      this.logger.log(
        `Extracted ${card.name} with ${this.provider.name} in ${usage.durationMs}ms (${usage.inputTokens} input / ${usage.outputTokens} output tokens)`,
      );

      return { data, usage };
    } catch (err) {
      this.logger.warn(
        `Failed to parse extraction JSON for ${card.slug}. Raw AI output: ${response.text.slice(0, 300)}...`,
      );
      throw err;
    }
  }

  async verifyCardData(
    card: Pick<CardSource, 'slug' | 'name' | 'issuer' | 'sourceUrl'>,
    content: string,
    extraction: CardExtraction,
  ): Promise<VerificationResult> {
    const focusedContent = focusCardContent(content, card.name, card.slug, {
      maxChars: this.maxContentChars,
    });

    const response = await this.provider.generate({
      task: 'verify',
      cardSlug: card.slug,
      system: AI_VERIFICATION_SYSTEM_PROMPT,
      prompt: buildVerificationPrompt(card, focusedContent, extraction),
    });

    try {
      const parsed = parseJsonObject(response.text);
      const data = cardVerificationSchema.parse(parsed);
      const usage = this.toUsage(response);

      this.logger.log(
        `Verified ${card.name} with ${this.provider.name} in ${usage.durationMs}ms (${data.overallStatus})`,
      );

      return { data, usage };
    } catch (err) {
      this.logger.warn(
        `Failed to parse verification JSON for ${card.slug}. Raw AI output: ${response.text.slice(0, 300)}...`,
      );
      throw err;
    }
  }

  buildDeterministicVerification(
    _card: Pick<CardSource, 'slug' | 'name' | 'issuer' | 'sourceUrl'>,
    content: string,
    extraction: CardExtraction,
  ): VerificationResult {
    const normalizedContent = content.toLowerCase();
    const fields = CARD_FIELDS.map((field) => {
      const value = extraction[field];
      const evidence = extraction.evidence[field] ?? null;

      if (value === null) {
        return {
          field,
          value: null,
          evidence: null,
          status: 'missing' as const,
          reason: null,
        };
      }

      if (
        !evidence ||
        !normalizedContent.includes(evidence.toLowerCase().trim())
      ) {
        return {
          field,
          value,
          evidence,
          status: 'unverified' as const,
          reason: 'Evidence snippet not found in source text',
        };
      }

      return {
        field,
        value,
        evidence,
        status: 'verified' as const,
        reason: null,
      };
    });

    const nonNullFields = fields.filter((f) => f.value !== null);
    const allVerified =
      nonNullFields.length >= 4 &&
      nonNullFields.every((f) => f.status === 'verified');

    return {
      data: {
        overallStatus: allVerified ? 'verified' : 'needs_review',
        fields,
        notes: allVerified
          ? 'Automated quote-matching verification confirmed all evidence in source content.'
          : 'Some extracted values lacked exact verbatim quotes in source content.',
      },
      usage: {
        provider: 'deterministic-verifier',
        model: 'source-quote-matcher',
        inputTokens: 0,
        outputTokens: 0,
        estimatedCostUsd: 0,
        durationMs: 1,
      },
    };
  }

  private toUsage(response: AiProviderResponse): AiUsage {
    return {
      provider: this.provider.name,
      model: response.model,
      inputTokens: response.inputTokens,
      outputTokens: response.outputTokens,
      estimatedCostUsd: response.estimatedCostUsd,
      durationMs: response.durationMs,
    };
  }
}
