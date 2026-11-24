import JSZip from 'jszip';
import type { Element } from '@xmldom/xmldom';
import type { FormDocument } from '../types.ts';
import type { FillRequest, FillResult, FillWarning } from './types.ts';
import { isLongText, type CellPlan } from './plan.ts';
import { applySplices, applyZipMethods, boxPositionsInText, escXml, kids, locate, zipMethods, type Located, type Splice } from './xml-splice.ts';
import { loadRhwp } from './rhwp.ts';

/**
 * HWPX 채우기. 대상 칸의 문단 부분만 XML 글에서 잘라 바꾸고, 나머지 글과 압축 안의 다른 파일은 그대로 둔다.
 * 새 문단에는 줄 배치 정보(linesegarray)를 넣지 않는다. 한글이 열 때 다시 계산한다.
 */

interface CharPrInfo { id: string; range: { start: number; end: number }; color?: string; italic: boolean; bold: boolean; underline: boolean; strike: boolean }

function isGuideChar(c: CharPrInfo | undefined): boolean {
  if (!c) return false;
  if (c.italic || c.bold || c.underline || c.strike) return true;
  const col = c.color ?? '#000000';
  if (!/^#[0-9A-Fa-f]{6}/.test(col)) return false;
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(col.slice(i, i + 2), 16));
  const max = Math.max(r!, g!, b!);
  return max - Math.min(r!, g!, b!) <= 24 && max >= 0x66 && max <= 0xe0;
}

/** header.xml의 글자 모양을 읽고, 필요하면 "일반 서식" 글자 모양을 새로 만든다 */
class CharShapes {
  private loc: Located;
  private infos = new Map<string, CharPrInfo>();
  private added: string[] = [];
  private normalOf = new Map<string, string>();
  private maxId = 0;
  private propsEl?: Element;

  constructor(private xml: string) {
    this.loc = locate(xml);
    const all = this.loc.doc.getElementsByTagName('*');
    for (let i = 0; i < all.length; i++) {
      const el = all[i]!;
      if (el.localName === 'charProperties') this.propsEl = el;
      if (el.localName !== 'charPr') continue;
      const id = el.getAttribute('id') ?? '';
      const ul = kids(el, 'underline')[0];
      const r = this.loc.rangeOf(el);
      this.infos.set(id, {
        id,
        range: { start: r.start, end: r.end },
        color: el.getAttribute('textColor') ?? undefined,
        italic: kids(el, 'italic').length > 0,
        bold: kids(el, 'bold').length > 0,
        underline: !!ul && (ul.getAttribute('type') ?? 'NONE') !== 'NONE',
        strike: !!kids(el, 'strikeout')[0] && !['NONE', '3D'].includes(kids(el, 'strikeout')[0]!.getAttribute('shape') ?? 'NONE'),
      });
      this.maxId = Math.max(this.maxId, Number(id) || 0);
    }
  }

  get(id: string) { return this.infos.get(id); }

