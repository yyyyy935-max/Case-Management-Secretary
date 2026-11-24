import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import JSZip from 'jszip';
import { readForm } from '../src/forms/read.ts';
import { fillForm, type FillRequest } from '../src/forms/fill/index.ts';
import { verifyFill } from '../src/forms/fill/verify.ts';
import { createApp } from '../src/server/app.ts';
import { loadConfig } from '../src/server/config.ts';
import type { FormCell, FormDocument } from '../src/forms/types.ts';
import { virtualDocx, virtualGuideHwp, virtualHwpPair, virtualStyledHwpx } from './fixtures/virtual-forms.ts';

const req = (values: FillRequest['values'], source: FillRequest['source'] = 'human'): FillRequest => ({ values, checkMark: '☑', source });
const cellOf = (d: FormDocument, id: string): FormCell => d.tables.flatMap((t) => t.cells).find((c) => c.id === id)!;
const runs = (c: FormCell) => c.paragraphs.flatMap((p) => p.runs);
const plain = (c: FormCell) => runs(c).every((r) => (r.color ?? '#000000').toUpperCase() === '#000000' && !r.italic && !r.bold && !r.underline);

async function expectAllChecksPass(original: Uint8Array, values: FillRequest['values']) {
  const r = await fillForm(original, req(values));
  const checks = await verifyFill(original, r, req(values));
  for (const c of checks) assert.ok(c.ok, `${c.name}: ${c.detail}`);
  return r;
}

test('HWP: 안내 문구 칸은 일반 서식으로 쓰고 남는 문단을 지운다, 굵은 밑줄 빈칸도 일반 서식으로 쓴다', async () => {
  const original = await virtualGuideHwp();
  const values = {
    't0-r0-c1': { text: '가상인' },
    't0-r1-c1': { text: '가상 방문 내용 첫 줄\n둘째 줄' },
    't0-r2-c1': { check: ['전화'] },
    't0-r3-c1': { text: '가상 메모' },
  };
  const r = await expectAllChecksPass(original, values);
  assert.equal(r.format, 'hwp');
  assert.deepEqual(r.skipped, []);
  const after = await readForm(r.data);
  const guide = cellOf(after, 't0-r1-c1');
  assert.equal(guide.paragraphs.length, 2, '안내 문구 3줄이 2줄로 줄고 빈 줄이 남지 않음');
  assert.ok(plain(guide), '안내 문구의 회색 기울임이 남지 않음');
  assert.ok(plain(cellOf(after, 't0-r3-c1')), '굵은 밑줄 서식이 남지 않음');
  assert.equal(cellOf(after, 't0-r2-c1').text, '□ 방문 ☑ 전화');
  assert.equal(cellOf(after, 't0-r4-c1').text, '□ 선정 □ 미선정', '건드리지 않은 칸은 그대로');
  assert.ok(r.pages && r.pages.before === r.pages.after);
});

test('HWP: kordoc이 만든 표준 HWP에도 쓰고, 같은 내용의 HWPX와 결과 글이 같다', async () => {
  const { hwp, hwpx } = await virtualHwpPair();
  const values = { 't0-r2-c1': { text: '어머니' }, 't0-r3-c1': { check: ['미선정'] } };
  const a = await expectAllChecksPass(hwp, values);
  const b = await expectAllChecksPass(hwpx, values);
  assert.equal(a.format, 'hwp');
  assert.equal(b.format, 'hwpx');
  const ta = await readForm(a.data);
  const tb = await readForm(b.data);
  for (const id of Object.keys(values)) assert.equal(cellOf(ta, id).text, cellOf(tb, id).text, id);
});

