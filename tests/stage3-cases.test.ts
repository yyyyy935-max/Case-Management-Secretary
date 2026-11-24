import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { verifyFacts, wordSupport } from '../src/cases/verify.ts';
import { CaseStore, addRecord } from '../src/cases/store.ts';
import { EXTRACT_SYSTEM, extractFacts } from '../src/cases/extract.ts';
import { FakeProvider } from '../src/ai/fake.ts';
import { GeminiProvider } from '../src/ai/gemini.ts';
import { createApp } from '../src/server/app.ts';
import { loadConfig } from '../src/server/config.ts';
import type { Case } from '../src/cases/types.ts';
import { VIRTUAL_CASES } from './fixtures/virtual-cases.ts';

const tmpStore = () => new CaseStore(mkdtempSync(join(tmpdir(), 'cms-cases-')));
const fact = (o: Record<string, unknown>) => ({ category: 'need', key: 'economy', speaker: 'client', ...o });

function caseWith(text: string): { c: Case; recordId: string } {
  const c = tmpStore().create('가상 시험');
  const r = addRecord(c, { date: '2026-11-16', type: '방문', rawText: text });
  return { c, recordId: r.id };
}

test('걸러내기: 근거가 원문에 없거나, 숫자가 다르거나, 의견이거나, 없는 항목이면 뺀다', () => {
  const { c, recordId } = caseWith('할머니(81) 혼자 사심. 월세 25만원 두 달 밀림. 무릎 아파서 장보기 힘들다 하심. 담당자 생각: 우울해 보임.');
  const record = c.records[0]!;
  const r = verifyFacts({ facts: [
    fact({ value: '월세 25만원 2개월 체납', evidence: '월세 25만원 두 달 밀림' }), // 통과 (두 달 = 2)
    fact({ category: 'general', key: 'householdType', value: '1인가구', evidence: '할머니(81) 혼자 사심' }), // 통과 (선택지 값)
    fact({ key: 'health', value: '무릎 통증으로 장보기 어려움', evidence: '무릎 아파서 장보기 힘들다 하심' }), // 통과
    fact({ key: 'health', value: '고혈압 있음', evidence: '고혈압이 있다고 함' }), // 근거 지어냄
    fact({ value: '월세 30만원 체납', evidence: '월세 25만원 두 달 밀림' }), // 숫자 다름
    fact({ key: 'health', value: '무릎 골절', evidence: '무릎 아파서 장보기 힘들다 하심' }), // 근거와 다른 내용
    fact({ key: 'psychological', value: '우울해 보임', evidence: '우울해 보임', speaker: 'worker_opinion' }), // 의견
    fact({ category: 'general', key: 'householdType', value: '독거노인', evidence: '혼자 사심' }), // 선택지에 없음
    fact({ category: 'general', key: 'householdType', value: '노인부부', evidence: '월세 25만원 두 달 밀림' }), // 근거가 선택지를 뒷받침하지 않음
    fact({ category: 'need', key: 'needLevel', value: '월세 밀림', evidence: '월세 25만원 두 달 밀림' }), // 없는 항목(판단)
    fact({ category: 'person', key: 'age', relation: '손자', value: '81세', evidence: '할머니(81) 혼자 사심' }), // 관계가 기록에 없음
  ] }, record, c);
  assert.equal(r.accepted.length, 3, r.rejected.map((x) => x.reason).join(' / '));
  const reasons = r.rejected.map((x) => x.reason);
  assert.ok(reasons.some((x) => x.includes('지어낸 근거')));
  assert.ok(reasons.some((x) => x.includes('숫자(30)')));
  assert.ok(reasons.some((x) => x.includes('진단·민감한 말(골절)')));
  assert.ok(reasons.some((x) => x.includes('담당자 의견')));
  assert.ok(reasons.some((x) => x.includes('선택지에 없는 값')));
  assert.ok(reasons.some((x) => x.includes('뒷받침하는 말이 없음')));
  assert.ok(reasons.some((x) => x.includes('없는 욕구 영역')));
  assert.ok(reasons.some((x) => x.includes('관계')));
  void recordId;
});

