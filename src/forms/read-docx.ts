import JSZip from 'jszip';
import { DOMParser, type Element } from '@xmldom/xmldom';
import type { FormCell, FormDocument, FormTable, Paragraph, TextRun } from './types.ts';
import { DocumentBuilder } from './builder.ts';

const twipToMm = (v: number) => Math.round((v / 1440) * 25.4 * 10) / 10;

function kids(el: Element, local?: string): Element[] {
  const out: Element[] = [];
  for (let n = el.firstChild; n; n = n.nextSibling) {
    if (n.nodeType === 1 && (!local || (n as Element).localName === local)) out.push(n as Element);
  }
  return out;
}
const kid = (el: Element | undefined, local: string) => (el ? kids(el, local)[0] : undefined);
const wval = (el: Element | undefined) => el?.getAttribute('w:val') ?? undefined;
const isOn = (el: Element | undefined) => !!el && !['0', 'false', 'none'].includes(wval(el) ?? 'true');

/** 내용 컨트롤(w:sdt) 등으로 싸인 블록을 펼쳐 문단·표를 순서대로 돌려준다 */
function blockChildren(el: Element): Element[] {
  const out: Element[] = [];
  for (const c of kids(el)) {
    if (c.localName === 'p' || c.localName === 'tbl') out.push(c);
    else if (c.localName === 'sdt') {
      const content = kid(c, 'sdtContent');
      if (content) out.push(...blockChildren(content));
    }
  }
  return out;
}

function readRun(r: Element): TextRun | null {
  let text = '';
  for (const c of kids(r)) {
    if (c.localName === 't') text += c.textContent ?? '';
    else if (c.localName === 'tab') text += '\t';
    else if (c.localName === 'br' || c.localName === 'cr') text += '\n';
  }
  if (!text) return null;
  const pr = kid(r, 'rPr');
  const color = wval(kid(pr, 'color'));
  const sz = wval(kid(pr, 'sz'));
  const u = kid(pr, 'u');
  return {
    text,
    color: color && color !== 'auto' ? `#${color.toUpperCase()}` : undefined,
    italic: isOn(kid(pr, 'i')),
    bold: isOn(kid(pr, 'b')),
    underline: !!u && wval(u) !== 'none',
    sizePt: sz ? Number(sz) / 2 : undefined,
  };
}

function readParagraph(p: Element): Paragraph {
  const runs: TextRun[] = [];
  const walk = (el: Element) => {
    for (const c of kids(el)) {
      if (c.localName === 'r') {
        const r = readRun(c);
        if (r) runs.push(r);
      } else if (c.localName !== 'pPr' && c.localName !== 'tbl') walk(c);
    }
  };
  walk(p);
  return { text: runs.map((r) => r.text).join(''), runs };
}

/** DOCX 파일을 읽는다. 스타일 상속(문서 기본 글꼴 등)은 반영하지 않고 글자에 직접 준 서식만 읽는다. */
export async function readDocx(data: Uint8Array): Promise<FormDocument> {
  const zip = await JSZip.loadAsync(data);
  const docFile = zip.file('word/document.xml');
  if (!docFile) throw new Error('DOCX 안에 word/document.xml이 없습니다.');
  const doc = new DOMParser().parseFromString(await docFile.async('string'), 'text/xml');
  const body = doc.getElementsByTagName('w:body')[0];
  if (!body) throw new Error('DOCX 본문을 찾지 못했습니다.');
  const builder = new DocumentBuilder('docx');

  const readTable = (tbl: Element, parentCellId?: string): FormTable => {
    const gridCols = kids(kid(tbl, 'tblGrid') ?? tbl, 'gridCol').length;
    const trs = kids(tbl, 'tr');
    const table = builder.startTable(trs.length, gridCols, parentCellId);
    /** 열 번호 → 위에서 이어지는(세로 병합) 셀 */
    const openVertical = new Map<number, FormCell>();
    const nested: { el: Element; cell: FormCell }[] = [];
    let maxCol = 0;
    trs.forEach((tr, row) => {
      let col = Number(wval(kid(kid(tr, 'trPr'), 'gridBefore')) ?? 0);
      for (const tc of kids(tr, 'tc')) {
        const pr = kid(tc, 'tcPr');
        const span = Number(wval(kid(pr, 'gridSpan')) ?? 1);
        const vm = kid(pr, 'vMerge');
        const vmVal = vm ? (wval(vm) ?? 'continue') : undefined;
        if (vmVal === 'continue' && openVertical.has(col)) {
          openVertical.get(col)!.rowSpan += 1;
          col += span;
          continue;
        }
        const w = kid(pr, 'tcW');
        const fill = kid(pr, 'shd')?.getAttribute('w:fill')?.toUpperCase();
        const cell: FormCell = {
          id: `t${table.index}-r${row}-c${col}`,
          row,
          col,
          rowSpan: 1,
          colSpan: span,
          text: '',
          paragraphs: [],
          widthMm: w && w.getAttribute('w:type') === 'dxa' ? twipToMm(Number(w.getAttribute('w:w'))) : undefined,
          fillColor: fill && fill !== 'AUTO' && fill !== 'FFFFFF' ? `#${fill}` : undefined,
          nestedTableIndexes: [],
        };
        for (const b of blockChildren(tc)) {
          if (b.localName === 'p') cell.paragraphs.push(readParagraph(b));
          else nested.push({ el: b, cell });
        }
        cell.text = cell.paragraphs.map((p) => p.text).join('\n').replace(/\s+$/, '');
        table.cells.push(cell);
        for (let c = col; c < col + span; c++) openVertical.delete(c);
        if (vmVal === 'restart') openVertical.set(col, cell);
        col += span;
      }
      maxCol = Math.max(maxCol, col);
    });
    if (!table.cols) table.cols = maxCol;
    builder.finishTable(table);
    for (const { el, cell } of nested) cell.nestedTableIndexes.push(readTable(el, cell.id).index);
    return table;
  };

  for (const b of blockChildren(body)) {
    if (b.localName === 'p') builder.addBodyParagraph(readParagraph(b));
    else readTable(b);
  }
  return builder.build();
}
