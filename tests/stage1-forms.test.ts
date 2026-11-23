import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { readForm, UnsupportedFormError } from '../src/forms/read.ts';
import { classifyForm, type CellRole } from '../src/forms/classify.ts';
import type { FormDocument } from '../src/forms/types.ts';
import { createApp } from '../src/server/app.ts';
import { loadConfig } from '../src/server/config.ts';
import { virtualDocx, virtualHwpPair, virtualStyledHwpx } from './fixtures/virtual-forms.ts';

function roleMap(doc: FormDocument) {
  const cls = classifyForm(doc);
  return new Map<string, CellRole>([...cls.cells, ...cls.body].map((c) => [c.id, c.role]));
}

function expectRoles(roles: Map<string, CellRole>, expected: Record<string, CellRole>) {
  for (const [id, role] of Object.entries(expected)) assert.equal(roles.get(id), role, `${id} 칸`);
}

test('HWPX: 표 구조(병합, 셀 안 표)와 글자 서식을 읽는다', async () => {
  const doc = await readForm(await virtualStyledHwpx());
  assert.equal(doc.format, 'hwpx');
  assert.equal(doc.tables.length, 3);
  const main = doc.tables[1]!;
  assert.equal(main.groupTitle, '[서식1] 가상 상담 기록지');
  const family = main.cells.find((c) => c.id === 't1-r3-c0')!;
  assert.equal(family.rowSpan, 3);
  assert.equal(family.fillColor, '#D8D8D8');
  const guide = main.cells.find((c) => c.id === 't1-r2-c1')!;
  assert.equal(guide.paragraphs[0]!.runs[0]!.italic, true);
  assert.equal(guide.paragraphs[0]!.runs[0]!.color, '#999999');
  assert.equal(doc.tables[2]!.parentCellId, 't1-r6-c1');
  assert.deepEqual(main.cells.find((c) => c.id === 't1-r6-c1')!.nestedTableIndexes, [2]);
});

test('HWPX: 칸 역할 8가지를 규칙대로 나눈다', async () => {
  const roles = roleMap(await readForm(await virtualStyledHwpx()));
  expectRoles(roles, {
    't1-r0-c0': 'label',
    't1-r0-c1': 'personal', // 성명
    't1-r0-c4': 'personal', // 연락처
    't1-r1-c1': 'checkbox_group',
    't1-r2-c1': 'guide', // 회색 기울임 안내 문구
    't1-r4-c1': 'input', // 가족 관계
    't1-r4-c2': 'personal', // 가족 이름
    't1-r6-c1': 'fixed', // 안쪽 표를 담은 칸
    't2-r0-c1': 'checkbox_group', // 안쪽 표의 선택지
    't1-r7-c1': 'judgment', // 0 1 2 3 점수 고르기
    't1-r8-c1': 'judgment', // 선정 여부
    't1-r9-c1': 'signature', // 동의 체크
    't0-r2-c1': 'signature', // (서명)
    't0-r1-c0': 'fixed', // 세로 테두리 없는 간격 줄
    p2: 'signature', // 본문 동의 체크
  });
  assert.equal(roles.get('t0-r0-c1'), 'input');
});

test('HWP 5.x: 같은 내용의 HWPX와 똑같은 구조·역할로 읽는다', async () => {
  const { hwpx, hwp } = await virtualHwpPair();
  const a = await readForm(hwpx);
  const b = await readForm(hwp);
  assert.equal(b.format, 'hwp');
  const shape = (d: FormDocument) => d.tables.map((t) => ({ rows: t.rows, cols: t.cols, cells: t.cells.map((c) => [c.id, c.rowSpan, c.colSpan, c.text]) }));
  assert.deepEqual(shape(b), shape(a));
  assert.deepEqual([...roleMap(b)], [...roleMap(a)]);
  expectRoles(roleMap(b), { 't0-r0-c1': 'personal', 't0-r2-c1': 'input', 't0-r2-c2': 'personal', 't0-r3-c1': 'judgment' });
});

test('DOCX: 가로·세로 병합, 배경색, 서식을 읽고 역할을 나눈다', async () => {
  const doc = await readForm(await virtualDocx());
  assert.equal(doc.format, 'docx');
  const t = doc.tables[0]!;
  assert.equal(t.cells.find((c) => c.id === 't0-r1-c0')!.rowSpan, 2);
  assert.equal(t.cells.find((c) => c.id === 't0-r1-c1')!.colSpan, 3);
  assert.equal(t.cells.find((c) => c.id === 't0-r0-c0')!.fillColor, '#D9D9D9');
  expectRoles(roleMap(doc), {
    't0-r0-c1': 'personal',
    't0-r0-c3': 'input',
    't0-r1-c1': 'input', // (총    명)
    't0-r3-c1': 'guide',
    't0-r4-c1': 'judgment', // 우선순위
    't0-r5-c1': 'signature',
  });
});

test('지원하지 않는 형식은 이유를 알려 준다', async () => {
  await assert.rejects(readForm(new TextEncoder().encode('%PDF-1.7 ...')), UnsupportedFormError);
  await assert.rejects(readForm(new TextEncoder().encode('그냥 글')), UnsupportedFormError);
});

test('양식 분석 API: 파일을 받아 분석 결과를 돌려준다', async () => {
  const { config } = loadConfig('/없는/경로/config.local.json');
  const server = createApp(config, false).listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  try {
    const { port } = server.address() as AddressInfo;
    const url = `http://127.0.0.1:${port}/api/forms/analyze`;
    const ok = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: Buffer.from(await virtualDocx()) });
    assert.equal(ok.status, 200);
    const json = await ok.json();
    assert.equal(json.document.format, 'docx');
    assert.ok(json.classification.cells.length > 0);
    const bad = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: '%PDF-1.7' });
    assert.equal(bad.status, 415);
  } finally {
    server.close();
  }
});

// 서울 표준 양식은 협회 저작물이라 저장소에 넣지 않는다. 사용자 PC의 test-data에 있을 때만 확인한다.
const STANDARD = 'test-data/forms/서울표준_사례관리양식모음.hwp';
test('서울 표준 양식 13종: 판단·서명·인적사항 칸을 정확히 찾는다', { skip: !existsSync(STANDARD) && 'test-data에 표준 양식 파일이 없음' }, async () => {
  const doc = await readForm(new Uint8Array(readFileSync(STANDARD)));
  assert.equal(doc.format, 'hwp');
  assert.equal(new Set(doc.tables.map((t) => t.groupTitle)).size, 13);
  expectRoles(roleMap(doc), {
    't7-r3-c1': 'personal', // 인테이크 성명
    't7-r13-c0': 'guide', // 인테이크 욕구내용 안내 문구
    't7-r15-c2': 'judgment', // 사례관리 여력
    't7-r15-c11': 'signature', // 클라이언트 동의 여부
    't7-r17-c2': 'judgment', // 면접결과 선정
    't9-r1-c2': 'judgment', // 욕구수준 0
    't9-r1-c6': 'judgment', // 우선순위
    't11-r2-c1': 'judgment', // 2순위 욕구영역
    't11-r5-c2': 'judgment', // 사례관리 수준
    't30-r1-c0': 'fixed', // 계획서 간격 줄
    't30-r4-c7': 'input', // 클라이언트 담당 역할
    't6-r0-c1': 'signature', // (서명 또는 인)
    't40-r1-c1': 'judgment', // 만족도 점수
    p48: 'signature', // 계약서 서명
  });
});
