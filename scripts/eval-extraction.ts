/**
 * 3단계 통과 기준 확인: 가상 사례 10개에서 AI 사실 뽑기를 돌려 "기록에 없는 사실"을 센다.
 * 사용법:
 *   npm run eval:extract              config.local.json의 Gemini 키로 실행
 *   npm run eval:extract -- --fake    키 없이, 일부러 지어낸 답을 섞는 가짜 AI로 걸러내기만 시험
 *   npm run eval:extract -- --provider openrouter --model google/gemini-2.5-flash   제공자·모델을 바꿔 비교
 *   (--key-from-proxy: 키를 개발 서버의 보안 프록시가 넣어 줄 때. 설정 파일에는 키가 없어도 됨)
 * 결과 표는 test-data/reports/3단계_사실뽑기_평가.md 에 저장한다.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { VIRTUAL_CASES, type VirtualCase } from '../tests/fixtures/virtual-cases.ts';
import { addRecord, approveSuggestion } from '../src/cases/store.ts';
import { extractFacts, mergeExtraction } from '../src/cases/extract.ts';
import { squash } from '../src/cases/verify.ts';
import type { Case } from '../src/cases/types.ts';
import type { AiProvider } from '../src/ai/provider.ts';
import { FakeProvider } from '../src/ai/fake.ts';
import { providerFromConfig } from '../src/ai/index.ts';
import { loadConfig } from '../src/server/config.ts';

const useFake = process.argv.includes('--fake');
const arg = (name: string) => { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : undefined; };
const override = { provider: arg('--provider'), model: arg('--model') };

function emptyCase(title: string): Case {
  const now = new Date().toISOString();
  return { id: '00000000-0000-0000-0000-000000000000', title, createdAt: now, updatedAt: now, records: [], general: {}, people: [{ id: 'p0', relation: '본인', isClient: true, attrs: {} }], needs: {}, services: [], suggestions: [], rejected: [] };
}

/** 가짜 AI: 기록 첫 문장으로 맞는 사실 하나, 그리고 금지어·없는 숫자로 지어낸 사실을 섞어 낸다 */
function hallucinatingFake(vc: VirtualCase): AiProvider {
  return new FakeProvider(vc.records.map((r) => () => {
    const first = r.rawText.split(/(?<=[.。])\s+/)[0]!;
    return JSON.stringify({ facts: [
      { category: 'need', key: 'economy', value: first.slice(0, 60), evidence: first, speaker: 'client' },
      ...vc.forbid.slice(0, 2).map((w) => ({ category: 'need', key: 'health', value: `${w} 있음`, evidence: `${w}이 있다고 함`, speaker: 'client' })),
      { category: 'need', key: 'economy', value: '월세 99만원 체납', evidence: first, speaker: 'client' },
      { category: 'need', key: 'health', value: '우울해 보임', evidence: first, speaker: 'worker_opinion' },
    ] });
  }));
}

const lines: string[] = [];
const totals = { candidates: 0, accepted: 0, rejected: 0, violations: 0, expect: 0, found: 0, foundAny: 0 };
/** 기준 단어: "다툼|다투"처럼 | 로 다른 표현을 허용 */
const hasWord = (value: string, w: string) => w.split('|').some((alt) => squash(value).includes(squash(alt)));
lines.push(`# 3단계 사실 뽑기 평가 (${useFake ? '가짜 AI' : 'Gemini'})`, '', `- 실행: ${new Date().toISOString()}`, '');
const config = loadConfig().config;
if (process.argv.includes('--key-from-proxy') && !config.ai.apiKey) config.ai.apiKey = 'key-from-proxy';
const real = useFake ? undefined : providerFromConfig(config, override);
if (real) lines.splice(2, 0, `- 제공자·모델: ${real.name} / ${real.model ?? '(자동 선택)'}`);

