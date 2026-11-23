import type { FormCell, FormDocument, FormTable, Paragraph } from './types.ts';

/** 요구사항 4.1의 칸 역할 */
export type CellRole = 'label' | 'input' | 'checkbox_group' | 'guide' | 'judgment' | 'signature' | 'personal' | 'fixed';

export const ROLE_NAMES: Record<CellRole, string> = {
  label: '항목명',
  input: '입력칸',
  checkbox_group: '선택 묶음',
  guide: '안내문 칸',
  judgment: '판단 칸',
  signature: '서명·동의',
  personal: '인적사항',
  fixed: '고정 문구',
};

export interface CellClassification {
  /** 셀 id(t3-r2-c1) 또는 본문 문단 id(p17) */
  id: string;
  tableIndex?: number;
  role: CellRole;
  /** 이렇게 분류한 이유 */
  reason: string;
  /** 같은 행에서 찾은 항목명 */
  rowLabel?: string;
  /** 같은 열 위쪽에서 찾은 항목명 */
  colLabel?: string;
  /** 입력칸 안에 미리 인쇄된 글이 있는 경우: template(괄호·밑줄 빈자리), prompt(작성 항목 안내) */
  inputKind?: 'blank' | 'template' | 'prompt';
  /** 담당자가 확인해야 할 점 */
  warning?: string;
}

export interface FormClassification {
  cells: CellClassification[];
  body: CellClassification[];
}

// ── 글자 판별 ──────────────────────────────────────────────

/** □ 등 체크 기호. 한글 문서의 사용자 정의 기호(사설 영역 문자, 예: 󰋫)도 포함 */
const CHECKBOX = /[□☐▢-\u{F0000}-\u{FFFFD}]/u;
/** 괄호 안 빈칸, 밑줄 빈칸, ':' 뒤 빈칸, '   만원' 같은 단위 앞 빈칸 */
const BLANK_SLOT = /_{2,}|\(\s{2,}[^)]*\)|\([^)]*\s{2,}\)|:\s*$|:\s{2,}|\s{2,}(만원|명|세|점|회차|회|급|개|원)/m;
const DATE_SLOT = /년\s{2,}월\s{2,}일|20\s{2,}년/;
const SIGN_SLOT = /\(\s*(서명|인|직인|서명\s*또는\s*인)\s*\)/;
/** "방문/내방/전화/기타"처럼 하나를 고르는 목록 */
const SLASH_CHOICES = /^[\s가-힣]+(\/[\s가-힣]+){2,}$/;
const CONSENT = /동의/;

const norm = (s: string) => s.replace(/\s+/g, '');

const JUDGMENT_LABELS: [RegExp, string][] = [
  [/선정/, '선정 여부'],
  [/욕구수준/, '욕구수준 점수'],
  [/우선순위/, '우선순위'],
  [/여력/, '사례관리 여력'],
  [/사례관리수준/, '사례관리 수준 결정'],
  [/면접결과/, '면접 결과(선정 여부)'],
  [/점검결과/, '점검 결과 결정'],
  [/평가결과/, '평가 결과 결정'],
  [/달성도/, '목표 달성도 평가'],
  [/추후계획/, '사후관리 후 결정(종결확정·재개입 등)'],
  [/^슈퍼비전(의견)?$/, '슈퍼바이저 의견'],
];
const PERSONAL_LABELS = /^(성명|이름|본인성명|대상자|대상자성명|클라이언트성명|생년월일|생년월일\(나이\)|주민등록번호|주민번호|연락처|전화번호|휴대폰|휴대전화|핸드폰|주소|연락처\/주소)$/;

function judgmentOf(...texts: (string | undefined)[]): string | undefined {
  for (const t of texts) {
    if (!t) continue;
    const n = norm(t);
    for (const [re, why] of JUDGMENT_LABELS) if (re.test(n)) return why;
  }
  return undefined;
}

/** 회색 글자이거나 기울임꼴인 글이 대부분이면 안내 문구로 본다 */
function isGuideStyled(paragraphs: Paragraph[]): boolean {
  let styled = 0;
  let total = 0;
  for (const p of paragraphs) {
    for (const r of p.runs) {
      const n = norm(r.text).length;
      if (!n) continue;
      total += n;
      if (r.italic || isGray(r.color)) styled += n;
    }
  }
  return total > 0 && styled / total >= 0.6;
}

function isGray(color?: string): boolean {
  if (!color || !/^#[0-9A-Fa-f]{6}/.test(color)) return false;
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(color.slice(i, i + 2), 16));
  const max = Math.max(r!, g!, b!);
  const min = Math.min(r!, g!, b!);
  // 무채색에 가깝고 검정보다 밝은 색(회색)
  return max - min <= 24 && max >= 0x66;
}