test('걸러내기: 이미 있는 값은 다시 내지 않고, 확인된 값과 다르면 둘 다 보여 준다', () => {
  const { c } = caseWith('혼자 사심. 기초연금 받고 계심.');
  c.general.householdType = { value: '노인부부', sourceRecordIds: [], status: 'confirmed', updatedAt: '' };
  c.needs.economy = [{ value: '기초연금 받음', sourceRecordIds: [], status: 'confirmed', updatedAt: '' }];
  const r = verifyFacts({ facts: [
    fact({ category: 'general', key: 'householdType', value: '1인가구', evidence: '혼자 사심' }),
    fact({ value: '기초연금 받음', evidence: '기초연금 받고 계심' }),
  ] }, c.records[0]!, c);
  assert.equal(r.accepted.length, 1);
  assert.equal(r.accepted[0]!.conflictWith, '노인부부');
  assert.ok(r.rejected[0]!.reason.includes('이미 있는 값'));
});

test('낱말 근거 점검: 같은 뜻으로 바꾼 말은 통과, 다른 내용은 걸림', () => {
  assert.ok(wordSupport('아들과 5년간 연락 없음', '아들 있는데 연락 안 한 지 5년') >= 0.5);
  assert.ok(wordSupport('치매가 의심됨', '할머니가 같은 질문을 여러 번 하심') < 0.5);
});

test('가상 사례 10개: 지어낸 답을 섞는 가짜 AI의 지어낸 사실은 하나도 통과하지 못한다', async () => {
  for (const vc of VIRTUAL_CASES) {
    const c = tmpStore().create(vc.title);
    for (const rec of vc.records) {
      const r = addRecord(c, rec);
      const first = rec.rawText.split(/(?<=[.])\s+/)[0]!;
      const fake = new FakeProvider([JSON.stringify({ facts: [
        ...vc.forbid.map((w) => fact({ key: 'health', value: `${w} 있음`, evidence: `${w}이 있다고 함` })),
        ...vc.forbid.map((w) => fact({ key: 'health', value: `${w} 있음`, evidence: first })),
        fact({ value: '빚 7777만원', evidence: first }),
        fact({ key: 'psychological', value: first, evidence: first, speaker: 'worker_opinion' }),
      ] })]);
      const result = await extractFacts(fake, c, r.id);
      assert.equal(result.accepted.length, 0, `${vc.title}: ${result.accepted.map((a) => a.value).join(', ')}`);
    }
  }
});

test('사실 뽑기 지침에 핵심 규칙이 들어 있다', () => {
  for (const w of ['기록에 적힌 것만', '글자 그대로 복사', '의견·추측', '진단을 짐작하지', '판단은 내지 않는다', '꼬리표']) assert.ok(EXTRACT_SYSTEM.includes(w), w);
});

test('Gemini 연결: 키는 머리글로 보내고, flash 모델을 고르고, 오류를 알기 쉽게 알린다', async () => {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fakeFetch = (async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    if (url.includes('/models?')) {
      return new Response(JSON.stringify({ models: [
        { name: 'models/gemini-9-flash-preview', supportedGenerationMethods: ['generateContent'] },
        { name: 'models/gemini-9-flash', supportedGenerationMethods: ['generateContent'] },
        { name: 'models/gemini-9-flash-lite', supportedGenerationMethods: ['generateContent'] },
        { name: 'models/gemini-9-pro', supportedGenerationMethods: ['generateContent'] },
        { name: 'models/text-embedding', supportedGenerationMethods: ['embedContent'] },
      ] }));
    }
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: '{"facts":[]}' }] } }] }));
  }) as unknown as typeof fetch;
  const g = new GeminiProvider('TEST-KEY', '', fakeFetch);
  assert.equal(await g.generate({ system: 's', prompt: 'p', responseSchema: { type: 'OBJECT' } }), '{"facts":[]}');
  assert.ok(calls[1]!.url.includes('/models/gemini-9-flash:generateContent'));
  assert.ok(!calls.some((c) => c.url.includes('TEST-KEY')), '키를 주소에 넣지 않음');
  assert.equal((calls[1]!.init!.headers as Record<string, string>)['x-goog-api-key'], 'TEST-KEY');
  const body = JSON.parse(String(calls[1]!.init!.body));
  assert.equal(body.generationConfig.responseMimeType, 'application/json');
  assert.equal(body.generationConfig.temperature, 0);
  const bad = new GeminiProvider('K', 'm', (async () => new Response('', { status: 403 })) as unknown as typeof fetch);
  await assert.rejects(bad.generate({ system: '', prompt: '' }), /API 키 또는 권한/);
});

