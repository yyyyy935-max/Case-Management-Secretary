import type { FormDocument } from '../types.ts';
import { loadRhwp } from './rhwp.ts';
import { locateTables } from './hwp.ts';

export interface PagePreview {
  /** 쪽 번호 (1부터) */
  page: number;
  before: string;
  after: string;
}

/**
 * 채운 칸이 있는 쪽만 골라 원본과 결과의 쪽 그림(SVG)을 만든다(요구사항 9.2 렌더 이미지 비교).
 * rhwp의 조판 결과라 한글과 조금 다를 수 있다. HWP·HWPX만 된다.
 */
export async function comparePages(original: Uint8Array, filled: Uint8Array, form: FormDocument, cellIds: string[], max = 4): Promise<PagePreview[]> {
  if (form.format === 'docx' || !cellIds.length) return [];
  const rhwp = await loadRhwp();
  const a = new rhwp.HwpDocument(new Uint8Array(original));
  const b = new rhwp.HwpDocument(new Uint8Array(filled));
  try {
    const locs = locateTables(b, form);
    const pages = new Set<number>();
    for (const id of cellIds) {
      const m = id.match(/^t(\d+)-r(\d+)-c(\d+)$/);
      if (!m) continue;
      const loc = locs.get(Number(m[1]));
      if (!loc) continue;
      try {
        const boxes = JSON.parse(b.getTableCellBboxesByPath(0, loc.para, JSON.stringify(loc.steps))) as { row: number; col: number; pageIndex: number }[];
        const hit = boxes.find((x) => x.row === Number(m[2]) && x.col === Number(m[3]));
        if (hit) pages.add(hit.pageIndex);
      } catch { /* 쪽을 못 찾으면 건너뜀 */ }
    }
    const list = [...pages].sort((x, y) => x - y).slice(0, max);
    const out: PagePreview[] = [];
    for (const p of list) {
      out.push({
        page: p + 1,
        before: p < a.pageCount() ? a.renderPageSvg(p) : '',
        after: b.renderPageSvg(p),
      });
    }
    return out;
  } finally {
    a.free();
    b.free();
  }
}
