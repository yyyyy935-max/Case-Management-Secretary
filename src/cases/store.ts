import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Case, CaseRecord, Field, Suggestion } from './types.ts';
import { RECORD_TYPES, type RecordType } from './schema.ts';
import { squash } from './verify.ts';

/**
 * 사례 저장소. 사례마다 JSON 파일 하나를 이 PC의 data/cases/ 에 둔다(절대 규칙 4).
 * 암호화와 잠금 비밀번호는 개인정보 단계(5단계)에서 붙인다.
 */
export class CaseStore {
  constructor(private dir: string) {}

  private file(id: string) {
    if (!/^[0-9a-f-]{36}$/.test(id)) throw new Error('잘못된 사례 id');
    return resolve(this.dir, `${id}.json`);
  }

  list(): { id: string; title: string; updatedAt: string; records: number; pending: number }[] {
    if (!existsSync(this.dir)) return [];
    return readdirSync(this.dir)
      .filter((f) => /^[0-9a-f-]{36}\.json$/.test(f))
      .map((f) => JSON.parse(readFileSync(resolve(this.dir, f), 'utf8')) as Case)
      .map((c) => ({ id: c.id, title: c.title, updatedAt: c.updatedAt, records: c.records.length, pending: c.suggestions.length }))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  get(id: string): Case | undefined {
    const f = this.file(id);
    return existsSync(f) ? (JSON.parse(readFileSync(f, 'utf8')) as Case) : undefined;
  }

  save(c: Case): Case {
    c.updatedAt = new Date().toISOString();
    mkdirSync(this.dir, { recursive: true });
    // 쓰다가 끊겨도 기존 파일이 깨지지 않게 임시 파일에 쓰고 바꾼다
    const tmp = `${this.file(c.id)}.tmp`;
    writeFileSync(tmp, JSON.stringify(c, null, 2));
    renameSync(tmp, this.file(c.id));
    return c;
  }

  create(title: string): Case {
    const now = new Date().toISOString();
    return this.save({
      id: randomUUID(), title: title.trim().slice(0, 100) || '이름 없는 사례', createdAt: now, updatedAt: now,
      records: [], general: {}, people: [{ id: randomUUID(), relation: '본인', isClient: true, attrs: {} }], needs: {}, services: [], suggestions: [], rejected: [],
    });
  }

  remove(id: string) {
    const f = this.file(id);
    if (existsSync(f)) rmSync(f);
  }
}

export function addRecord(c: Case, input: { date: string; type: string; rawText: string; author?: string }): CaseRecord {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date)) throw new Error('날짜는 YYYY-MM-DD 형식이어야 합니다.');
  if (!RECORD_TYPES.includes(input.type as RecordType)) throw new Error('기록 종류가 올바르지 않습니다.');
  const text = input.rawText.replace(/\r\n?/g, '\n').trim();
  if (!text) throw new Error('기록 내용이 비어 있습니다.');
  if (text.length > 20000) throw new Error('기록이 너무 깁니다(2만 자 이하).');
  const r: CaseRecord = { id: randomUUID(), date: input.date, type: input.type as RecordType, rawText: text, author: input.author?.slice(0, 50), createdAt: new Date().toISOString() };
  c.records.push(r);
  c.records.sort((a, b) => a.date.localeCompare(b.date) || a.createdAt.localeCompare(b.createdAt));
  return r;
}

const field = (s: Suggestion, value: string, status: Field['status']): Field => ({
  value, sourceRecordIds: [s.recordId], status, evidence: [s.evidence], speaker: s.speaker, updatedAt: new Date().toISOString(),
});

/** 후보를 승인한다. value를 주면 담당자가 고친 값으로 넣는다 */
export function approveSuggestion(c: Case, suggestionId: string, editedValue?: string): void {
  const s = c.suggestions.find((x) => x.id === suggestionId);
  if (!s) throw new Error('후보를 찾지 못했습니다.');
  const value = (editedValue ?? s.value).trim();
  if (!value) throw new Error('값이 비어 있습니다.');
  const t = s.target;
  if (t.kind === 'general') c.general[t.key] = field(s, value, 'confirmed');
  else if (t.kind === 'need') (c.needs[t.area] ??= []).push(field(s, value, 'confirmed'));
  else if (t.kind === 'service') c.services.push({ id: randomUUID(), text: field(s, value, 'confirmed') });
  else {
    let p = c.people.find((x) => squash(x.relation) === squash(t.relation) || (x.isClient && /^(본인|대상자|클라이언트)$/.test(t.relation)));
    if (!p) c.people.push((p = { id: randomUUID(), relation: t.relation, isClient: false, attrs: {} }));
    p.attrs[t.attr] = field(s, value, 'confirmed');
  }
  c.suggestions = c.suggestions.filter((x) => x.id !== suggestionId);
}

export function rejectSuggestion(c: Case, suggestionId: string): void {
  if (!c.suggestions.some((x) => x.id === suggestionId)) throw new Error('후보를 찾지 못했습니다.');
  c.suggestions = c.suggestions.filter((x) => x.id !== suggestionId);
}

/** 담당자가 직접 값을 넣거나 지운다(근거 기록 없이 담당자 확인 값) */
export function setGeneralByWorker(c: Case, key: keyof Case['general'], value: string | null): void {
  if (value === null || !value.trim()) delete c.general[key];
  else c.general[key] = { value: value.trim(), sourceRecordIds: [], status: 'confirmed', updatedAt: new Date().toISOString() };
}

/** 확인된 사실 하나를 지운다 (욕구 영역 사실, 서비스) */
export function removeFact(c: Case, path: { kind: 'need'; area: keyof Case['needs']; index: number } | { kind: 'service'; id: string }): void {
  if (path.kind === 'need') (c.needs[path.area] ?? []).splice(path.index, 1);
  else c.services = c.services.filter((s) => s.id !== path.id);
}
