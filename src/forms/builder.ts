import type { FormDocument, FormFormat, FormTable, Paragraph } from './types.ts';

/** 표 밖 문단 중 담당자가 채우거나 체크할 자리가 있는 문단을 고르는 기준 */
export const BODY_FILL_PATTERN = /[□☐▢]|년\s{2,}월\s{2,}일|\(\s*(서명|인)\s*\)|서명\s*:|:\s{3,}/;
const BRACKET_TITLE = /^\s*\[[^\]]{1,20}\]\s*\S/;

/** 문서를 읽어 가며 표 번호, 양식 제목, 앞 문단을 붙인다. HWPX·DOCX 읽기에서 함께 쓴다. */
export class DocumentBuilder {
  private tables: FormTable[] = [];
  private body: FormDocument['bodyParagraphs'] = [];
  private recent: string[] = [];
  private groupTitle?: string;
  private bracketSeen = false;
  private bodyCount = 0;
  warnings: string[] = [];

  constructor(private format: FormFormat, private pageCount?: number) {}

  addBodyParagraph(p: Paragraph) {
    const text = p.text.trim();
    if (!text) return;
    const maxSize = Math.max(0, ...p.runs.map((r) => r.sizePt ?? 0));
    if (BRACKET_TITLE.test(text)) {
      this.groupTitle = text;
      this.bracketSeen = true;
    } else if (!this.bracketSeen && maxSize >= 14 && text.length <= 40) {
      this.groupTitle = text;
    }
    this.recent.push(text);
    if (this.recent.length > 3) this.recent.shift();
    if (BODY_FILL_PATTERN.test(text)) {
      this.body.push({ id: `p${this.bodyCount}`, groupTitle: this.groupTitle, paragraph: p });
    }
    this.bodyCount++;
  }

  startTable(rows: number, cols: number, parentCellId?: string): FormTable {
    const t: FormTable = {
      index: this.tables.length,
      parentCellId,
      groupTitle: this.groupTitle,
      precedingTexts: parentCellId ? [] : [...this.recent],
      rows,
      cols,
      cells: [],
    };
    this.tables.push(t);
    return t;
  }

  finishTable(_t: FormTable) {
    // 표가 끝나면 앞 문단 기록을 비워 다음 표가 앞 표의 문단을 물려받지 않게 한다
    if (!_t.parentCellId) this.recent = [];
  }

  build(): FormDocument {
    return { format: this.format, pageCount: this.pageCount, tables: this.tables, bodyParagraphs: this.body, warnings: this.warnings };
  }
}
