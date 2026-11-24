import { randomUUID } from 'node:crypto';
import { GENERAL_KEYS, NEED_AREAS, OPTION_CUES, PERSON_ATTRS, SPEAKERS, type GeneralKey, type NeedArea, type PersonAttr, type Speaker } from './schema.ts';
import type { Case, CaseRecord, Field, RejectedSuggestion, Suggestion } from './types.ts';

/**
 * AI가 낸 사실 후보를 코드로 검사한다(요구사항 3.3, 절대 규칙 2).
 * 통과 조건:
 *  1. 정해진 항목(일반사항·욕구영역·인물·서비스)에만 넣는다.
 *  2. 근거 문장이 기록 원문에 그대로 있다(띄어쓰기·줄바꿈 차이만 허용).
 *  3. 값에 든 숫자는 모두 근거 문장에 있다(지어낸 금액·날짜·나이를 막음).
 *  4. 고르는 항목(보호구분 등)은 정해진 선택지 중 하나다.
 *  5. 담당자 의견은 사실로 넣지 않는다.
 *  6. 값의 낱말 중 절반 이상이 근거 문장에서 온 것이다(근거는 맞는데 값을 다른 말로 바꿔 지어내는 것을 막음).
 *  7. 진단명·낙인이 되는 말(치매, 우울증, 골절, 중독, 학대 등)은 근거 문장에 그 말이 그대로 있을 때만 쓴다(작성 지침: 진단 짐작 금지).
 * 하나라도 어기면 후보에서 뺀다. 빠진 후보와 이유는 화면에 보여 준다.
 */

export interface RawFact {
  category?: unknown;
  key?: unknown;
  relation?: unknown;
  value?: unknown;
  evidence?: unknown;
  speaker?: unknown;
}