test('HWPX: 안내 문구를 일반 서식으로 쓰고, 압축 안 파일 목록과 다른 칸은 그대로 둔다', async () => {
  const original = await virtualStyledHwpx();
  const values = { 't1-r2-c1': { text: '가상 상담 내용\n둘째 줄' }, 't1-r1-c1': { check: ['전화'] }, 't1-r4-c2': { text: '가상 가족' } };
  const r = await fillForm(original, req(values));
  assert.deepEqual(r.skipped, []);
  const checks = await verifyFill(original, r, req(values));
  // 최소 구성의 시험용 HWPX라 rhwp는 열지 못한다. 나머지 검사는 모두 통과해야 한다
  for (const c of checks.filter((c) => c.name !== '파일 열기')) assert.ok(c.ok, `${c.name}: ${c.detail}`);
  const after = await readForm(r.data);
  assert.ok(plain(cellOf(after, 't1-r2-c1')));
  assert.equal(cellOf(after, 't1-r2-c1').paragraphs.length, 2);
  assert.equal(cellOf(after, 't1-r1-c1').text, '□ 방문 ☑ 전화 □ 내방');
  const za = await JSZip.loadAsync(original);
  const zb = await JSZip.loadAsync(r.data);
  assert.deepEqual(Object.keys(zb.files).filter((n) => !zb.files[n]!.dir), Object.keys(za.files).filter((n) => !za.files[n]!.dir));
  const header = await zb.file('Contents/header.xml')!.async('string');
  assert.ok((header.match(/<hh:charPr /g) ?? []).length > 3, '일반 서식 글자 모양이 header에 추가됨');
});

test('DOCX: 안내 문구 서식(회색 기울임)을 지우고 쓰며, 다른 칸은 그대로 둔다', async () => {
  const original = await virtualDocx();
  const values = { 't0-r3-c1': { text: '가상 회의 내용' }, 't0-r0-c3': { text: '2026. 11. 20.' } };
  const r = await expectAllChecksPass(original, values);
  assert.equal(r.format, 'docx');
  const after = await readForm(r.data);
  assert.ok(plain(cellOf(after, 't0-r3-c1')));
  assert.equal(cellOf(after, 't0-r5-c1').text, '(서명 또는 인)');
});

test('채우기 계획: 항목명·없는 칸은 쓰지 않고, AI 값은 판단·서명·인적사항 칸에 쓰지 않는다', async () => {
  const original = await virtualGuideHwp();
  const human = await fillForm(original, req({ 't0-r0-c0': { text: '바꾸면 안 됨' }, 't9-r9-c9': { text: 'x' } }));
  assert.deepEqual(human.applied, []);
  assert.equal(human.skipped.length, 2);
  const ai = await fillForm(original, req({ 't0-r0-c1': { text: '가상인' }, 't0-r4-c1': { check: ['선정'] }, 't0-r3-c1': { text: '메모' } }, 'ai'));
  assert.deepEqual(ai.applied, ['t0-r3-c1']);
  assert.deepEqual(ai.skipped.map((s) => s.id).sort(), ['t0-r0-c1', 't0-r4-c1']);
  const after = await readForm(ai.data);
  assert.equal(cellOf(after, 't0-r0-c1').text, '');
  assert.equal(cellOf(after, 't0-r4-c1').text, '□ 선정 □ 미선정');
});

