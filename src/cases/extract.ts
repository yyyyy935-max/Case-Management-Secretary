import type { AiProvider } from '../ai/provider.ts';
import { AiCallError } from '../ai/provider.ts';
import { GENERAL_KEYS, NEED_AREAS, PERSON_ATTRS, SPEAKERS } from './schema.ts';
import type { Case, CaseRecord } from './types.ts';
import { verifyFacts, type VerifyResult } from './verify.ts';

/**
 * 기록에서 사례 카드 사실 후보를 뽑는다(요구사항 3.3).
 * AI는 후보만 내고, 코드(verifyFacts)가 근거를 확인하고, 담당자가 승인해야 카드에 들어간다.
 * 지침은 docs/AI작성지침_초안.md의 관점(사실·말·의견 구분, 출처 밝히기, 지어내지 않기)을 따른다.
 */

const generalList = Object.entries(GENERAL_KEYS)
  .map(([k, d]) => `  - ${k} (${d.label})${'options' in d ? `: 다음 중 하나${'multiple' in d && d.multiple ? '(여러 개면 쉼표로)' : ''}: ${d.options.join(', ')}` : 'hint' in d ? `: ${d.hint}` : ''}`)
  .join('\n');
const needList = Object.entries(NEED_AREAS).map(([k, l]) => `  - ${k} (${l})`).join('\n');
const personList = Object.entries(PERSON_ATTRS).map(([k, l]) => `  - ${k} (${l})`).join('\n');
const speakerList = Object.entries(SPEAKERS).map(([k, l]) => `  - ${k}: ${l}`).join('\n');

export const EXTRACT_SYSTEM = `너는 사회복지 사례관리 담당자를 돕는 기록 정리 비서다.
담당자가 쓴 상담·방문·전화 기록 하나를 읽고, 사례 카드에 넣을 "사실" 후보를 뽑는다.
담당자가 하나씩 확인한 뒤에야 카드에 들어가므로, 정확하고 근거가 분명한 것만 낸다.

[반드시 지킬 것]
1. 기록에 적힌 것만 뽑는다. 짐작, 추론, 일반 상식으로 덧붙이지 않는다. 기록에 없으면 내지 않는다.
2. evidence에는 그 사실이 적힌 기록 원문의 문장 전체를 글자 그대로 복사한다. 고치거나 요약하거나 맞춤법을 바로잡지 않는다. value에 쓴 내용이 모두 evidence 안에 있어야 한다.
3. value는 근거 구절의 내용을 바꾸지 않고, 기록지에 쓰는 말투로 짧게 쓴다("~함", "~임", "~없음"으로 끝냄). 원문에 쓰인 낱말을 그대로 살려 쓴다. 숫자·날짜·금액은 원문 그대로 쓴다. 원문에 없는 숫자를 쓰지 않는다.
4. 누가 말했거나 보았는지 speaker로 구분한다. 대상자의 바람·생각은 대상자의 말로 쓴다(예: 본인은 "줄이고 싶다"고 함).
5. 담당자의 의견·추측(예: "~로 보임", "~가 필요해 보임", "우울해 보임")은 사실이 아니므로 내지 않는다.
6. 진단명은 기록에 의사 진단으로 적혀 있을 때만, 누가 말했는지와 함께 쓴다. 증상을 보고 진단을 짐작하지 않는다.
7. 욕구 수준 점수, 우선순위, 선정 여부, 사례관리 수준, 종결 여부 같은 판단은 내지 않는다. 담당자가 정한다.
8. 사람을 꼬리표로 부르지 않는다(예: "알코올 중독자" 대신 "하루 소주 2병을 마신다고 함"). 상황을 쓴다.
9. 이미 사례 카드에 있는 사실은 다시 내지 않는다. 바뀐 것이나 새로 알게 된 것만 낸다.
10. 사실 하나에 후보 하나. 여러 내용을 한 후보에 섞지 않는다.

[분류]
category는 general(일반사항), need(욕구 영역별 사실), person(대상자·가족·관계인), service(이용 중이거나 연계한 서비스) 중 하나다.
- general의 key:
${generalList}
- need의 key (욕구 영역):
${needList}
  욕구 영역에는 그 영역의 현재 상황, 대상자의 말, 강점·자원, 어려움을 사실로 쓴다.
- person의 key (relation에 대상자와의 관계를 기록에 적힌 말로 쓴다. 대상자 자신은 "본인"):
${personList}
- service: key는 "text", value에 서비스 이름과 기관, 이용 상태를 적힌 대로.

[예시]
기록: "2차 방문. 월세 25만원 두 달 밀림. 아들 있는데 연락 안 한 지 5년. 할머니가 혼자 사신다고 함."
출력: {"facts": [
 {"category": "need", "key": "economy", "value": "월세 25만원 2개월 밀림", "evidence": "월세 25만원 두 달 밀림.", "speaker": "client"},
 {"category": "person", "key": "contactFrequency", "relation": "아들", "value": "아들과 5년간 연락 안 함", "evidence": "아들 있는데 연락 안 한 지 5년.", "speaker": "client"},
 {"category": "general", "key": "householdType", "value": "1인가구", "evidence": "할머니가 혼자 사신다고 함.", "speaker": "client"}
]}
category 자리에는 general, need, person, service만 쓴다. 욕구 영역 이름(health, economy 등)은 category가 아니라 key에 쓴다.

[speaker]
${speakerList}

[출력]
JSON 하나만 낸다: {"facts": [{"category": "...", "key": "...", "relation": "(person일 때만)", "value": "...", "evidence": "...", "speaker": "..."}]}
뽑을 사실이 없으면 {"facts": []}.`;