// ── 표 격자 ──────────────────────────────────────────────

class Grid {
  private at: (FormCell | undefined)[][];
  constructor(public table: FormTable) {
    this.at = Array.from({ length: table.rows }, () => Array<FormCell | undefined>(table.cols).fill(undefined));
    for (const c of table.cells) {
      for (let r = c.row; r < Math.min(c.row + c.rowSpan, table.rows); r++) {
        for (let k = c.col; k < Math.min(c.col + c.colSpan, table.cols); k++) this.at[r]![k] = c;
      }
    }
  }
  cell(r: number, c: number): FormCell | undefined {
    return this.at[r]?.[c];
  }
}

// ── 1차 판별: 셀 하나만 보고 ─────────────────────────────

type Kind = 'spacer' | 'empty' | 'container' | 'guide' | 'checkbox' | 'score' | 'template' | 'prompt' | 'sign' | 'text';

function isScoreRun(grid: Grid, cell: FormCell): boolean {
  if (!/^\d$/.test(cell.text.trim())) return false;
  // 같은 행에 한 자리 숫자 칸이 3개 이상 이어지면 점수 고르기 칸으로 본다 (예: 욕구수준 0 1 2 3)
  let run = 1;
  for (const dir of [-1, 1]) {
    let k = dir < 0 ? cell.col - 1 : cell.col + cell.colSpan;
    while (true) {
      const n = grid.cell(cell.row, k);
      if (!n || n === cell || !/^\d$/.test(n.text.trim())) break;
      run++;
      k = dir < 0 ? n.col - 1 : n.col + n.colSpan;
    }
  }
  return run >= 3;
}

function kindOf(grid: Grid, cell: FormCell): Kind {
  const text = cell.text.trim();
  if (cell.nestedTableIndexes.length && !text) return 'container';
  if (!text) return 'empty';
  if (isGuideStyled(cell.paragraphs)) return 'guide';
  if (SIGN_SLOT.test(text)) return 'sign';
  if (CHECKBOX.test(text)) return 'checkbox';
  if (isScoreRun(grid, cell)) return 'score';
  if (text.length <= 60 && (BLANK_SLOT.test(text) || DATE_SLOT.test(text))) return 'template';
  if (SLASH_CHOICES.test(text) && text.length <= 30) return 'checkbox';
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  if (lines.length >= 2 && lines.every((l) => /^[-·∙▪]/.test(l) && l.length <= 25)) return 'prompt';
  return 'text';
}

const FILLABLE: Kind[] = ['empty', 'guide', 'checkbox', 'score', 'template', 'prompt', 'sign'];

// ── 2차 판별: 항목명 찾기와 역할 정하기 ────────────────────

function findRowLabel(grid: Grid, cell: FormCell, kinds: Map<FormCell, Kind>): FormCell | undefined {
  for (let k = cell.col - 1; k >= 0; k--) {
    const n = grid.cell(cell.row, k);
    if (!n || n === cell) continue;
    if (kinds.get(n) === 'text') return n;
  }
  return undefined;
}

/** 라벨 칸이 입력칸의 열 범위를 모두 덮는지 (예: "접수일" 한 칸이 여섯 칸짜리 동의 칸의 항목명이 될 수는 없음) */
const covers = (label: FormCell, cell: FormCell) => label.col <= cell.col && label.col + label.colSpan >= cell.col + cell.colSpan;

function findColLabel(grid: Grid, cell: FormCell, kinds: Map<FormCell, Kind>): FormCell | undefined {
  for (let r = cell.row - 1; r >= 0; r--) {
    const n = grid.cell(r, cell.col);
    if (!n || n === cell) continue;
    if (kinds.get(n) === 'spacer') return undefined;
    if (kinds.get(n) === 'text') return covers(n, cell) ? n : undefined;
    // 위로 올라갈 때는 같은 폭으로 반복되는 입력 행(가족사항 1·2·3행 등)만 건너뛴다.
    // 폭이 다른 칸을 만나면 멈춘다. 계속 올라가면 몇 행 위의 관계없는 제목을 항목명으로 잘못 잡음.
    if (n.col !== cell.col || n.colSpan !== cell.colSpan) return undefined;
  }
  return undefined;
}