for (const vc of VIRTUAL_CASES) {
  const provider = useFake ? hallucinatingFake(vc) : real!;
  const c = emptyCase(vc.title);
  const accepted: { value: string; evidence: string; target: string; speaker: string }[] = [];
  const rejected: { reason: string; raw: unknown }[] = [];
  for (const r of vc.records) {
    const rec = addRecord(c, r);
    const result = await extractFacts(provider, c, rec.id);
    mergeExtraction(c, rec.id, result);
    for (const s of result.accepted) accepted.push({ value: s.value, evidence: s.evidence, target: JSON.stringify(s.target), speaker: s.speaker });
    rejected.push(...result.rejected.map((x) => ({ reason: x.reason, raw: x.raw })));
    // 담당자가 모두 승인했다고 치고 다음 기록으로 (같은 사실을 다시 내는지 보기 위해)
    for (const s of [...c.suggestions]) approveSuggestion(c, s.id);
  }
  const allText = squash(vc.records.map((r) => r.rawText).join('\n'));
  const violations = accepted.filter((a) => vc.forbid.some((w) => squash(a.value).includes(squash(w))) || !allText.includes(squash(a.evidence)));
  const found = vc.expect.filter((e) => accepted.some((a) => {
    const t = JSON.parse(a.target);
    const keyOk = t.kind === e.category && (t.key === e.key || t.area === e.key || t.attr === e.key || e.category === 'service');
    return keyOk && e.contains.every((w) => hasWord(a.value, w));
  }));
  // 칸은 달라도 내용을 뽑았는지 (예: 월세를 경제 대신 주거 칸에)
  const foundAny = vc.expect.filter((e) => accepted.some((a) => e.contains.every((w) => hasWord(a.value, w))));
  totals.candidates += accepted.length + rejected.length;
  totals.accepted += accepted.length;
  totals.rejected += rejected.length;
  totals.violations += violations.length;
  totals.expect += vc.expect.length;
  totals.found += found.length;
  totals.foundAny += foundAny.length;

  lines.push(`## ${vc.no}. ${vc.title} (${vc.kind}, ${vc.style})`, '');
  lines.push(`- 후보 ${accepted.length + rejected.length}개 → 통과 ${accepted.length}, 걸러짐 ${rejected.length}`);
  lines.push(`- **기록에 없는 사실(금지어 포함·근거 없음): ${violations.length}건**`);
  lines.push(`- 뽑혀야 할 사실 ${vc.expect.length}개 중 맞는 칸에 ${found.length}개, 칸은 달라도 내용은 ${foundAny.length}개 뽑힘`);
  lines.push(`- 맞는 칸에 못 뽑은 것: ${found.length < vc.expect.length ? `(${vc.expect.filter((e) => !found.includes(e)).map((e) => `${e.key}:${e.contains.join('+')}`).join(', ')})` : ''}`, '');
  lines.push('| 항목 | 값 | 근거(원문) | 말한 사람 |', '|---|---|---|---|');
  for (const a of accepted) lines.push(`| ${a.target.replace(/[{}"]/g, '').replace(/\|/g, '/')} | ${a.value.replace(/\|/g, '/')} | ${a.evidence.replace(/\|/g, '/')} | ${a.speaker} |`);
  if (rejected.length) {
    lines.push('', '걸러진 후보:', '');
    for (const x of rejected) lines.push(`- ${x.reason}: ${JSON.stringify(x.raw).slice(0, 160)}`);
  }
  lines.push('');
  console.log(`${vc.no}. 통과 ${accepted.length}, 걸러짐 ${rejected.length}, 기록에 없는 사실 ${violations.length}, 뽑아야 할 사실 맞는 칸 ${found.length}·내용 ${foundAny.length}/${vc.expect.length}`);
}
if (real?.usage) {
  const u = real.usage;
  const cost = u.costUsd !== undefined ? `, 실제 금액 $${u.costUsd.toFixed(4)} (약 ${Math.round(u.costUsd * 1400).toLocaleString()}원)` : '';
  lines.splice(3, 0, `- 사용량: 호출 ${u.calls}번, 입력 ${u.inputTokens.toLocaleString()} 토큰, 출력(생각 포함) ${u.outputTokens.toLocaleString()} 토큰${cost}`);
  console.log(`사용량: 호출 ${u.calls}, 입력 ${u.inputTokens}, 출력 ${u.outputTokens}${cost} (모델 ${real.model})`);
}
lines.splice(3, 0, `- **합계: 후보 ${totals.candidates}개, 통과 ${totals.accepted}, 걸러짐 ${totals.rejected}, 기록에 없는 사실 ${totals.violations}건, 뽑아야 할 사실 맞는 칸 ${totals.found}/${totals.expect}, 칸은 달라도 내용 ${totals.foundAny}/${totals.expect}**`);
mkdirSync('test-data/reports', { recursive: true });
const tag = useFake ? '_가짜AI' : '_' + String(real?.model ?? 'auto').split('/').join('-');
const out = `test-data/reports/3단계_사실뽑기_평가${tag}.md`;
writeFileSync(out, lines.join('\n'));
console.log(`합계: 기록에 없는 사실 ${totals.violations}건, 뽑아야 할 사실 맞는 칸 ${totals.found}/${totals.expect}, 내용 ${totals.foundAny}/${totals.expect}. 저장: ${out}`);