  /** 같은 글꼴·크기로 검정, 기울임·굵게·밑줄 없는 글자 모양 id */
  normal(id: string): string {
    const info = this.infos.get(id);
    if (!info || !isGuideChar(info)) return id;
    const cached = this.normalOf.get(id);
    if (cached) return cached;
    const src = this.xml.slice(info.range.start, info.range.end);
    const body = src
      .replace(/\stextColor="[^"]*"/, ' textColor="#000000"')
      .replace(/<([\w]+:)?italic\s*\/>/g, '')
      .replace(/<([\w]+:)?bold\s*\/>/g, '')
      .replace(/(<([\w]+:)?underline\s[^>]*?)type="[^"]*"/, '$1type="NONE"')
      .replace(/(<([\w]+:)?strikeout\s[^>]*?)shape="[^"]*"/, '$1shape="NONE"');
    const withoutId = (s: string) => s.replace(/\sid="[^"]*"/, '');
    // 이미 같은 모양이 있으면 그것을 쓴다
    for (const other of this.infos.values()) {
      if (withoutId(this.xml.slice(other.range.start, other.range.end)) === withoutId(body)) {
        this.normalOf.set(id, other.id);
        return other.id;
      }
    }
    const newId = String(++this.maxId);
    this.added.push(body.replace(/\sid="[^"]*"/, ` id="${newId}"`));
    this.normalOf.set(id, newId);
    return newId;
  }

  /** 새로 만든 글자 모양을 넣은 header.xml */
  output(): string {
    if (!this.added.length || !this.propsEl) return this.xml;
    const r = this.loc.rangeOf(this.propsEl);
    const open = this.xml.slice(r.start, r.openEnd);
    const count = Number(open.match(/itemCnt="(\d+)"/)?.[1] ?? NaN);
    const newOpen = Number.isFinite(count) ? open.replace(/itemCnt="\d+"/, `itemCnt="${count + this.added.length}"`) : open;
    return applySplices(this.xml, [
      { start: r.closeStart, end: r.closeStart, text: this.added.join('') },
      { start: r.start, end: r.openEnd, text: newOpen },
    ]);
  }
}

/** header.xml의 문단 모양. 가운데 정렬 문단 모양을 양쪽 정렬로 바꾼 것을 찾거나 새로 만든다 */
class ParaShapes {
  private bodies = new Map<string, string>();
  private added: string[] = [];
  private justifiedOf = new Map<string, string>();
  private maxId = 0;

  constructor(xml: string) {
    const loc = locate(xml);
    const all = loc.doc.getElementsByTagName('*');
    for (let i = 0; i < all.length; i++) {
      const el = all[i]!;
      if (el.localName !== 'paraPr') continue;
      const id = el.getAttribute('id') ?? '';
      const r = loc.rangeOf(el);
      this.bodies.set(id, xml.slice(r.start, r.end));
      this.maxId = Math.max(this.maxId, Number(id) || 0);
    }
  }

  isCenter(id: string) { return /<([\w]+:)?align\s[^>]*horizontal="CENTER"/.test(this.bodies.get(id) ?? ''); }

