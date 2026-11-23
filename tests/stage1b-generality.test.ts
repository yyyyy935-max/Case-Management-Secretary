import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { readForm } from '../src/forms/read.ts';
import { classifyForm, type CellRole } from '../src/forms/classify.ts';
import { formFingerprint } from '../src/forms/templates.ts';
import { createApp } from '../src/server/app.ts';
import { loadConfig } from '../src/server/config.ts';
import { VARIED_FORMS } from './fixtures/varied-forms.ts';
import { virtualDocx } from './fixtures/virtual-forms.ts';

const NEVER_AUTO: CellRole[] = ['judgment', 'signature', 'personal'];

for (const form of VARIED_FORMS) {
  test(`처음 보는 모양의 양식 ${form.name}: 판단·서명·인적사항 칸을 자동 기입 칸으로 넣지 않는다`, async () => {
    const doc = await readForm(await form.build());
    const cls = classifyForm(doc);
    const roles = new Map([...cls.cells, ...cls.body].map((c) => [c.id, c.role]));
    for (const [id, want] of Object.entries(form.danger)) {
      assert.ok(NEVER_AUTO.includes(roles.get(id)!), `${id}: ${roles.get(id)} (자동 기입 금지 칸이어야 함)`);
      assert.equal(roles.get(id), want, `${id} 역할`);
    }
    for (const [id, want] of Object.entries(form.fillable)) assert.equal(roles.get(id), want, `${id} 역할`);
  });
}

test('양식 템플릿: 같은 양식은 같은 지문, 고친 역할을 저장하면 다음 분석에 그대로 쓰인다', async () => {
  const bytes = await virtualDocx();
  assert.equal(formFingerprint(await readForm(bytes)), formFingerprint(await readForm(await virtualDocx())));
  const { config } = loadConfig('/없는/경로/config.local.json');
  const dataDir = mkdtempSync(join(tmpdir(), 'cms-data-'));
  const server = createApp(config, false, { dataDir }).listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  try {
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/forms`;
    const analyze = async () => (await fetch(`${base}/analyze`, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: Buffer.from(bytes) })).json();
    const first = await analyze();
    assert.equal(first.template, null);
    const cell = first.classification.cells.find((c: { id: string }) => c.id === 't0-r0-c3');
    assert.equal(cell.role, 'input');
    const put = await fetch(`${base}/templates/${first.fingerprint}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: '가상 회의록.docx', format: 'docx', overrides: { 't0-r0-c3': 'judgment', '../나쁜값': 'input', 't0-r1-c1': '없는역할' } }),
    });
    assert.equal(put.status, 200);
    assert.deepEqual((await put.json()).overrides, { 't0-r0-c3': 'judgment' }, '잘못된 칸 이름·역할은 저장하지 않음');
    const second = await analyze();
    const after = second.classification.cells.find((c: { id: string }) => c.id === 't0-r0-c3');
    assert.equal(after.role, 'judgment');
    assert.equal(after.source, 'template');
    assert.equal(after.ruleRole, 'input');
    const bad = await fetch(`${base}/templates/..%2F..%2Fetc`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'x', format: 'docx', overrides: {} }) });
    assert.equal(bad.status, 400, '지문 형식이 아니면 저장하지 않음');
  } finally {
    server.close();
  }
});

// 보건복지부 서식(공공누리 4유형)은 저장소에 넣지 않는다. 사용자 PC의 test-data에 있을 때만 확인한다.
const MOHW = 'test-data/forms/public/보건복지부_2025_희망복지지원단_서식모음.hwpx';
test('보건복지부 2025 서식모음: 제목 막대·작성 방법·작성 예시를 구분하고 위험 칸을 찾는다', { skip: !existsSync(MOHW) && 'test-data에 보건복지부 서식 파일이 없음' }, async () => {
  const doc = await readForm(new Uint8Array(readFileSync(MOHW)));
  const cls = classifyForm(doc);
  const roles = new Map(cls.cells.map((c) => [c.id, c.role]));
  const kinds = new Map(doc.tables.map((t) => [t.index, t.kind]));
  assert.equal(kinds.get(0), 'instructions');
  assert.equal(kinds.get(12), 'title');
  assert.equal(kinds.get(16), 'example');
  assert.equal(kinds.get(45), 'form', '자리 표시 값(◯◯◯)이 있어도 실제 양식');
  assert.ok(doc.tables.find((t) => t.index === 21)!.groupTitle!.startsWith('서식 6'));
  const expected: Record<string, CellRole> = {
    't14-r0-c3': 'personal', // 대상자명
    't21-r4-c1': 'personal', // 서비스 대상자 성명
    't21-r5-c1': 'personal', // 주소 (자택)
    't21-r0-c5': 'signature', // 담당자 (인)
    't25-r12-c4': 'judgment', // 종결심사 결과
    't25-r11-c4': 'judgment', // 종결심사 의견
    't39-r1-c2': 'judgment', // 만족도 응답
    't11-r19-c4': 'judgment', // 선정/미선정
    't32-r11-c3': 'judgment', // 긴급지원 필요 의견
    't31-r20-c10': 'personal', // 주변관계 성명
    't21-r3-c5': 'input', // 의뢰기관 연락처(기관 정보)
  };
  for (const [id, want] of Object.entries(expected)) assert.equal(roles.get(id), want, id);
});