test('채우기 API: 원본 형식 파일과 검사 결과를 돌려준다', async () => {
  const { config } = loadConfig('/없는/경로/config.local.json');
  const server = createApp(config, false, { dataDir: '/tmp/cms-none' }).listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  try {
    const original = await virtualGuideHwp();
    const res = await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/api/forms/fill`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fileBase64: Buffer.from(original).toString('base64'), fileName: '방문기록.hwp', values: { 't0-r3-c1': { text: '가상 메모' } } }),
    });
    assert.equal(res.status, 200);
    const json = await res.json();
    assert.equal(json.fileName, '방문기록_채움.hwp');
    assert.equal(json.format, 'hwp');
    assert.ok(json.checks.every((c: { ok: boolean }) => c.ok));
    assert.equal(json.previews.length, 1);
    const back = await readForm(new Uint8Array(Buffer.from(json.fileBase64, 'base64')));
    assert.equal(cellOf(back, 't0-r3-c1').text, '가상 메모');
  } finally {
    server.close();
  }
});

const SEOUL = 'test-data/forms/서울표준_사례관리양식모음.hwp';
test('서울 표준 양식(HWP): 4.2 문제가 해결되고 9.2 검사를 통과한다', { skip: !existsSync(SEOUL) && 'test-data에 표준 양식 파일이 없음' }, async () => {
  const original = new Uint8Array(readFileSync(SEOUL));
  const values = {
    't7-r0-c1': { text: '2026.11.20. 14:00 ( 1 회차 )' },
    't7-r2-c1': { check: ['가정방문'] },
    't7-r6-c1': { check: ['1인가구'] }, // 한글 특수 선택 기호(󰋫)
    't7-r13-c0': { text: '가상 상담 내용 첫째 줄\n둘째 줄' }, // 13문단 회색 기울임 안내 문구
    't7-r14-c2': { text: '노인맞춤돌봄 이용 중' }, // 굵게·취소선 서식만 남은 빈칸
    't20-r0-c1': { text: '총 85 만원' }, // 밑줄 칸, 좁은 칸
  };
  const r = await expectAllChecksPass(original, values);
  const after = await readForm(r.data);
  const guide = cellOf(after, 't7-r13-c0');
  assert.equal(guide.paragraphs.length, 2);
  assert.ok(plain(guide));
  assert.ok(plain(cellOf(after, 't7-r14-c2')));
  assert.ok(cellOf(after, 't7-r6-c1').text.startsWith('☑1인가구 󰋫노인부부'));
  assert.ok(r.warnings.some((w) => w.id === 't20-r0-c1'), '좁은 칸 경고');
});

const MOHW = 'test-data/forms/public/보건복지부_2025_희망복지지원단_서식모음.hwpx';
test('보건복지부 서식(HWPX): 9.2 검사를 통과하고 압축 안 파일 목록이 같다', { skip: !existsSync(MOHW) && 'test-data에 보건복지부 서식 파일이 없음' }, async () => {
  const original = new Uint8Array(readFileSync(MOHW));
  const r = await expectAllChecksPass(original, { 't14-r4-c1': { text: '가상 회의 내용\n둘째 줄' }, 't21-r6-c1': { check: ['1인가구'] } });
  const za = await JSZip.loadAsync(original);
  const zb = await JSZip.loadAsync(r.data);
  assert.deepEqual(Object.keys(zb.files).filter((n) => !zb.files[n]!.dir), Object.keys(za.files).filter((n) => !za.files[n]!.dir));
});

const SOFFICE = ['/usr/bin/soffice', '/usr/local/bin/soffice'].find((p) => existsSync(p));
test('DOCX 결과를 LibreOffice로 열 수 있다 (설치된 곳에서만)', { skip: !SOFFICE && 'LibreOffice 없음', timeout: 180000 }, async () => {
  const { mkdtempSync, writeFileSync } = await import('node:fs');
  const { join } = await import('node:path');
  const { tmpdir } = await import('node:os');
  const { execFileSync } = await import('node:child_process');
  const r = await fillForm(await virtualDocx(), req({ 't0-r3-c1': { text: '가상 회의 내용' }, 't0-r1-c1': { text: '(총  3  명)' } }));
  const dir = mkdtempSync(join(tmpdir(), 'cms-lo-'));
  writeFileSync(join(dir, 'filled.docx'), r.data);
  execFileSync(SOFFICE!, ['--headless', '--convert-to', 'pdf', '--outdir', dir, join(dir, 'filled.docx')], { timeout: 170000, stdio: 'ignore' });
  assert.ok(existsSync(join(dir, 'filled.pdf')), 'LibreOffice가 PDF로 바꿈');
});