  justified(id: string): string {
    if (!this.isCenter(id)) return id;
    const cached = this.justifiedOf.get(id);
    if (cached) return cached;
    const body = this.bodies.get(id)!.replace(/(<([\w]+:)?align\s[^>]*?)horizontal="CENTER"/g, '$1horizontal="JUSTIFY"');
    const withoutId = (t: string) => t.replace(/\sid="[^"]*"/, '');
    for (const [otherId, other] of this.bodies) {
      if (withoutId(other) === withoutId(body)) { this.justifiedOf.set(id, otherId); return otherId; }
    }
    const newId = String(++this.maxId);
    this.added.push(body.replace(/\sid="[^"]*"/, ` id="${newId}"`));
    this.justifiedOf.set(id, newId);
    return newId;
  }

  /** 새로 만든 문단 모양을 넣은 header.xml (글자 모양을 넣은 뒤의 header에 적용) */
  output(xml: string): string {
    if (!this.added.length) return xml;
    const loc = locate(xml);
    const all = loc.doc.getElementsByTagName('*');
    let props: Element | undefined;
    for (let i = 0; i < all.length; i++) if (all[i]!.localName === 'paraProperties') { props = all[i]!; break; }
    if (!props) return xml;
    const r = loc.rangeOf(props);
    const open = xml.slice(r.start, r.openEnd);
    const count = Number(open.match(/itemCnt="(\d+)"/)?.[1] ?? NaN);
    const newOpen = Number.isFinite(count) ? open.replace(/itemCnt="\d+"/, `itemCnt="${count + this.added.length}"`) : open;
    return applySplices(xml, [
      { start: r.closeStart, end: r.closeStart, text: this.added.join('') },
      { start: r.start, end: r.openEnd, text: newOpen },
    ]);
  }
}

/** 읽기(readHwpx)와 같은 순서로 표를 번호 매긴다: 본문 문단 → 실행 → 표, 표 안에서는 칸을 다 읽은 뒤 셀 안 표 */
function collectTables(sections: { loc: Located }[]): { sec: number; el: Element }[] {
  const out: { sec: number; el: Element }[] = [];
  const visit = (sec: number, tbl: Element) => {
    out.push({ sec, el: tbl });
    const nested: Element[] = [];
    for (const tr of kids(tbl, 'tr')) for (const tc of kids(tr, 'tc')) {
      const sub = kids(tc, 'subList')[0];
      for (const p of sub ? kids(sub, 'p') : []) for (const run of kids(p, 'run')) for (const c of kids(run)) if (c.localName === 'tbl') nested.push(c);
    }
    for (const n of nested) visit(sec, n);
  };
  sections.forEach((s, sec) => {
    const root = s.loc.doc.documentElement;
    if (!root) return;
    for (const p of kids(root, 'p')) for (const run of kids(p, 'run')) for (const c of kids(run)) if (c.localName === 'tbl') visit(sec, c);
  });
  return out;
}

function findCell(tbl: Element, row: number, col: number): Element | undefined {
  for (const tr of kids(tbl, 'tr')) for (const tc of kids(tr, 'tc')) {
    const a = kids(tc, 'cellAddr')[0];
    if (Number(a?.getAttribute('rowAddr')) === row && Number(a?.getAttribute('colAddr')) === col) return tc;
  }
  return undefined;
}

const prefixOf = (el: Element) => (el.prefix ? `${el.prefix}:` : '');

async function pageCount(data: Uint8Array): Promise<number | undefined> {
  try {
    const rhwp = await loadRhwp();
    const d = new rhwp.HwpDocument(new Uint8Array(data));
    const n = d.pageCount();
    d.free();
    return n;
  } catch {
    return undefined;
  }
}

export async function fillHwpx(original: Uint8Array, form: FormDocument, plans: CellPlan[], req: FillRequest): Promise<FillResult> {
  const zip = await JSZip.loadAsync(original);
  const methods = zipMethods(zip);
  const headerName = 'Contents/header.xml';
  const chars = new CharShapes(await zip.file(headerName)!.async('string'));
  const paraShapes = new ParaShapes(await zip.file(headerName)!.async('string'));
  const names = Object.keys(zip.files)
    .filter((n) => /^Contents\/section\d+\.xml$/.test(n))
    .sort((a, b) => Number(a.match(/\d+/)![0]) - Number(b.match(/\d+/)![0]));
  const sections = await Promise.all(names.map(async (name) => {
    const xml = await zip.file(name)!.async('string');
    return { name, xml, loc: locate(xml), splices: [] as Splice[] };
  }));
  const tables = collectTables(sections);
  if (tables.length !== form.tables.length) throw new Error(`표 개수가 맞지 않습니다(읽기 ${form.tables.length}개, 쓰기 ${tables.length}개).`);

  const applied: string[] = [];
  const skipped: FillWarning[] = [];
  const warnings: FillWarning[] = [];

  for (const plan of plans) {
    try {
      const { sec, el: tbl } = tables[plan.tableIndex]!;
      const s = sections[sec]!;
      const tc = findCell(tbl, plan.cell.row, plan.cell.col);
      if (!tc) throw new Error('칸을 찾지 못함');
      const sub = kids(tc, 'subList')[0];
      const paras = sub ? kids(sub, 'p') : [];
      if (!paras.length) throw new Error('칸에 문단이 없음');
      const tcRange = s.loc.rangeOf(tc);

      if (plan.kind === 'check') {
        const positions = boxPositionsInText(s.xml, tcRange.start, tcRange.end, 't');
        const cps = [...plan.cell.text];
        const boxOrdinal = (idx: number) => cps.slice(0, idx).filter((c) => /[□☐▢◻\u{F02EB}]/u.test(c)).length;
        const totalBoxes = cps.filter((c) => /[□☐▢◻\u{F02EB}]/u.test(c)).length;
        if (positions.length !== totalBoxes) throw new Error('체크 기호 위치가 맞지 않음');
        for (const idx of plan.boxIndexes) {
          const pos = positions[boxOrdinal(idx)]!;
          const len = [...s.xml.slice(pos, pos + 2)][0]!.length;
          s.splices.push({ start: pos, end: pos + len, text: escXml(req.checkMark) });
        }
      } else {
        const lines = plan.text.split('\n');
        const pfx = prefixOf(paras[0]!);
        // 안내 문구는 가장 많이 쓰인 문단 모양(정렬)을 모든 줄에 쓴다
        let paraPr: string | undefined;
        if (plan.role === 'guide' && paras.length > 1) {
          const counts = new Map<string, number>();
          for (const p of paras) { const v = p.getAttribute('paraPrIDRef') ?? ''; counts.set(v, (counts.get(v) ?? 0) + 1); }
          paraPr = [...counts].sort((a, b) => b[1] - a[1])[0]?.[0];
        }
        // 여러 줄이나 긴 글을 가운데 정렬 칸에 넣으면 양쪽 정렬로 넣는다(담당자가 한글에서 직접 쓸 때처럼)
        if (paraPr === undefined && isLongText(plan.text)) {
          const cur = paras[0]!.getAttribute('paraPrIDRef') ?? '';
          if (paraShapes.isCenter(cur)) paraPr = paraShapes.justified(cur);
        }
        const firstRunChar = (p: Element) => kids(p, 'run')[0]?.getAttribute('charPrIDRef') ?? '0';
        const normalize = plan.normalize || isGuideChar(chars.get(firstRunChar(paras[0]!)));
        const newParas = lines.map((line, k) => {
          const base = paras[Math.min(k, paras.length - 1)]!;
          const r = s.loc.rangeOf(base);
          let open = s.xml.slice(r.start, r.openEnd);
          if (open.endsWith('/>')) open = open.slice(0, -2) + '>';
          if (paraPr !== undefined) open = open.replace(/paraPrIDRef="[^"]*"/, `paraPrIDRef="${paraPr}"`);
          let cp = firstRunChar(base);
          if (normalize) cp = chars.normal(cp);
          const run = line ? `<${pfx}run charPrIDRef="${cp}"><${pfx}t>${escXml(line)}</${pfx}t></${pfx}run>` : `<${pfx}run charPrIDRef="${cp}"/>`;
          return `${open}${run}</${pfx}p>`;
        });
        const first = s.loc.rangeOf(paras[0]!);
        const last = s.loc.rangeOf(paras[paras.length - 1]!);
        s.splices.push({ start: first.start, end: last.end, text: newParas.join('') });
      }
      applied.push(plan.cell.id);
      warnings.push(...plan.warnings.map((message) => ({ id: plan.cell.id, message })));
    } catch (err) {
      skipped.push({ id: plan.cell.id, message: `이 항목에 쓰지 못함: ${err instanceof Error ? err.message : '알 수 없는 오류'}` });
    }
  }

  for (const s of sections) if (s.splices.length) zip.file(s.name, applySplices(s.xml, s.splices), { createFolders: false });
  const header = paraShapes.output(chars.output());
  if (header !== (await zip.file(headerName)!.async('string'))) zip.file(headerName, header, { createFolders: false });
  // mimetype은 압축하지 않고 맨 앞에 둔다(HWPX 규칙). 원래 압축 방식을 그대로 쓰므로 원본이 맞으면 결과도 맞다
  methods.set('mimetype', 'STORE');
  applyZipMethods(zip, methods);
  const data = await zip.generateAsync({ type: 'uint8array', compressionOptions: { level: 6 } });
  const before = await pageCount(original);
  const after = await pageCount(data);
  return { format: 'hwpx', data, applied, skipped, warnings, pages: before && after ? { before, after } : undefined };
}
