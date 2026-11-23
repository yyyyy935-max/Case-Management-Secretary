import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

export type CheckMark = '■' | '☑' | 'V';

export interface AppConfig {
  port: number;
  checkMark: CheckMark;
  ai: { provider: 'gemini'; model: string; apiKey: string };
  publicDataApiKey: string;
}

export const ROOT_DIR = resolve(import.meta.dirname, '..', '..');
export const CONFIG_PATH = resolve(ROOT_DIR, 'config.local.json');

const DEFAULTS: AppConfig = {
  port: 4870,
  checkMark: '☑',
  ai: { provider: 'gemini', model: '', apiKey: '' },
  publicDataApiKey: '',
};

/** config.local.json을 읽는다. 없으면 기본값을 쓴다. API 키는 이 파일에만 둔다. */
export function loadConfig(path: string = CONFIG_PATH): { config: AppConfig; fromFile: boolean } {
  if (!existsSync(path)) return { config: structuredClone(DEFAULTS), fromFile: false };
  const raw = JSON.parse(readFileSync(path, 'utf8')) as Partial<AppConfig>;
  const config: AppConfig = {
    ...DEFAULTS,
    ...raw,
    ai: { ...DEFAULTS.ai, ...(raw.ai ?? {}) },
  };
  if (!['■', '☑', 'V'].includes(config.checkMark)) {
    throw new Error(`checkMark 값은 ■, ☑, V 중 하나여야 합니다. 현재 값: ${config.checkMark}`);
  }
  return { config, fromFile: true };
}
