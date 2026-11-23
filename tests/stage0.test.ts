import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { createApp } from '../src/server/app.ts';
import { loadConfig } from '../src/server/config.ts';

test('설정 파일이 없으면 기본값(체크 기호 ☑, Gemini)을 쓴다', () => {
  const { config, fromFile } = loadConfig('/없는/경로/config.local.json');
  assert.equal(fromFile, false);
  assert.equal(config.checkMark, '☑');
  assert.equal(config.ai.provider, 'gemini');
});

test('체크 기호가 ■, ☑, V가 아니면 시작하지 않는다', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cms-'));
  const p = join(dir, 'config.local.json');
  writeFileSync(p, JSON.stringify({ checkMark: 'O' }));
  assert.throws(() => loadConfig(p), /checkMark/);
});

test('상태 화면 API는 API 키 값을 내보내지 않는다', async () => {
  const { config } = loadConfig('/없는/경로/config.local.json');
  config.ai.apiKey = 'SECRET-KEY-VALUE';
  const server = createApp(config, true).listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  try {
    const { port } = server.address() as AddressInfo;
    const res = await fetch(`http://127.0.0.1:${port}/api/status`);
    const text = await res.text();
    assert.equal(res.status, 200);
    assert.ok(!text.includes('SECRET-KEY-VALUE'));
    assert.equal(JSON.parse(text).ai.apiKeySet, true);
    const page = await fetch(`http://127.0.0.1:${port}/`);
    assert.match(await page.text(), /사례비서/);
  } finally {
    server.close();
  }
});

test('시작.bat은 Windows 줄바꿈(CRLF)이고 UTF-8이 아닌 한글 Windows 기본 인코딩이다', async () => {
  const { readFileSync } = await import('node:fs');
  const bytes = readFileSync(new URL('../시작.bat', import.meta.url));
  const text = bytes.toString('latin1');
  assert.equal(text.split('\n').length, text.split('\r\n').length, 'LF만 있는 줄이 있음');
  const utf8 = new TextDecoder('utf-8', { fatal: true });
  assert.throws(() => utf8.decode(bytes), '한글이 UTF-8로 저장되어 있음');
  const cp949 = new TextDecoder('euc-kr').decode(bytes);
  assert.match(cp949, /Node\.js가 설치되어 있지 않습니다/);
});
