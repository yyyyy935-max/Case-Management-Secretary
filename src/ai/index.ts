import type { AppConfig } from '../server/config.ts';
import type { AiProvider } from './provider.ts';
import { AiNotConfiguredError } from './provider.ts';
import { GeminiProvider } from './gemini.ts';

/** 설정에 맞는 AI 제공자를 만든다. 키가 없으면 AiNotConfiguredError */
export function providerFromConfig(config: AppConfig): AiProvider {
  if (config.ai.provider === 'gemini') {
    if (!config.ai.apiKey) throw new AiNotConfiguredError('Gemini API 키가 없습니다. config.local.json의 ai.apiKey에 결제가 연결된 키를 넣어 주세요.');
    return new GeminiProvider(config.ai.apiKey, config.ai.model);
  }
  throw new AiNotConfiguredError(`지원하지 않는 AI 제공자입니다: ${config.ai.provider}`);
}
