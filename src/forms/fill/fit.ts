import type { FormCell } from '../types.ts';

/**
 * 칸 크기에 글이 들어가는지 어림한다(요구사항 4.2 좁은 칸 줄바꿈 문제).
 * 한글·한자는 글자 크기의 1배, 영문·숫자는 0.55배, 띄어쓰기는 0.3배 폭으로 보고,
 * 칸 안쪽 여백은 좌우 1.8mm, 줄 간격은 글자 크기의 160%로 본다.
 */
const PT_TO_MM = 0.3528;

function widthEm(line: string): number {
  let w = 0;
  for (const ch of line) {
    if (/\s/.test(ch)) w += 0.3;
    else if (/[ -~]/.test(ch)) w += 0.55;
    else w += 1;
  }
  return w;
}

export interface FitEstimate {
  /** 한 줄에 들어가는 한글 글자 수 */
  charsPerLine: number;
  /** 칸 높이에 들어가는 줄 수 */
  linesAvailable: number;
  /** 이 글이 차지할 줄 수 */
  linesNeeded: number;
}

export function estimateFit(cell: FormCell, text: string): FitEstimate | undefined {
  if (!cell.widthMm) return undefined;
  const sizePt = cell.paragraphs.flatMap((p) => p.runs).find((r) => r.sizePt)?.sizePt ?? 10;
  const em = sizePt * PT_TO_MM;
  const inner = Math.max(cell.widthMm - 3.6, em);
  const charsPerLine = Math.max(1, Math.floor(inner / em));
  const linesAvailable = Math.max(1, Math.floor(((cell.heightMm ?? em * 1.6) - 1) / (em * 1.6)));
  const linesNeeded = text.split('\n').reduce((n, l) => n + Math.max(1, Math.ceil((widthEm(l) * em) / inner)), 0);
  return { charsPerLine, linesAvailable, linesNeeded };
}

/** 칸에 넣을 글이 넘치거나 좁은 칸에서 어색하게 줄바뀜할 때 경고 문구 */
export function fitWarning(cell: FormCell, text: string): string | undefined {
  const f = estimateFit(cell, text);
  if (!f) return undefined;
  const longest = Math.max(...text.split('\n').map(widthEm));
  if (f.linesNeeded > f.linesAvailable) {
    return `칸 높이보다 길어 칸이 늘어남(약 ${f.linesNeeded}줄 필요, 칸에는 ${f.linesAvailable}줄). 표가 다음 쪽으로 밀릴 수 있음`;
  }
  if (longest > f.charsPerLine && f.charsPerLine <= 12) {
    return `좁은 칸이라 줄이 바뀜(한 줄에 한글 약 ${f.charsPerLine}자). 더 짧게 쓰는 것이 좋음`;
  }
  return undefined;
}
