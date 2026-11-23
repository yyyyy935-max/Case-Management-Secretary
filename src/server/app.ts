import express from 'express';
import { readdirSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { AppConfig } from './config.ts';
import { ROOT_DIR } from './config.ts';
import { logError } from './logger.ts';

const TEST_DATA_DIR = resolve(ROOT_DIR, 'test-data');

function listFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => !f.startsWith('.'));
}

export function createApp(config: AppConfig, configFromFile: boolean) {
  const app = express();

  app.use(express.static(resolve(ROOT_DIR, 'public')));

  app.get('/api/status', (_req, res) => {
    const forms = listFiles(resolve(TEST_DATA_DIR, 'forms'));
    const cases = listFiles(resolve(TEST_DATA_DIR, 'cases'));
    res.json({
      app: '사례비서',
      version: '0.0.1',
      stage: 0,
      configFile: configFromFile ? '있음' : '없음 (기본값 사용)',
      checkMark: config.checkMark,
      ai: { provider: config.ai.provider, apiKeySet: config.ai.apiKey.length > 0 },
      testData: { forms, cases },
    });
  });

  app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    logError('요청 처리', err);
    res.status(500).json({ error: '처리 중 오류가 났습니다.' });
  });

  return app;
}
