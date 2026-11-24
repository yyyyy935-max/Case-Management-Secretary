import type { FormCell, FormDocument } from '../types.ts';
import type { CellClassification, CellRole } from '../classify.ts';
import type { FillRequest, FillWarning } from './types.ts';
import { findBoxes } from './checkbox.ts';
import { fitWarning } from './fit.ts';

/** 칸 하나를 어떻게 쓸지 정한 결과 */
export type CellPlan = {
  cell: FormCell;
  tableIndex: number;
  role: CellRole;
  warnings: string[];
} & ({ kind: 'text'; text: string; normalize: boolean } | { kind: 'check'; boxIndexes: number[] });

const NEVER_AUTO: CellRole[] = ['judgment', 'signature', 'personal'];

function isGrayOrItalic(color: string | undefined, italic: boolean | undefined) {
  if (italic) return true;
  if (!color || !/^#[0-9A-Fa-f]{6}/.test(color)) return false;
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(color.slice(i, i + 2), 16));
  return Math.max(r!, g!, b!) - Math.min(r!, g!, b!) <= 24 && Math.max(r!, g!, b!) >= 0x66 && Math.max(r!, g!, b!) <= 0xe0;
}

/**
 * 안내용 서식인지: 안내문 칸이거나, 칸의 첫 글자 모양이 회색·기울임·굵게·밑줄이면
 * 그 서식을 지우고 일반 서식으로 쓴다(요구사항 4.2의 안내 문구 서식, 굵은 밑줄 문제).
 */
function needsNormalStyle(cell: FormCell, role: CellRole): boolean {
  if (role === 'guide') return true;
  const first = cell.paragraphs.flatMap((p) => p.runs)[0];
  if (!first) return false;
  return isGrayOrItalic(first.color, first.italic) || !!first.bold || !!first.underline;
}

export function planFill(form: FormDocument, classes: CellClassification[], req: FillRequest): { plans: CellPlan[]; skipped: FillWarning[] } {
  const cls = new Map(classes.map((c) => [c.id, c]));
  const cellById = new Map<string, { cell: FormCell; tableIndex: number }>();
  for (const t of form.tables) for (const c of t.cells) cellById.set(c.id, { cell: c, tableIndex: t.index });
  const plans: CellPlan[] = [];
  const skipped: FillWarning[] = [];

  for (const [id, value] of Object.entries(req.values)) {
    const hit = cellById.get(id);
    const role = cls.get(id)?.role;
    if (!hit || !role) {
      skipped.push({ id, message: /^p\d+$/.test(id) ? '표 밖 문단 채우기는 아직 지원하지 않음' : '양식에 없는 칸' });
      continue;
    }
    if (req.source === 'ai' && NEVER_AUTO.includes(role)) {
      skipped.push({ id, message: '담당자 판단, 서명, 인적사항은 자동으로 채우지 않음' });
      continue;
    }
    if (role === 'label' || role === 'fixed') {
      skipped.push({ id, message: '항목 이름과 인쇄된 글은 바꾸지 않음' });
      continue;
    }
    if (hit.cell.nestedTableIndexes.length) {
      skipped.push({ id, message: '안에 작은 표가 있는 항목은 바꾸지 않음' });
      continue;
    }
    const warnings: string[] = [];
    if (value.check && value.check.length) {
      if (value.text !== undefined) {
        skipped.push({ id, message: '한 항목에 글과 체크를 함께 넣을 수 없음' });
        continue;
      }
      const { indexes, missing } = findBoxes(hit.cell.text, value.check);
      if (missing.length) warnings.push(`체크할 항목을 찾지 못함: ${missing.join(', ')}`);
      if (!indexes.length) {
        skipped.push({ id, message: `체크할 항목을 찾지 못함: ${value.check.join(', ')}` });
        continue;
      }
      plans.push({ cell: hit.cell, tableIndex: hit.tableIndex, role, warnings, kind: 'check', boxIndexes: indexes });
      continue;
    }
    if (value.text === undefined) {
      skipped.push({ id, message: '넣을 내용이 없음' });
      continue;
    }
    const text = value.text.replace(/\r\n?/g, '\n');
    const fw = fitWarning(hit.cell, text);
    if (fw) warnings.push(fw);
    plans.push({ cell: hit.cell, tableIndex: hit.tableIndex, role, warnings, kind: 'text', text, normalize: needsNormalStyle(hit.cell, role) });
  }
  return { plans, skipped };
}

/** 여러 줄이거나 40자를 넘는 글. 가운데 정렬 칸에 넣으면 양쪽 정렬로 바꾼다 */
export const isLongText = (t: string) => t.includes('\n') || [...t].length > 40;
