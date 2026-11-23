import JSZip from 'jszip';
import { DOMParser, type Element, type Node } from '@xmldom/xmldom';
import type { FormCell, FormDocument, FormTable, Paragraph, TextRun } from './types.ts';
import { DocumentBuilder } from './builder.ts';

/** HWPUNIT(1/7200인치) → mm */
const hwpToMm = (v: number) => Math.round((v / 7200) * 25.4 * 10) / 10;

interface CharShape { color?: string; italic: boolean; bold: boolean; underline: boolean; sizePt: number }

function children(el: Element | Node, local?: string): Element[] {
  const out: Element[] = [];
  for (let n = el.firstChild; n; n = n.nextSibling) {
    if (n.nodeType === 1 && (!local || (n as Element).localName === local)) out.push(n as Element);
  }
  return out;
}

function firstChild(el: Element, local: string): Element | undefined {
  return children(el, local)[0];
}

function parseHeader(xml: string) {
  const doc = new DOMParser().parseFromString(xml, 'text/xml');
  const charShapes = new Map<string, CharShape>();
  const fills = new Map<string, { face?: string; left: boolean; right: boolean }>();
  const all = doc.getElementsByTagName('*');
  for (let i = 0; i < all.length; i++) {
    const el = all[i]!;
    if (el.localName === 'charPr') {
      const ul = firstChild(el, 'underline');
      charShapes.set(el.getAttribute('id') ?? '', {
        color: el.getAttribute('textColor') ?? undefined,
        italic: !!firstChild(el, 'italic'),
        bold: !!firstChild(el, 'bold'),
        underline: !!ul && (ul.getAttribute('type') ?? 'NONE') !== 'NONE',
        sizePt: Number(el.getAttribute('height') ?? 1000) / 100,
      });
    } else if (el.localName === 'borderFill') {
      let face: string | undefined;
      const brush = el.getElementsByTagName('hc:winBrush')[0];
      if (brush) {
        const c = (brush.getAttribute('faceColor') ?? '').toUpperCase();
        if (c && c !== 'NONE' && c !== '#FFFFFF' && c !== '#FFFFFFFF') face = c;
      }
      const side = (name: string) => (firstChild(el, name)?.getAttribute('type') ?? 'NONE') !== 'NONE';
      fills.set(el.getAttribute('id') ?? '', { face, left: side('leftBorder'), right: side('rightBorder') });
    }
  }
  return { charShapes, fills };
}

/** HWPX 파일을 읽는다. HWP는 먼저 HWPX로 바꾼 뒤 이 함수로 읽는다(읽기 전용). */
export async function readHwpx(data: Uint8Array, format: 'hwp' | 'hwpx'): Promise<FormDocument> {
  const zip = await JSZip.loadAsync(data);
  const headerFile = zip.file('Contents/header.xml');
  if (!headerFile) throw new Error('HWPX 안에 header.xml이 없습니다.');
  const { charShapes, fills } = parseHeader(await headerFile.async('string'));

  const sectionNames = Object.keys(zip.files)
    .filter((n) => /^Contents\/section\d+\.xml$/.test(n))
    .sort((a, b) => Number(a.match(/\d+/)![0]) - Number(b.match(/\d+/)![0]));

  const builder = new DocumentBuilder(format);

  const readRun = (run: Element): TextRun | null => {
    let text = '';
    for (const t of children(run, 't')) {
      for (let n = t.firstChild; n; n = n.nextSibling) {
        if (n.nodeType === 3) text += n.nodeValue ?? '';
        else if (n.nodeType === 1) {
          const ln = (n as Element).localName;
          if (ln === 'tab') text += '\t';
          else if (ln === 'lineBreak') text += '\n';
          else if (ln === 'fwSpace' || ln === 'nbSpace') text += ' ';
        }
      }
    }
    if (!text) return null;
    const cs = charShapes.get(run.getAttribute('charPrIDRef') ?? '');
    return { text, color: cs?.color, italic: cs?.italic, bold: cs?.bold, underline: cs?.underline, sizePt: cs?.sizePt };
  };

  /** 문단의 글을 읽고, 문단 안에 든 표를 순서대로 돌려준다 */
  const readParagraph = (p: Element): { para: Paragraph; tables: Element[] } => {
    const runs: TextRun[] = [];
    const tables: Element[] = [];
    for (const run of children(p, 'run')) {
      const r = readRun(run);
      if (r) runs.push(r);
      for (const c of children(run)) {
        if (c.localName === 'tbl') tables.push(c);
      }
    }
    return { para: { text: runs.map((r) => r.text).join(''), runs }, tables };
  };

  const readTable = (tbl: Element, parentCellId?: string): FormTable => {
    const table = builder.startTable(Number(tbl.getAttribute('rowCnt')), Number(tbl.getAttribute('colCnt')), parentCellId);
    const nestedQueue: { el: Element; cell: FormCell }[] = [];
    for (const tr of children(tbl, 'tr')) {
      for (const tc of children(tr, 'tc')) {
        const addr = firstChild(tc, 'cellAddr');
        const span = firstChild(tc, 'cellSpan');
        const sz = firstChild(tc, 'cellSz');
        const fill = fills.get(tc.getAttribute('borderFillIDRef') ?? '');
        const row = Number(addr?.getAttribute('rowAddr') ?? 0);
        const col = Number(addr?.getAttribute('colAddr') ?? 0);
        const cell: FormCell = {
          id: `t${table.index}-r${row}-c${col}`,
          row,
          col,
          rowSpan: Number(span?.getAttribute('rowSpan') ?? 1),
          colSpan: Number(span?.getAttribute('colSpan') ?? 1),
          text: '',
          paragraphs: [],
          widthMm: sz ? hwpToMm(Number(sz.getAttribute('width'))) : undefined,
          heightMm: sz ? hwpToMm(Number(sz.getAttribute('height'))) : undefined,
          fillColor: fill?.face,
          sideBorders: fill ? { left: fill.left, right: fill.right } : undefined,
          nestedTableIndexes: [],
        };
        const subList = firstChild(tc, 'subList');
        for (const p of subList ? children(subList, 'p') : []) {
          const { para, tables } = readParagraph(p);
          cell.paragraphs.push(para);
          for (const t of tables) nestedQueue.push({ el: t, cell });
        }
        cell.text = cell.paragraphs.map((p) => p.text).join('\n').replace(/\s+$/, '');
        table.cells.push(cell);
      }
    }
    table.cells.sort((a, b) => a.row - b.row || a.col - b.col);
    builder.finishTable(table);
    for (const { el, cell } of nestedQueue) {
      const nested = readTable(el, cell.id);
      cell.nestedTableIndexes.push(nested.index);
    }
    return table;
  };

  for (const name of sectionNames) {
    const xml = await zip.file(name)!.async('string');
    const doc = new DOMParser().parseFromString(xml, 'text/xml');
    const sec = doc.documentElement;
    if (!sec) continue;
    for (const p of children(sec, 'p')) {
      const { para, tables } = readParagraph(p);
      builder.addBodyParagraph(para);
      for (const t of tables) readTable(t);
    }
  }
  return builder.build();
}
