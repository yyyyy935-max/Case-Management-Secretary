import JSZip from 'jszip';
import type { Element } from '@xmldom/xmldom';
import type { FormDocument } from '../types.ts';
import type { FillRequest, FillResult, FillWarning } from './types.ts';
import type { CellPlan } from './plan.ts';
import { applySplices, applyZipMethods, boxPositionsInText, escXml, kids, locate, zipMethods, type Located, type Splice } from './xml-splice.ts';

/**
 * DOCX 채우기. word/document.xml에서 대상 칸의 문단 부분만 잘라 바꾸고, 나머지는 그대로 둔다.
 * 한계: Word 내용 컨트롤 체크박스(w14:checkbox)나 기호 글꼴(w:sym)로 만든 체크박스는 아직 다루지 않는다.
 */

const wval = (el: Element | undefined) => el?.getAttribute('w:val') ?? undefined;

/** 읽기(readDocx)와 같이 내용 컨트롤(w:sdt)을 펼쳐 문단·표를 순서대로 */
function blockChildren(el: Element): Element[] {
  const out: Element[] = [];
  for (const c of kids(el)) {
    if (c.localName === 'p' || c.localName === 'tbl') out.push(c);
    else if (c.localName === 'sdt') {
      const content = kids(c, 'sdtContent')[0];
      if (content) out.push(...blockChildren(content));
    }
  }
  return out;
}

function collectTables(body: Element): Element[] {
  const out: Element[] = [];
  const visit = (tbl: Element) => {
    out.push(tbl);
    const nested: Element[] = [];
    for (const tr of kids(tbl, 'tr')) for (const tc of kids(tr, 'tc')) for (const b of blockChildren(tc)) if (b.localName === 'tbl') nested.push(b);
    for (const n of nested) visit(n);
  };
  for (const b of blockChildren(body)) if (b.localName === 'tbl') visit(b);
  return out;
}

/** 읽기와 같은 방법으로 열 번호를 세어 (행, 열)의 칸을 찾는다 */
function findCell(tbl: Element, row: number, col: number): Element | undefined {
  const tr = kids(tbl, 'tr')[row];
  if (!tr) return undefined;
  let c = Number(wval(kids(kids(tr, 'trPr')[0] ?? tr, 'gridBefore')[0]) ?? 0);
  for (const tc of kids(tr, 'tc')) {
    const pr = kids(tc, 'tcPr')[0];
    const span = Number(wval(pr ? kids(pr, 'gridSpan')[0] : undefined) ?? 1);
    if (c === col) return tc;
    c += span;
  }
  return undefined;
}

function isGuideRPr(rpr: string): boolean {
  if (/<w:(i|b|strike|dstrike)(\s+w:val="(true|1|on)")?\s*\/>/.test(rpr)) return true;
  const u = rpr.match(/<w:u\s+w:val="([^"]+)"/);
  if (u && u[1] !== 'none') return true;
  const col = rpr.match(/<w:color\s+w:val="([0-9A-Fa-f]{6})"/)?.[1];
  if (!col) return false;
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(col.slice(i, i + 2), 16));
  const max = Math.max(r!, g!, b!);
  return max - Math.min(r!, g!, b!) <= 24 && max >= 0x66 && max <= 0xe0;
}

/** 글자 서식에서 안내용 서식(색, 기울임, 굵게, 밑줄)을 뺀다 */
const normalRPr = (rpr: string) =>
  rpr.replace(/<w:(color|i|iCs|b|bCs|u|strike|dstrike)(\s[^>]*)?\/>/g, '').replace(/<w:(color|u)(\s[^>]*)?>[\s\S]*?<\/w:\1>/g, '');