function classifyTable(table: FormTable, tables: FormTable[]): CellClassification[] {
  const grid = new Grid(table);
  const kinds = new Map<FormCell, Kind>();
  for (const c of table.cells) kinds.set(c, kindOf(grid, c));

  const out = new Map<FormCell, CellClassification>();
  const usedAsLabel = new Set<FormCell>();

  // 보이지 않는 간격 줄: 한 행 전체가 빈칸이고 세로 테두리가 없는 행 (표와 표 사이를 띄우는 용도)
  const rowsOf = new Map<number, FormCell[]>();
  for (const c of table.cells) rowsOf.set(c.row, [...(rowsOf.get(c.row) ?? []), c]);
  for (const [, cells] of rowsOf) {
    // 칸이 하나뿐인 행은 표 바깥 세로선이 없는 양식에서도 테두리가 없으므로, 높이가 낮을 때만 간격 줄로 본다
    const thin = cells.length >= 2 || cells.every((c) => (c.heightMm ?? 99) < 6);
    const spacer = thin && cells.length > 0 && cells.every((c) => !c.text.trim() && !c.nestedTableIndexes.length && c.rowSpan === 1 && c.sideBorders && !c.sideBorders.left && !c.sideBorders.right);
    if (spacer) for (const c of cells) {
      kinds.set(c, 'spacer');
      out.set(c, { id: c.id, tableIndex: table.index, role: 'fixed', reason: '세로 테두리가 없는 빈 행. 표 사이를 띄우는 간격 줄로 봄' });
    }
  }

  for (const cell of table.cells) {
    if (out.has(cell)) continue;
    const kind = kinds.get(cell)!;
    if (kind === 'container') {
      const inner = cell.nestedTableIndexes.map((i) => `표 ${i}`).join(', ');
      out.set(cell, { id: cell.id, tableIndex: table.index, role: 'fixed', reason: `안쪽 표(${inner})를 담은 칸. 안쪽 표에서 따로 분류함` });
      continue;
    }
    if (!FILLABLE.includes(kind)) continue;

    const rowL = findRowLabel(grid, cell, kinds);
    const colL = findColLabel(grid, cell, kinds);
    if (rowL) usedAsLabel.add(rowL);
    if (colL) usedAsLabel.add(colL);
    const rowLabel = rowL?.text.replace(/\s+/g, ' ').trim();
    const colLabel = colL?.text.replace(/\s+/g, ' ').trim();
    const text = cell.text.trim();
    const base = { id: cell.id, tableIndex: table.index, rowLabel, colLabel };
    const labelsTxt = [rowLabel, colLabel].filter(Boolean).join(' / ') || '없음';

    // 서명 자리
    if (kind === 'sign') {
      out.set(cell, { ...base, role: 'signature', reason: `서명·날인 자리 "${text}"` });
      continue;
    }
    // 동의 체크
    if (kind === 'checkbox' && (CONSENT.test(text) || CONSENT.test(rowLabel ?? '') || CONSENT.test(colLabel ?? '') || /^(필수|선택)\s*[□☐▢]/.test(text))) {
      out.set(cell, { ...base, role: 'signature', reason: '대상자 동의를 체크하는 칸' });
      continue;
    }
    // 점수 고르기
    if (kind === 'score') {
      const why = judgmentOf(colLabel, rowLabel) ?? (/그렇다|않다|보통/.test(colLabel ?? '') ? '만족도 점수(대상자가 직접 고름)' : '점수 고르기');
      out.set(cell, { ...base, role: 'judgment', reason: `${why}: 숫자 중 하나를 고르는 칸` });
      continue;
    }
    // 판단 칸 (항목명 또는 칸 안 글로 판단)
    const jWhy = judgmentOf(rowLabel, colLabel) ?? (kind === 'checkbox' ? judgmentOf(text) : undefined);
    if (jWhy) {
      out.set(cell, { ...base, role: 'judgment', reason: `${jWhy} (항목명: ${labelsTxt})` });
      continue;
    }
    // 순위가 인쇄된 행의 욕구영역 칸 = 우선순위 정하기
    if (rowL && /^\d+$/.test(rowL.text.trim()) && /영역/.test(norm(colLabel ?? ''))) {
      let rankHeader: FormCell | undefined;
      for (let r = rowL.row - 1; r >= 0 && !rankHeader; r--) {
        const n = grid.cell(r, rowL.col);
        if (n && n !== rowL && kinds.get(n) === 'text' && !/^\d+$/.test(n.text.trim())) rankHeader = n;
      }
      if (rankHeader && /순위/.test(norm(rankHeader.text))) {
        usedAsLabel.add(rankHeader);
        out.set(cell, { ...base, role: 'judgment', reason: `${rowL.text.trim()}순위 욕구영역 정하기(우선순위)` });
        continue;
      }
    }
    // 안내 문구
    if (kind === 'guide') {
      out.set(cell, { ...base, role: 'guide', reason: '회색 또는 기울임 글씨의 안내 문구. 지우고 써야 하는 칸' });
      continue;
    }
    // 인적사항
    const personal = [rowL, colL].find((l) => {
      if (!l) return false;
      const n = norm(l.text);
      // "클라이언트"는 배경색이 있는 항목명일 때만 이름 칸으로 본다(역할 구분 행의 "클라이언트"와 구별)
      if (n === '클라이언트') return !!l.fillColor;
      return PERSONAL_LABELS.test(n);
    }) ?? (/성명\s*:/.test(text) ? cell : undefined);
    if (personal) {
      out.set(cell, { ...base, role: 'personal', reason: `인적·식별 정보 (항목명: ${personal === cell ? '칸 안의 성명·연락처 항목' : norm(personal.text)}). 사례 카드에 담당자가 입력한 값만 씀` });
      continue;
    }
    if (kind === 'checkbox') {
      out.set(cell, { ...base, role: 'checkbox_group', reason: `선택지 묶음 (항목명: ${labelsTxt})` });
      continue;
    }
    const inputKind = kind === 'template' ? 'template' : kind === 'prompt' ? 'prompt' : 'blank';
    out.set(cell, {
      ...base,
      role: 'input',
      inputKind,
      reason:
        inputKind === 'template' ? `괄호·밑줄 등 빈자리가 인쇄된 입력칸 (항목명: ${labelsTxt})` :
        inputKind === 'prompt' ? `작성 항목이 인쇄된 입력칸. 항목은 두고 이어 쓰는 칸으로 봄 (항목명: ${labelsTxt})` :
        `빈 입력칸 (항목명: ${labelsTxt})`,
      warning: !rowL && !colL ? '항목명을 찾지 못함' : undefined,
    });
  }

  // 남은 글 칸: 입력칸의 항목명이거나 항목명 묶음의 제목이면 label, 아니면 fixed
  const isHeaderLike = (c: FormCell) => !!c.fillColor && norm(c.text).length <= 20;
  let changed = true;
  while (changed) {
    changed = false;
    for (const cell of table.cells) {
      if (out.has(cell) || usedAsLabel.has(cell) || kinds.get(cell) !== 'text') continue;
      // 여러 행에 걸친 묶음 제목(예: "만남일시", "가족관계"): 오른쪽 칸이 항목명이면 항목명 묶음 제목
      const right = grid.cell(cell.row, cell.col + cell.colSpan);
      const below = grid.cell(cell.row + cell.rowSpan, cell.col);
      const groupsRight = cell.rowSpan > 1 && right && usedAsLabel.has(right);
      const groupsBelow = cell.colSpan > 1 && below && usedAsLabel.has(below) && covers(cell, below);
      if (groupsRight || groupsBelow || (isHeaderLike(cell) && ((right && usedAsLabel.has(right)) || (below && usedAsLabel.has(below))))) {
        usedAsLabel.add(cell);
        changed = true;
      }
    }
  }
  for (const cell of table.cells) {
    if (out.has(cell)) continue;
    if (usedAsLabel.has(cell)) out.set(cell, { id: cell.id, tableIndex: table.index, role: 'label', reason: '입력칸의 항목명 또는 항목명 묶음의 제목' });
    else out.set(cell, { id: cell.id, tableIndex: table.index, role: 'fixed', reason: '채울 칸과 연결되지 않은 글(고정 문구)' });
  }
  void tables;
  return table.cells.map((c) => out.get(c)!);
}

function classifyBody(doc: FormDocument): CellClassification[] {
  return doc.bodyParagraphs.map((b) => {
    const text = b.paragraph.text.trim();
    if (SIGN_SLOT.test(text)) return { id: b.id, role: 'signature', reason: `본문의 서명·날인 자리` };
    if (CHECKBOX.test(text) && CONSENT.test(text)) return { id: b.id, role: 'signature', reason: '본문의 동의 체크' };
    if (CHECKBOX.test(text)) return { id: b.id, role: 'checkbox_group', reason: '본문의 선택지' };
    return { id: b.id, role: 'input', inputKind: 'template', reason: '본문의 날짜·빈칸' };
  });
}

/** 양식의 모든 칸 역할을 규칙으로 분류한다. AI는 쓰지 않는다. */
export function classifyForm(doc: FormDocument): FormClassification {
  return {
    cells: doc.tables.flatMap((t) => classifyTable(t, doc.tables)),
    body: classifyBody(doc),
  };
}
