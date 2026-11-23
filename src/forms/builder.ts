import type { FormDocument, FormFormat, FormTable, Paragraph, TableKind } from './types.ts';

/** 표 밖 문단 중 담당자가 채우거나 체크할 자리가 있는 문단을 고르는 기준 */
export const BODY_FILL_PATTERN = /[□☐▢◻\u{F02EB}]|_{3,}|년\s{2,}월\s{2,}일|\(\s*(서명|인|직인)\s*\)|서명\s*[:：]|[:：]\s{3,}/u;

/** 양식 번호. 예: "[양식3]", "서식 6", "별지 제2호", "붙임 1", "참고 2" */
const FORM_NO = /^\s*[\[［<〈(]?\s*(양식|서식|별지|별첨|붙임|부록|참고)\s*(제\s*)?\d+\s*(호)?\s*(서식)?\s*[\]］>〉)]?/;
/** 본문 문단이 양식 제목인지: "[양식3] 인테이크 기록지", "[서식1] ..." 같은 대괄호 제목 또는 양식 번호로 시작하는 짧은 문단 */
const BRACKET_TITLE = /^\s*\[[^\]]{1,20}\]\s*\S/;

const INSTRUCTION_WORDS = /작성\s*방법|작성\s*요령|작성\s*안내|기재\s*방법|기재\s*요령/;
const EXAMPLE_WORDS = /작성\s*예시|기재\s*예시|작성\s*사례|예\s*시\s*\)|\(\s*예시\s*\)/;

/** 문서를 읽어 가며 표 번호, 양식 제목, 앞 문단, 표 종류를 붙인다. HWPX·DOCX 읽기에서 함께 쓴다. */
export class DocumentBuilder {
  private tables: FormTable[] = [];
  private body: FormDocument['bodyParagraphs'] = [];
  private recent: string[] = [];
  private groupTitle?: string;
  /** 번호가 붙은 양식 제목을 한 번이라도 봤는지. 보았으면 큰 글씨 문단을 제목으로 쓰지 않는다 */
  private numberedSeen = false;
  private bodyCount = 0;
  /** "작성 예시" 문단을 본 뒤 다음 양식 제목이나 "작성 방법" 문단이 나올 때까지는 표를 작성 예시로 본다 */
  private exampleMode = false;
  warnings: string[] = [];

  constructor(private format: FormFormat, private pageCount?: number) {}

  addBodyParagraph(p: Paragraph) {
    const text = p.text.trim();
    if (!text) return;
    const maxSize = Math.max(0, ...p.runs.map((r) => r.sizePt ?? 0));
    if (BRACKET_TITLE.test(text) || (FORM_NO.test(text) && text.length <= 40)) {
      this.groupTitle = text;
      this.numberedSeen = true;
      this.exampleMode = false;
    } else if (!this.numberedSeen && maxSize >= 14 && text.length <= 40) {
      this.groupTitle = text;
    }
    if (EXAMPLE_WORDS.test(text) && text.length <= 60) this.exampleMode = true;
    else if (INSTRUCTION_WORDS.test(text) && text.length <= 60) this.exampleMode = false;
    this.recent.push(text);
    if (this.recent.length > 3) this.recent.shift();
    if (BODY_FILL_PATTERN.test(text)) {
      this.body.push({ id: `p${this.bodyCount}`, groupTitle: this.groupTitle, paragraph: p });
    }
    this.bodyCount++;
  }

  startTable(rows: number, cols: number, parentCellId?: string): FormTable {
    const parent = parentCellId ? this.tables[Number(parentCellId.match(/^t(\d+)-/)?.[1])] : undefined;
    const t: FormTable = {
      index: this.tables.length,
      parentCellId,
      groupTitle: this.groupTitle,
      precedingTexts: parentCellId ? [] : [...this.recent],
      rows,
      cols,
      cells: [],
      // 셀 안 표는 바깥 표의 종류를 따른다 (작성 예시 표 안의 표는 작성 예시)
      kind: parent?.kind && parent.kind !== 'form' ? parent.kind : 'form',
    };
    this.tables.push(t);
    return t;
  }

  finishTable(t: FormTable) {
    if (!t.parentCellId) {
      const title = titleBarText(t);
      if (title) {
        // "서식 6 | | 서비스 의뢰서" 같은 제목 막대 표: 이 표부터 다음 양식 제목 전까지 같은 양식으로 묶는다
        this.groupTitle = title;
        this.numberedSeen = true;
        this.exampleMode = false;
        t.groupTitle = title;
        t.kind = 'title';
      } else if (t.kind === 'form') {
        t.kind = detectKind(t, this.exampleMode);
      }
      if (t.kind === 'form' && /^\s*(참고|부록)\s*\d/.test(this.groupTitle ?? '')) t.kind = 'reference';
      // 표가 끝나면 앞 문단 기록을 비워 다음 표가 앞 표의 문단을 물려받지 않게 한다
      this.recent = [];
    }
  }

  build(): FormDocument {
    return { format: this.format, pageCount: this.pageCount, tables: this.tables, bodyParagraphs: this.body, warnings: this.warnings };
  }
}

/** 한 행짜리 작은 표에 양식 번호가 있으면 제목 막대로 보고 제목 글을 돌려준다 */
function titleBarText(t: FormTable): string | undefined {
  if (t.rows !== 1 || t.cells.length > 4) return undefined;
  const texts = t.cells.map((c) => c.text.replace(/\s+/g, ' ').trim()).filter(Boolean);
  if (!texts.length || !FORM_NO.test(texts[0]!)) return undefined;
  const joined = texts.join(' ');
  return joined.length <= 60 ? joined : undefined;
}

function detectKind(t: FormTable, exampleMode: boolean): TableKind {
  const firstRow = t.cells.filter((c) => c.row === 0).map((c) => c.text.replace(/\s+/g, ''));
  const before = t.precedingTexts.join(' ');
  // 한 칸짜리 짧은 큰 글씨 표 = 양식 제목 상자
  if (t.cells.length === 1) {
    const c = t.cells[0]!;
    const size = Math.max(0, ...c.paragraphs.flatMap((p) => p.runs.map((r) => r.sizePt ?? 0)));
    if (c.text.trim() && c.text.trim().length <= 40 && size >= 12) return 'title';
  }
  if (firstRow.some((s) => INSTRUCTION_WORDS.test(s)) || INSTRUCTION_WORDS.test(t.precedingTexts.at(-1) ?? '')) return 'instructions';
  // ○○○ 같은 자리 표시 값만으로는 예시로 보지 않는다(실제 양식에도 자리 표시 값이 있음). "작성 예시" 문단이 있어야 한다.
  if (exampleMode || EXAMPLE_WORDS.test(before)) return 'example';
  return 'form';
}
