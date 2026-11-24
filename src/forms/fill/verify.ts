import { parse } from 'kordoc';
import { readForm } from '../read.ts';
import type { FormCell, FormDocument } from '../types.ts';
import type { FillRequest, FillResult } from './types.ts';
import { loadRhwp } from './rhwp.ts';

/** 요구사항 9.2 양식 쓰기 자동 검사 */
export interface Check {
  name: string;
  ok: boolean;
  detail: string;
}

const styleKey = (c: FormCell) =>
  JSON.stringify(c.paragraphs.map((p) => p.runs.map((r) => [r.text, r.color ?? '', !!r.italic, !!r.bold, !!r.underline, r.sizePt ?? 0])));

const BOX = /[□☐▢◻\u{F02EB}]/gu;

export async function verifyFill(original: Uint8Array, result: FillResult, req: FillRequest): Promise<Check[]> {
  const checks: Check[] = [];
  const before = await readForm(original);
  let after: FormDocument | undefined;
  try {
    after = await readForm(result.data);
  } catch (err) {
    checks.push({ name: '결과 파일 읽기', ok: false, detail: err instanceof Error ? err.message : '읽지 못함' });
    return checks;
  }

  // 1. 형식
  checks.push({ name: '형식이 원본과 같음', ok: after.format === before.format, detail: `원본 ${before.format.toUpperCase()} → 결과 ${after.format.toUpperCase()}` });

  // 2. 표·칸·병합 구조
  const shape = (d: FormDocument) => d.tables.map((t) => `${t.rows}x${t.cols}:` + t.cells.map((c) => `${c.id}/${c.rowSpan}x${c.colSpan}`).join(','));
  const sb = shape(before);
  const sa = shape(after);
  const diffTables = sb.map((s, i) => (s === sa[i] ? -1 : i)).filter((i) => i >= 0);
  checks.push({
    name: '표 개수·칸 개수·병합 구조가 같음',
    ok: sb.length === sa.length && diffTables.length === 0,
    detail: `표 ${before.tables.length}→${after.tables.length}개, 칸 ${before.tables.reduce((n, t) => n + t.cells.length, 0)}→${after.tables.reduce((n, t) => n + t.cells.length, 0)}개${diffTables.length ? `, 구조가 다른 표: ${diffTables.join(', ')}` : ''}`,
  });

  // 3. 채우지 않은 칸은 글·서식이 같음
  const applied = new Set(result.applied);
  const afterCells = new Map(after.tables.flatMap((t) => t.cells.map((c) => [c.id, c] as const)));
  const changedUntouched: string[] = [];
  let untouched = 0;
  for (const t of before.tables) {
    for (const c of t.cells) {
      if (applied.has(c.id)) continue;
      // 채운 칸을 품은 바깥 칸(안쪽 표가 든 칸)은 안쪽 글이 바뀌므로 건너뜀
      if (c.nestedTableIndexes.length) continue;
      untouched++;
      const a = afterCells.get(c.id);
      if (!a || styleKey(a) !== styleKey(c)) changedUntouched.push(c.id);
    }
  }
  checks.push({
    name: '채우지 않은 칸의 글과 서식이 같음',
    ok: changedUntouched.length === 0,
    detail: `${untouched}칸 비교${changedUntouched.length ? `, 달라진 칸: ${changedUntouched.slice(0, 10).join(', ')}${changedUntouched.length > 10 ? ' 외' : ''}` : ''}`,
  });

  // 4. 채운 칸에 값이 들어감
  const wrong: string[] = [];
  for (const id of result.applied) {
    const v = req.values[id]!;
    const a = afterCells.get(id);
    const b = before.tables.flatMap((t) => t.cells).find((c) => c.id === id);
    if (!a || !b) { wrong.push(id); continue; }
    if (v.text !== undefined) {
      if (a.text !== v.text.replace(/\r\n?/g, '\n').replace(/\s+$/, '')) wrong.push(id);
    } else if (v.check) {
      const marks = (a.text.match(new RegExp(escapeRe(req.checkMark), 'g')) ?? []).length - (b.text.match(new RegExp(escapeRe(req.checkMark), 'g')) ?? []).length;
      const boxesGone = (b.text.match(BOX) ?? []).length - (a.text.match(BOX) ?? []).length;
      if (marks < 1 || boxesGone !== marks) wrong.push(id);
    }
  }
  checks.push({ name: '채운 칸에 값이 들어감', ok: wrong.length === 0, detail: `${result.applied.length}칸${wrong.length ? `, 값이 다른 칸: ${wrong.join(', ')}` : ''}` });

  // 5. 파일이 오류 없이 열림 (여러 판독기)
  const openers: string[] = [];
  const failed: string[] = [];
  openers.push('사례비서 읽기');
  try {
    const p = await parse(Buffer.from(result.data));
    if (p.success) openers.push('kordoc'); else failed.push('kordoc');
  } catch { failed.push('kordoc'); }
  if (after.format !== 'docx') {
    try {
      const rhwp = await loadRhwp();
      const d = new rhwp.HwpDocument(new Uint8Array(result.data));
      d.pageCount();
      d.free();
      openers.push('rhwp');
    } catch { failed.push('rhwp'); }
  }
  checks.push({ name: '파일이 오류 없이 열림', ok: failed.length === 0, detail: `열림: ${openers.join(', ')}${failed.length ? ` / 못 엶: ${failed.join(', ')}` : ''}. 한글 프로그램 확인은 사람이 해야 함` });

  // 6. 쪽 수
  if (result.pages) {
    const changed = result.pages.after !== result.pages.before;
    checks.push({ name: '쪽 수 변화', ok: true, detail: changed ? `${result.pages.before}쪽 → ${result.pages.after}쪽 (내용이 늘어 쪽이 바뀜, 한글에서 확인 필요)` : `${result.pages.before}쪽 그대로 (rhwp 조판 기준)` });
  }
  return checks;
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