test('사례 API: 기록 추가 → 사실 뽑기(가짜 AI) → 승인·거절, 키가 없으면 안내', async () => {
  const { config } = loadConfig('/없는/경로/config.local.json');
  const dataDir = mkdtempSync(join(tmpdir(), 'cms-data-'));
  const fake = new FakeProvider([JSON.stringify({ facts: [
    fact({ value: '월세 25만원 2개월 체납', evidence: '월세 25만원 두 달 밀림' }),
    fact({ category: 'person', key: 'contactFrequency', relation: '아들', value: '아들과 5년간 연락 없음', evidence: '아들 있는데 연락 안 한 지 5년', speaker: 'client' }),
    fact({ key: 'health', value: '관절염', evidence: '관절염 진단' }),
  ] })]);
  const withAi = createApp(config, false, { dataDir, ai: fake }).listen(0, '127.0.0.1');
  const noAi = createApp(config, false, { dataDir }).listen(0, '127.0.0.1');
  await Promise.all([new Promise((r) => withAi.once('listening', r)), new Promise((r) => noAi.once('listening', r))]);
  try {
    const base = `http://127.0.0.1:${(withAi.address() as AddressInfo).port}/api/cases`;
    const post = (url: string, body: unknown) => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const c = await (await post(base, { title: '가상01' })).json();
    const added = await (await post(`${base}/${c.id}/records`, { date: '2026-10-19', type: '방문', rawText: '2차 방문. 월세 25만원 두 달 밀림. 아들 있는데 연락 안 한 지 5년.' })).json();
    const ex = await (await post(`${base}/${c.id}/records/${added.record.id}/extract`, {})).json();
    assert.equal(ex.accepted, 2);
    assert.equal(ex.rejected.length, 1);
    const [s1, s2] = ex.case.suggestions;
    let after = await (await post(`${base}/${c.id}/suggestions/${s1.id}`, { action: 'approve', value: '월세 25만원 2개월 밀림(집주인이 기다려 줌)' })).json();
    assert.equal(after.needs.economy[0].value, '월세 25만원 2개월 밀림(집주인이 기다려 줌)');
    assert.equal(after.needs.economy[0].status, 'confirmed');
    assert.deepEqual(after.needs.economy[0].sourceRecordIds, [added.record.id]);
    after = await (await post(`${base}/${c.id}/suggestions/${s2.id}`, { action: 'approve' })).json();
    assert.equal(after.people.find((p: { relation: string }) => p.relation === '아들').attrs.contactFrequency.value, '아들과 5년간 연락 없음');
    assert.equal(after.suggestions.length, 0);
    // 키가 없을 때
    const base2 = `http://127.0.0.1:${(noAi.address() as AddressInfo).port}/api/cases`;
    const res = await post(`${base2}/${c.id}/records/${added.record.id}/extract`, {});
    assert.equal(res.status, 409);
    assert.match((await res.json()).error, /API 키/);
  } finally {
    withAi.close();
    noAi.close();
  }
});

test('저장: 사례는 data/cases 의 파일로 남고 다시 읽힌다, 잘못된 id는 거부', () => {
  const store = tmpStore();
  const c = store.create('가상 저장');
  addRecord(c, { date: '2026-11-01', type: '전화', rawText: '가상 통화 기록' });
  store.save(c);
  assert.equal(store.get(c.id)!.records.length, 1);
  assert.equal(store.list()[0]!.records, 1);
  assert.throws(() => store.get('../../etc/passwd'));
  assert.throws(() => addRecord(c, { date: '11월 1일', type: '전화', rawText: 'x' }));
});
