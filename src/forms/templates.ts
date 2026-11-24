import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import type { FormDocument } from './types.ts';
import { ROLE_NAMES, type CellRole } from './classify.ts';

/**
 * 양식 템플릿: 담당자가 고친 칸 역할을 양식별로 저장한다(요구사항 4.1의 4번, 4.6).
 * 이 PC의 data/templates/ 에만 저장한다. 사례 내용은 들어가지 않고 칸 번호와 역할만 들어간다.
 */
export interface FormTemplate {
  fingerprint: string;
  name: string;
  format: FormDocument['format'];
  createdAt: string;
  updatedAt: string;
  /** 칸 id → 담당자가 정한 역할 */
  overrides: Record<string, CellRole>;
}

/** 양식의 구조(표, 칸 위치, 병합, 인쇄된 글)로 만든 지문. 같은 빈 양식이면 같은 값이 나온다 */
export function formFingerprint(doc: FormDocument): string {
  const shape = doc.tables.map((t) => [t.rows, t.cols, t.cells.map((c) => [c.id, c.rowSpan, c.colSpan, c.text.replace(/\s+/g, '')])]);
  return createHash('sha256').update(JSON.stringify([doc.format, shape])).digest('hex').slice(0, 32);
}

export class TemplateStore {
  constructor(private dir: string) {}

  private file(fp: string) {
    if (!/^[0-9a-f]{32}$/.test(fp)) throw new Error('잘못된 양식 지문');
    return resolve(this.dir, `${fp}.json`);
  }

  get(fp: string): FormTemplate | undefined {
    const f = this.file(fp);
    if (!existsSync(f)) return undefined;
    return JSON.parse(readFileSync(f, 'utf8')) as FormTemplate;
  }

  save(fp: string, input: { name: string; format: FormDocument['format']; overrides: Record<string, string> }): FormTemplate {
    const overrides: Record<string, CellRole> = {};
    for (const [id, role] of Object.entries(input.overrides)) {
      if (/^(t\d+-r\d+-c\d+|p\d+)$/.test(id) && role in ROLE_NAMES) overrides[id] = role as CellRole;
    }
    const now = new Date().toISOString();
    const prev = this.get(fp);
    const t: FormTemplate = { fingerprint: fp, name: input.name.slice(0, 200), format: input.format, createdAt: prev?.createdAt ?? now, updatedAt: now, overrides };
    mkdirSync(this.dir, { recursive: true });
    writeFileSync(this.file(fp), JSON.stringify(t, null, 2));
    return t;
  }

  list(): FormTemplate[] {
    if (!existsSync(this.dir)) return [];
    return readdirSync(this.dir).filter((f) => /^[0-9a-f]{32}\.json$/.test(f)).map((f) => JSON.parse(readFileSync(resolve(this.dir, f), 'utf8')) as FormTemplate);
  }
}