export async function fillDocx(original: Uint8Array, form: FormDocument, plans: CellPlan[], req: FillRequest): Promise<FillResult> {
  const zip = await JSZip.loadAsync(original);
  const methods = zipMethods(zip);
  const name = 'word/document.xml';
  const xml = await zip.file(name)!.async('string');
  const loc: Located = locate(xml);
  const body = loc.doc.getElementsByTagName('w:body')[0];
  if (!body) throw new Error('DOCX 본문을 찾지 못했습니다.');
  const tables = collectTables(body);
  if (tables.length !== form.tables.length) throw new Error(`표 개수가 맞지 않습니다(읽기 ${form.tables.length}개, 쓰기 ${tables.length}개).`);
  const raw = (el: Element) => { const r = loc.rangeOf(el); return xml.slice(r.start, r.end); };

  const splices: Splice[] = [];
  const applied: string[] = [];
  const skipped: FillWarning[] = [];
  const warnings: FillWarning[] = [];

  for (const plan of plans) {
    try {
      const tc = findCell(tables[plan.tableIndex]!, plan.cell.row, plan.cell.col);
      if (!tc) throw new Error('칸을 찾지 못함');
      const tcRange = loc.rangeOf(tc);
      if (plan.kind === 'check') {
        const positions = boxPositionsInText(xml, tcRange.start, tcRange.end, 't');
        const cps = [...plan.cell.text];
        const isBox = (c: string) => /[□☐▢◻\u{F02EB}]/u.test(c);
        if (positions.length !== cps.filter(isBox).length) throw new Error('체크 기호 위치가 맞지 않음');
        for (const idx of plan.boxIndexes) {
          const pos = positions[cps.slice(0, idx).filter(isBox).length]!;
          const len = [...xml.slice(pos, pos + 2)][0]!.length;
          splices.push({ start: pos, end: pos + len, text: escXml(req.checkMark) });
        }
      } else {
        const paras = kids(tc).filter((c) => c.localName === 'p');
        if (!paras.length) throw new Error('칸에 문단이 없음');
        const first = loc.rangeOf(paras[0]!);
        const last = loc.rangeOf(paras[paras.length - 1]!);
        // 첫 문단과 끝 문단 사이에 문단 말고 다른 요소(책갈피 등)가 있으면 지워질 수 있으므로 쓰지 않는다
        const between = kids(tc).filter((c) => { const r = loc.rangeOf(c); return r.start > first.start && r.start < last.end && c.localName !== 'p'; });
        if (between.length) throw new Error('칸 안에 문단이 아닌 요소가 있음');
        const pPrOf = (p: Element) => { const pr = kids(p, 'pPr')[0]; return pr ? raw(pr) : ''; };
        const rPrOf = (p: Element) => {
          const r = p.getElementsByTagName('w:r')[0];
          const rpr = r ? kids(r, 'rPr')[0] : undefined;
          if (rpr) return raw(rpr);
          // 글이 없는 문단은 문단 기호의 서식(pPr 안 rPr)을 쓴다
          const markRPr = kids(kids(p, 'pPr')[0] ?? p, 'rPr')[0];
          return markRPr ? raw(markRPr).replace(/<w:(ins|del|moveFrom|moveTo)\s[^>]*\/>/g, '') : '';
        };
        let guidePPr: string | undefined;
        if (plan.role === 'guide' && paras.length > 1) {
          const counts = new Map<string, number>();
          for (const p of paras) counts.set(pPrOf(p), (counts.get(pPrOf(p)) ?? 0) + 1);
          guidePPr = [...counts].sort((a, b) => b[1] - a[1])[0]?.[0];
        }
        const normalize = plan.normalize || isGuideRPr(rPrOf(paras[0]!));
        const lines = plan.text.split('\n');
        const out = lines.map((line, k) => {
          const base = paras[Math.min(k, paras.length - 1)]!;
          const r = loc.rangeOf(base);
          let open = xml.slice(r.start, r.openEnd);
          if (open.endsWith('/>')) open = open.slice(0, -2) + '>';
          const pPr = guidePPr ?? pPrOf(base);
          let rPr = rPrOf(base);
          if (normalize) rPr = normalRPr(rPr);
          if (/^<w:rPr\s*\/>$|^<w:rPr>\s*<\/w:rPr>$/.test(rPr)) rPr = '';
          const run = line ? `<w:r>${rPr}<w:t xml:space="preserve">${escXml(line)}</w:t></w:r>` : '';
          return `${open}${pPr}${run}</w:p>`;
        });
        splices.push({ start: first.start, end: last.end, text: out.join('') });
      }
      applied.push(plan.cell.id);
      warnings.push(...plan.warnings.map((message) => ({ id: plan.cell.id, message })));
    } catch (err) {
      skipped.push({ id: plan.cell.id, message: `쓰지 못함: ${err instanceof Error ? err.message : '알 수 없는 오류'}` });
    }
  }
  if (splices.length) zip.file(name, applySplices(xml, splices), { createFolders: false });
  applyZipMethods(zip, methods);
  const data = await zip.generateAsync({ type: 'uint8array', compressionOptions: { level: 6 } });
  return { format: 'docx', data, applied, skipped, warnings };
}
