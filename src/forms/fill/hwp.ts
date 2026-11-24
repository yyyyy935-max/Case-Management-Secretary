import type { FormCell, FormDocument, FormTable } from '../types.ts';
import type { FillRequest, FillResult, FillWarning } from './types.ts';
import type { CellPlan } from './plan.ts';
import { loadRhwp } from './rhwp.ts';

/*
 * 참고: rhwp는 고친 문서를 저장할 때 자체 표시 스트림(RhwpLineSegTags, 40바이트)을 덧붙인다.
 * 지우려면 파일 안 폴더 구조를 직접 고쳐야 해서 한글에서 안 열릴 위험이 있으므로 그대로 둔다.
 */

/**
 * HWP 5.x 채우기. rhwp로 원본을 열어 대상 칸의 문단만 고친 뒤 HWP로 저장한다.
 * rhwp는 고치지 않은 부분을 원본과 똑같이 저장한다(1차 확인: 아무것도 고치지 않으면 모든 스트림이 원본과 같음).
 */

interface Step { controlIndex: number; cellIndex?: number; cellParaIndex?: number }
interface TableLoc { para: number; steps: Step[] }

export type Doc = InstanceType<Awaited<ReturnType<typeof loadRhwp>>['HwpDocument']>;

const SEC = 0;

function tryDims(doc: Doc, para: number, steps: Step[]): { rowCount: number; colCount: number; cellCount: number } | undefined {
  try {
    return JSON.parse(doc.getTableDimensionsByPath(SEC, para, JSON.stringify(steps)));
  } catch {
    return undefined;
  }
}

/** 읽기 결과(FormDocument)의 표 번호를 rhwp의 표 위치(본문 문단 + 경로)에 맞춘다 */
export function locateTables(doc: Doc, form: FormDocument): Map<number, TableLoc> {
  const locs = new Map<number, TableLoc>();
  if (doc.getSectionCount() !== 1) throw new Error('구역이 여러 개인 HWP는 아직 지원하지 않습니다.');
  const top = (JSON.parse(doc.getControls()) as { ctrlId: string; list: number; para: number; controlIndex: number }[])
    .filter((c) => c.ctrlId === 'tbl' && c.list === 0)
    .sort((a, b) => a.para - b.para || a.controlIndex - b.controlIndex);
  const ours = form.tables.filter((t) => !t.parentCellId);
  if (top.length !== ours.length) throw new Error(`표 개수가 맞지 않습니다(읽기 ${ours.length}개, rhwp ${top.length}개).`);
  ours.forEach((t, i) => locs.set(t.index, { para: top[i]!.para, steps: [{ controlIndex: top[i]!.controlIndex }] }));

  // 셀 안 표: 바깥 표의 해당 칸 문단들에서 표를 찾는다
  for (const t of form.tables) {
    if (!t.parentCellId) continue;
    // 바깥 표가 먼저 처리되도록 표 번호 순서대로 돈다(바깥 표 번호가 항상 더 작음)
    const parentIndex = Number(t.parentCellId.match(/^t(\d+)-/)![1]);
    const parentLoc = locs.get(parentIndex);
    if (!parentLoc) continue;
    const cellIndex = cellIndexOf(doc, parentLoc, t.parentCellId);
    const siblings = form.tables.filter((x) => x.parentCellId === t.parentCellId);
    const found: Step[][] = [];
    const paraCount = doc.getCellParagraphCountByPath(SEC, parentLoc.para, JSON.stringify(withCell(parentLoc.steps, cellIndex, 0)));
    for (let k = 0; k < paraCount && found.length < siblings.length; k++) {
      for (let j = 0; j < 8; j++) {
        const steps = [...withCell(parentLoc.steps, cellIndex, k), { controlIndex: j }];
        if (tryDims(doc, parentLoc.para, steps)) found.push(steps);
      }
    }
    const order = siblings.findIndex((x) => x.index === t.index);
    if (found[order]) locs.set(t.index, { para: parentLoc.para, steps: found[order]! });
  }
  // 크기 확인
  for (const t of form.tables) {
    const loc = locs.get(t.index);
    const d = loc && tryDims(doc, loc.para, loc.steps);
    if (!d || d.rowCount !== t.rows || d.colCount !== t.cols) throw new Error(`표 ${t.index}의 위치를 찾지 못했습니다.`);
  }
  return locs;
}

export function withCell(steps: Step[], cellIndex: number, cellParaIndex: number): Step[] {
  const last = steps[steps.length - 1]!;
  return [...steps.slice(0, -1), { controlIndex: last.controlIndex, cellIndex, cellParaIndex }];
}

const cellIndexCache = new WeakMap<Doc, Map<string, number>>();

function cellIndexOf(doc: Doc, loc: TableLoc, cellId: string): number {
  let cache = cellIndexCache.get(doc);
  if (!cache) cellIndexCache.set(doc, (cache = new Map()));
  const key = `${loc.para}:${JSON.stringify(loc.steps)}`;
  if (!cache.has(`${key}|built`)) {
    const d = tryDims(doc, loc.para, loc.steps)!;
    for (let i = 0; i < d.cellCount; i++) {
      const info = JSON.parse(doc.getCellInfoByPath(SEC, loc.para, JSON.stringify(withCell(loc.steps, i, 0))));
      cache.set(`${key}|r${info.row}-c${info.col}`, i);
    }
    cache.set(`${key}|built`, 1);
  }
  const m = cellId.match(/-r(\d+)-c(\d+)$/)!;
  const idx = cache.get(`${key}|r${m[1]}-c${m[2]}`);
  if (idx === undefined) throw new Error(`${cellId} 칸을 찾지 못했습니다.`);
  return idx;
}

const cpLen = (s: string) => [...s].length;

