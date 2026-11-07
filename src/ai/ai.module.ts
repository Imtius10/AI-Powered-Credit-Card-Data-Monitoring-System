import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AiService } from './ai.service';
import { AI_PROVIDER } from './providers/ai-provider.interface';
import { MockProvider } from './providers/mock.provider';
import { OllamaProvider } from './providers/ollama.provider';
import { OpenAiCompatibleProvider } from './providers/openai.provider';

@Module({
  providers: [
    AiService,
    {
      provide: AI_PROVIDER,
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        const configured = configService
          .get<string>('AI_PROVIDER', '')
          .toLowerCase();
        const provider =
          configured ||
          (configService.get<string>('AI_API_KEY') ? 'openai' : 'ollama');

        if (provider === 'mock') {
          return new MockProvider(configService);
        }

        if (provider === 'openai' || provider === 'openai-compatible') {
          return new OpenAiCompatibleProvider(configService);
        }

        return new OllamaProvider(configService);
      },
    },
  ],
  exports: [AiService],
})
export class AiModule {}
