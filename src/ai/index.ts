import type { AppConfig } from '../server/config.ts';
import type { AiProvider } from './provider.ts';
import { AiNotConfiguredError } from './provider.ts';
import { GeminiProvider } from './gemini.ts';
import { OpenRouterProvider } from './openrouter.ts';

/** 설정에 맞는 AI 제공자를 만든다. 키가 없으면 AiNotConfiguredError. override로 제공자·모델을 바꿔 쓸 수 있다(모델 비교용) */
export function providerFromConfig(config: AppConfig, override: { provider?: string; model?: string } = {}): AiProvider {
  const provider = override.provider ?? config.ai.provider;
  const model = override.model ?? config.ai.model;
  if (provider === 'openrouter') {
    if (!config.ai.apiKey) throw new AiNotConfiguredError('OpenRouter API 키가 없습니다. config.local.json의 ai.apiKey에 넣어 주세요.');
    return new OpenRouterProvider(config.ai.apiKey, model || 'google/gemini-2.5-flash');
  }
  if (provider === 'gemini') {
    if (!config.ai.apiKey) throw new AiNotConfiguredError('Gemini API 키가 없습니다. config.local.json의 ai.apiKey에 결제가 연결된 키를 넣어 주세요.');
    return new GeminiProvider(config.ai.apiKey, model);
  }
  throw new AiNotConfiguredError(`지원하지 않는 AI 제공자입니다: ${provider}`);
}
