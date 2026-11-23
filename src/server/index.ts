import { exec } from 'node:child_process';
import { loadConfig } from './config.ts';
import { createApp } from './app.ts';
import { logInfo, logError } from './logger.ts';

// 이 PC 안에서만 접속되도록 127.0.0.1에만 연다. 같은 망의 다른 PC에서는 접속할 수 없다.
const HOST = '127.0.0.1';

try {
  const { config, fromFile } = loadConfig();
  const app = createApp(config, fromFile);
  const server = app.listen(config.port, HOST, () => {
    logInfo(`실행 중입니다. Chrome 또는 Edge에서 http://localhost:${config.port} 을 여세요.`);
    logInfo('끝내려면 이 창에서 Ctrl+C를 누르거나 창을 닫으세요.');
    // Windows에서는 기본 브라우저로 화면을 자동으로 연다
    if (process.platform === 'win32' && !process.env.NO_BROWSER) exec(`start "" http://localhost:${config.port}`);
  });
  server.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`[사례비서] ${config.port}번 포트를 이미 쓰고 있습니다. 사례비서가 이미 켜져 있는지 확인하거나, config.local.json의 port 값을 바꾸세요.`);
    } else {
      logError('서버 시작', err);
    }
    process.exit(1);
  });
} catch (err) {
  logError('시작', err);
  if (err instanceof Error && err.message.startsWith('checkMark')) console.error(err.message);
  process.exit(1);
}
