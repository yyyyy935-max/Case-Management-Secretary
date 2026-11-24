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
    checks.push({ name: '만든 파일 열어 보기', ok: false, detail: `만든 파일을 다시 열지 못함 (${err instanceof Error ? err.message : '원인 모름'})` });
    return checks;
  }

  // 1. 형식
  checks.push({ name: '파일 종류', ok: after.format === before.format, detail: after.format === before.format ? `원본과 같은 ${after.format.toUpperCase()} 파일` : `원본은 ${before.format.toUpperCase()}인데 결과는 ${after.format.toUpperCase()}` });

  // 2. 표·칸·병합 구조
  const shape = (d: FormDocument) => d.tables.map((t) => `${t.rows}x${t.cols}:` + t.cells.map((c) => `${c.id}/${c.rowSpan}x${c.colSpan}`).join(','));
  const sb = shape(before);
  const sa = shape(after);
  const diffTables = sb.map((s, i) => (s === sa[i] ? -1 : i)).filter((i) => i >= 0);
  checks.push({
    name: '표 모양',
    ok: sb.length === sa.length && diffTables.length === 0,
    detail: sb.length === sa.length && diffTables.length === 0 ? `표 ${before.tables.length}개 모두 원본과 같은 모양 (줄, 칸, 합친 칸)` : `원본과 모양이 달라진 표 ${diffTables.length || Math.abs(sb.length - sa.length)}개`,
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
    name: '손대지 않은 항목',
    ok: changedUntouched.length === 0,
    detail: changedUntouched.length ? `내용을 넣지 않았는데 글이나 글자 모양이 달라진 곳 ${changedUntouched.length}곳` : `내용을 넣지 않은 ${untouched}곳은 글과 글자 모양이 원본 그대로`,
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
  checks.push({ name: '넣은 내용', ok: wrong.length === 0, detail: wrong.length ? `넣으려던 내용과 다르게 들어간 곳 ${wrong.length}곳` : `${result.applied.length}곳 모두 넣은 내용 그대로 들어감` });

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
  checks.push({ name: '파일 열기', ok: failed.length === 0, detail: `${failed.length ? `문서 프로그램 ${openers.length + failed.length}종 중 ${failed.length}종에서 열리지 않음` : `문서 프로그램 ${openers.length}종에서 열림`}. 한글이나 Word에서는 직접 열어 확인해 주세요` });

  // 6. 쪽 수
  if (result.pages) {
    const changed = result.pages.after !== result.pages.before;
    checks.push({ name: '쪽 수', ok: true, detail: changed ? `${result.pages.before}쪽에서 ${result.pages.after}쪽으로 바뀜. 내용이 길어 쪽이 늘었을 수 있으니 한글에서 확인해 주세요` : `${result.pages.before}쪽으로 원본과 같음` });
  }
  return checks;
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