export const EXTRACT_SCHEMA = {
  type: 'OBJECT',
  properties: {
    facts: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          category: { type: 'STRING', enum: ['general', 'need', 'person', 'service'] },
          key: { type: 'STRING' },
          relation: { type: 'STRING' },
          value: { type: 'STRING' },
          evidence: { type: 'STRING' },
          speaker: { type: 'STRING', enum: Object.keys(SPEAKERS) },
        },
        required: ['category', 'key', 'value', 'evidence', 'speaker'],
      },
    },
  },
  required: ['facts'],
};

/** 지금 사례 카드에 확인된 사실 요약 (AI가 같은 사실을 다시 내지 않게) */
export function cardSummary(c: Case): string {
  const lines: string[] = [];
  for (const [k, f] of Object.entries(c.general)) if (f) lines.push(`- 일반사항 ${GENERAL_KEYS[k as keyof typeof GENERAL_KEYS].label}: ${f.value}`);
  for (const p of c.people) for (const [a, f] of Object.entries(p.attrs)) if (f) lines.push(`- 인물 ${p.relation} ${PERSON_ATTRS[a as keyof typeof PERSON_ATTRS]}: ${f.value}`);
  for (const [area, fs] of Object.entries(c.needs)) for (const f of fs ?? []) lines.push(`- 욕구 ${NEED_AREAS[area as keyof typeof NEED_AREAS]}: ${f.value}`);
  for (const s of c.services) lines.push(`- 서비스: ${s.text.value}`);
  for (const s of c.suggestions) lines.push(`- (확인 대기 중) ${s.value}`);
  return lines.length ? lines.join('\n') : '(아직 없음)';
}

export function extractPrompt(c: Case, record: CaseRecord): string {
  return `[지금 사례 카드에 있는 사실]\n${cardSummary(c)}\n\n[새 기록] ${record.date} ${record.type}\n${record.rawText}`;
}

/** AI 응답 글에서 JSON을 꺼낸다 (앞뒤에 다른 글이나 ``` 가 붙어도) */
export function parseJson(text: string): unknown {
  const t = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
  try {
    return JSON.parse(t);
  } catch {
    const m = t.match(/\{[\s\S]*\}/);
    if (m) {
      try { return JSON.parse(m[0]); } catch { /* 아래로 */ }
    }
    return null;
  }
}

export async function extractFacts(provider: AiProvider, c: Case, recordId: string): Promise<VerifyResult> {
  const record = c.records.find((r) => r.id === recordId);
  if (!record) throw new Error('기록을 찾지 못했습니다.');
  let text: string;
  try {
    text = await provider.generate({ system: EXTRACT_SYSTEM, prompt: extractPrompt(c, record), responseSchema: EXTRACT_SCHEMA });
  } catch (err) {
    if (err instanceof AiCallError) throw err;
    throw new AiCallError('AI를 부르지 못했습니다. 인터넷 연결과 설정을 확인하세요.');
  }
  return verifyFacts(parseJson(text), record, c);
}

/** 사실 뽑기 결과를 사례에 넣는다(후보로만). 걸러진 후보는 최근 것만 보관 */
export function mergeExtraction(c: Case, recordId: string, result: VerifyResult): void {
  c.suggestions.push(...result.accepted);
  c.rejected = [...c.rejected.filter((r) => r.recordId !== recordId), ...result.rejected].slice(-200);
  const record = c.records.find((r) => r.id === recordId);
  if (record) record.extractedAt = new Date().toISOString();
}
