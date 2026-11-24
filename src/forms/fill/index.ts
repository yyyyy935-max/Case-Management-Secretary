import { readForm } from '../read.ts';
import { classifyForm, type CellRole } from '../classify.ts';
import type { FillRequest, FillResult } from './types.ts';
import { planFill } from './plan.ts';
import { fillHwp } from './hwp.ts';
import { fillHwpx } from './hwpx.ts';
import { fillDocx } from './docx.ts';

/**
 * 양식 채우기. 원본과 같은 형식의 파일을 돌려준다(절대 규칙 1).
 * overrides: 담당자가 고친 칸 역할(양식 템플릿)
 */
export async function fillForm(original: Uint8Array, req: FillRequest, overrides: Record<string, CellRole> = {}): Promise<FillResult> {
  const form = await readForm(original);
  const cls = classifyForm(form, overrides);
  const { plans, skipped } = planFill(form, cls.cells, req);
  let result: FillResult;
  switch (form.format) {
    case 'hwp':
      result = await fillHwp(original, form, plans, req);
      break;
    case 'hwpx':
      result = await fillHwpx(original, form, plans, req);
      break;
    case 'docx':
      result = await fillDocx(original, form, plans, req);
      break;
  }
  return { ...result, skipped: [...skipped, ...result.skipped] };
}

export type { FillRequest, FillResult, FillValue } from './types.ts';