/** rhwp 글자 모양이 안내용(회색·기울임·굵게·밑줄·취소선)인지 */
function isGuideStyle(p: { textColor?: string; italic?: boolean; bold?: boolean; underline?: boolean; strikethrough?: boolean }): boolean {
  if (p.italic || p.bold || p.underline || p.strikethrough) return true;
  const c = p.textColor ?? '#000000';
  if (!/^#[0-9A-Fa-f]{6}/.test(c)) return false;
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));
  const max = Math.max(r!, g!, b!);
  return max - Math.min(r!, g!, b!) <= 24 && max >= 0x66 && max <= 0xe0;
}

/** 안내용 서식을 지우고 쓸 일반 글자 모양 */
const NORMAL_PROPS = JSON.stringify({ textColor: '#000000', italic: false, bold: false, underline: false, underlineType: 'None', strikethrough: false });

export async function fillHwp(original: Uint8Array, form: FormDocument, plans: CellPlan[], req: FillRequest): Promise<FillResult> {
  const rhwp = await loadRhwp();
  const doc = new rhwp.HwpDocument(new Uint8Array(original));
  const skipped: FillWarning[] = [];
  const warnings: FillWarning[] = [];
  const applied: string[] = [];
  try {
    const before = doc.pageCount();
    const locs = locateTables(doc, form);
    for (const plan of plans) {
      const table = form.tables[plan.tableIndex]!;
      const loc = locs.get(table.index)!;
      const cellIndex = cellIndexOf(doc, loc, plan.cell.id);
      const path = (k: number) => JSON.stringify(withCell(loc.steps, cellIndex, k));
      const paraCount = () => doc.getCellParagraphCountByPath(SEC, loc.para, path(0));
      try {
        if (plan.kind === 'check') {
          // 체크: 해당 □만 체크 기호로 바꾼다. 칸 글의 위치를 문단별 위치로 바꿔서 처리
          const lens: number[] = [];
          for (let k = 0; k < paraCount(); k++) lens.push(doc.getCellParagraphLengthByPath(SEC, loc.para, path(k)));
          for (const idx of plan.boxIndexes) {
            let k = 0;
            let off = idx;
            while (k < lens.length && off > lens[k]!) { off -= lens[k]! + 1; k++; }
            const ch = doc.getTextInCellByPath(SEC, loc.para, path(k), off, 1);
            if (!/[□☐▢◻\u{F02EB}]/u.test(ch)) throw new Error(`체크 기호 위치가 맞지 않음("${ch}")`);
            doc.deleteTextInCellByPath(SEC, loc.para, path(k), off, 1);
            doc.insertTextInCellByPath(SEC, loc.para, path(k), off, req.checkMark);
          }
        } else {
          const lines = plan.text.split('\n');
          // 빈 칸이라도 빈 문단에 굵게·밑줄·회색·기울임 서식이 남아 있으면 일반 서식으로 쓴다
          let normalize = plan.normalize;
          if (!normalize) {
            try {
              const p = JSON.parse(doc.getCellCharPropertiesAtByPath(SEC, loc.para, path(0), 0));
              normalize = isGuideStyle(p);
            } catch { /* 서식을 못 읽으면 그대로 둔다 */ }
          }
          // 안내 문구는 문단마다 정렬이 다를 수 있다(예: 첫 줄 가운데, 나머지 왼쪽).
          // 가장 많이 쓰인 정렬을 모든 줄에 쓴다
          let alignment: string | undefined;
          if (plan.role === 'guide' && paraCount() > 1) {
            const counts = new Map<string, number>();
            for (let k = 0; k < paraCount(); k++) {
              try {
                const a = JSON.parse(doc.getCellParaPropertiesAtByPath(SEC, loc.para, path(k))).alignment as string;
                counts.set(a, (counts.get(a) ?? 0) + 1);
              } catch { /* 무시 */ }
            }
            alignment = [...counts].sort((a, b) => b[1] - a[1])[0]?.[0];
          }
          // 1) 모든 문단의 글을 지운다
          for (let k = 0; k < paraCount(); k++) {
            const len = doc.getCellParagraphLengthByPath(SEC, loc.para, path(k));
            if (len > 0) doc.deleteTextInCellByPath(SEC, loc.para, path(k), 0, len);
          }
          // 2) 줄 수에 맞게 남는 문단은 지우고(앞 문단에 합침) 모자라면 나눈다
          while (paraCount() > lines.length) doc.mergeParagraphInCellByPath(SEC, loc.para, path(paraCount() - 1));
          while (paraCount() < lines.length) doc.splitParagraphInCellByPath(SEC, loc.para, path(paraCount() - 1), 0);
          // 3) 줄마다 글을 넣고, 안내용 서식이었으면 일반 서식으로 바꾼다
          lines.forEach((line, k) => {
            if (!line) return;
            doc.insertTextInCellByPath(SEC, loc.para, path(k), 0, line);
            if (normalize) doc.applyCharFormatInCellByPath(SEC, loc.para, path(k), 0, cpLen(line), NORMAL_PROPS);
          });
          if (alignment) lines.forEach((_, k) => doc.applyParaFormatInCellByPath(SEC, loc.para, path(k), JSON.stringify({ alignment })));
        }
        applied.push(plan.cell.id);
        warnings.push(...plan.warnings.map((message) => ({ id: plan.cell.id, message })));
      } catch (err) {
        skipped.push({ id: plan.cell.id, message: `쓰지 못함: ${err instanceof Error ? err.message.slice(0, 120) : '알 수 없는 오류'}` });
      }
    }
    const data = doc.exportHwp();
    const after = doc.pageCount();
    return { format: 'hwp', data, applied, skipped, warnings, pages: { before, after } };
  } finally {
    doc.free();
  }
}

export type { FormCell, FormTable };