/** 비교용으로 띄어쓰기·줄바꿈·전각 문자 차이를 없앤다 */
export function squash(s: string): string {
  return s
    .normalize('NFKC')
    .replace(/[​-‍﻿]/g, '')
    .replace(/[“”"'‘’`]/g, '')
    .replace(/\s+/g, '');
}

/** 값 속 숫자 덩어리들 (12, 2026, 3.5 등) */
const numbersIn = (s: string) => s.normalize('NFKC').match(/\d+(?:[.,]\d+)?/g) ?? [];

/** 숫자를 한글로 바꿔 쓴 경우(두 달 → 2개월)를 허용하기 위한 간단한 대응표 */
const KOREAN_NUM: Record<string, string> = { 한: '1', 두: '2', 세: '3', 네: '4', 다섯: '5', 여섯: '6', 일곱: '7', 여덟: '8', 아홉: '9', 열: '10', 하나: '1', 둘: '2', 셋: '3', 넷: '4' };

function evidenceNumbers(evidence: string): Set<string> {
  const out = new Set(numbersIn(evidence).map((n) => n.replace(/,/g, '')));
  for (const [word, digit] of Object.entries(KOREAN_NUM)) {
    if (new RegExp(`${word}\\s*(달|개월|번|명|살|끼|시간|주|해|년|회|차|군데|개)`).test(evidence)) out.add(digit);
  }
  return out;
}

/** 값의 낱말이 근거 문장에서 왔는지: 낱말 앞 두 글자나 숫자가 근거에 있으면 근거에서 온 것으로 본다 */
export function wordSupport(value: string, evidence: string): number {
  const ev = squash(evidence);
  const evNums = evidenceNumbers(evidence);
  const words = value.normalize('NFKC').split(/[\s,.·()\[\]"'“”‘’:;/~-]+/).filter((w) => /[가-힣A-Za-z0-9]/.test(w));
  const meaningful = words.filter((w) => !/^(있음|없음|함|하심|했음|한다고|라고|있다고|없다고|중|및|등|약|씩|정도)$/.test(w));
  if (!meaningful.length) return 1;
  const ok = meaningful.filter((w) => {
    const nums = w.match(/\d+/g);
    if (nums && nums.every((n) => evNums.has(n))) return true;
    const head = w.replace(/\d+/g, '').slice(0, 2);
    return head.length > 0 && ev.includes(head);
  });
  return ok.length / meaningful.length;
}

/** 근거 문장에 그대로 있을 때만 쓸 수 있는 말: 진단명, 낙인이 되는 말, 위험 판단 */
export const SENSITIVE_TERMS = [
  '치매', '알츠하이머', '우울증', '우울감', '조울증', '양극성', '조현병', '공황', '불면증', '강박', 'ADHD', '자폐', '발달장애', '지적장애', '학습장애',
  '중독', '알코올', '도박', '자해', '자살', '학대', '방임', '폭력', '가정폭력', '성폭력', '비행', '가출', '고독사',
  '골절', '관절염', '디스크', '당뇨', '고혈압', '암', '뇌졸중', '중풍', '파킨슨', '결핵', '간경화', '신부전', '치료 거부',
  '장애1급', '장애2급', '1급', '2급', '3급', '중증', '경증', '수급자', '기초생활수급', '차상위', '파산', '신용불량', '노숙', '불법체류',
];

/** 값에 든 민감한 말 중 근거 문장에 없는 것 */
export function unsupportedSensitive(value: string, evidence: string): string[] {
  const v = squash(value);
  const ev = squash(evidence);
  return SENSITIVE_TERMS.filter((t) => v.includes(squash(t)) && !ev.includes(squash(t)));
}

export interface VerifyResult {
  accepted: Suggestion[];
  rejected: RejectedSuggestion[];
}

function existingValues(c: Case, t: Suggestion['target']): { confirmed?: string; all: string[] } {
  const pending = c.suggestions.filter((s) => JSON.stringify(s.target) === JSON.stringify(t)).map((s) => s.value);
  if (t.kind === 'general') {
    const f = c.general[t.key];
    return { confirmed: f?.status === 'confirmed' ? f.value : undefined, all: [...(f ? [f.value] : []), ...pending] };
  }
  if (t.kind === 'need') return { all: [...(c.needs[t.area] ?? []).map((f: Field) => f.value), ...pending] };
  if (t.kind === 'person') {
    const p = c.people.find((x) => squash(x.relation) === squash(t.relation));
    const f = p?.attrs[t.attr];
    return { confirmed: f?.status === 'confirmed' ? f.value : undefined, all: [...(f ? [f.value] : []), ...pending] };
  }
  return { all: [...c.services.map((s) => s.text.value), ...pending] };
}

export function verifyFacts(raw: unknown, record: CaseRecord, c: Case): VerifyResult {
  const accepted: Suggestion[] = [];
  const rejected: RejectedSuggestion[] = [];
  const facts = (raw && typeof raw === 'object' && Array.isArray((raw as { facts?: unknown }).facts) ? (raw as { facts: unknown[] }).facts : null);
  if (!facts) {
    rejected.push({ recordId: record.id, raw, reason: 'AI 응답 형식이 맞지 않음' });
    return { accepted, rejected };
  }
  const recordSquashed = squash(record.rawText);
  const reject = (f: unknown, reason: string) => rejected.push({ recordId: record.id, raw: f, reason });

  for (const item of facts) {
    const f = (item ?? {}) as RawFact;
    const category = String(f.category ?? '');
    const key = String(f.key ?? '');
    const value = typeof f.value === 'string' ? f.value.trim() : '';
    const evidence = typeof f.evidence === 'string' ? f.evidence.trim() : '';
    const speaker = String(f.speaker ?? '');

    if (!value) { reject(item, '값이 비어 있음'); continue; }
    if (value.length > 200) { reject(item, '값이 너무 김(200자 초과)'); continue; }
    if (!evidence) { reject(item, '근거 문장이 없음'); continue; }
    if (speaker === 'worker_opinion' || speaker === 'opinion') { reject(item, '담당자 의견은 사례 카드의 사실로 넣지 않음'); continue; }
    if (!(speaker in SPEAKERS)) { reject(item, `말한 사람 구분이 올바르지 않음(${speaker})`); continue; }

    // 근거 문장이 원문에 그대로 있는가
    if (!recordSquashed.includes(squash(evidence))) { reject(item, '근거 문장이 기록 원문에 없음(지어낸 근거)'); continue; }

    // 정해진 선택지 값(예: 1인가구)은 근거 문장의 말과 달라도 되므로 숫자·낱말 검사를 하지 않는다
    const optionDef = category === 'general' && key in GENERAL_KEYS ? (GENERAL_KEYS[key as GeneralKey] as { options?: readonly string[] }) : undefined;
    if (!optionDef?.options) {
      // 값의 숫자가 근거 문장에 있는가
      const evNums = evidenceNumbers(evidence);
      const missing = numbersIn(value).map((n) => n.replace(/,/g, '')).filter((n) => !evNums.has(n));
      if (missing.length) { reject(item, `값의 숫자(${missing.join(', ')})가 근거 문장에 없음`); continue; }
      // 진단명·낙인이 되는 말은 근거에 그대로 있어야 한다
      const sensitive = unsupportedSensitive(value, evidence);
      if (sensitive.length) { reject(item, `근거 문장에 없는 진단·민감한 말(${sensitive.join(', ')})`); continue; }
      // 값의 낱말이 근거 문장에서 왔는가
      if (wordSupport(value, evidence) < 0.5) { reject(item, '값이 근거 문장의 말과 맞지 않음(근거와 다른 내용)'); continue; }
    }

    let target: Suggestion['target'];
    if (category === 'general') {
      if (!(key in GENERAL_KEYS)) { reject(item, `없는 일반사항 항목(${key})`); continue; }
      const def = GENERAL_KEYS[key as GeneralKey] as { options?: readonly string[]; multiple?: boolean };
      if (def.options) {
        const parts = def.multiple ? value.split(/[,·/]/).map((s) => s.trim()).filter(Boolean) : [value];
        const bad = parts.filter((p) => !def.options!.includes(p));
        if (bad.length) { reject(item, `선택지에 없는 값(${bad.join(', ')})`); continue; }
        // 선택지를 뒷받침하는 말이 근거 문장에 있어야 한다 (예: 1인가구 ← 혼자·홀로·독거)
        const cues = OPTION_CUES[key];
        const ev = squash(evidence);
        const unsupported = cues ? parts.filter((p) => cues[p] && cues[p]!.length > 0 && !cues[p]!.some((w) => ev.includes(squash(w)))) : [];
        if (unsupported.length) { reject(item, `근거 문장에 "${unsupported.join(', ')}"를 뒷받침하는 말이 없음`); continue; }
      }
      target = { kind: 'general', key: key as GeneralKey };
    } else if (category === 'need') {
      if (!(key in NEED_AREAS)) { reject(item, `없는 욕구 영역(${key})`); continue; }
      target = { kind: 'need', area: key as NeedArea };
    } else if (category === 'person') {
      const relation = typeof f.relation === 'string' ? f.relation.trim() : '';
      if (!relation) { reject(item, '인물의 관계(본인, 손자 등)가 없음'); continue; }
      if (!(key in PERSON_ATTRS)) { reject(item, `없는 인물 항목(${key})`); continue; }
      // 관계를 나타내는 말도 근거에 있어야 한다(본인·대상자는 예외)
      if (!/^(본인|대상자|클라이언트)$/.test(relation) && !recordSquashed.includes(squash(relation))) { reject(item, `관계("${relation}")가 기록에 없음`); continue; }
      target = { kind: 'person', relation, attr: key as PersonAttr };
    } else if (category === 'service') {
      target = { kind: 'service' };
    } else {
      reject(item, `없는 분류(${category})`);
      continue;
    }

    const existing = existingValues(c, target);
    if (existing.all.some((v) => squash(v) === squash(value))) { reject(item, '이미 있는 값'); continue; }
    if (accepted.some((s) => JSON.stringify(s.target) === JSON.stringify(target) && squash(s.value) === squash(value))) { reject(item, '같은 후보가 중복됨'); continue; }
    accepted.push({
      id: randomUUID(),
      recordId: record.id,
      target,
      value,
      evidence,
      speaker: speaker as Speaker,
      conflictWith: existing.confirmed && target.kind !== 'need' && target.kind !== 'service' ? existing.confirmed : undefined,
      createdAt: new Date().toISOString(),
    });
  }
  return { accepted, rejected };
}
