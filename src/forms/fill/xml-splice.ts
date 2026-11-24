import { DOMParser, type Element, type Document } from '@xmldom/xmldom';

/**
 * XML 글 안에서 요소의 위치를 찾고, 일부만 바꿔 끼운다.
 * 바꾸지 않는 부분은 원본 글을 한 글자도 바꾸지 않기 위해 DOM으로 다시 쓰지 않고 글을 잘라 붙인다.
 */

export interface ElementRange {
  /** 여는 태그 시작 위치 */
  start: number;
  /** 여는 태그 끝 다음 위치 */
  openEnd: number;
  /** 닫는 태그 끝 다음 위치 (자기닫힘이면 openEnd와 같음) */
  end: number;
  /** 닫는 태그 시작 위치 (자기닫힘이면 openEnd) */
  closeStart: number;
  name: string;
}

/** 모든 요소의 위치를 여는 태그 순서(= DOM 문서 순서)대로 돌려준다 */
export function scanElements(xml: string): ElementRange[] {
  const out: ElementRange[] = [];
  const stack: ElementRange[] = [];
  const re = /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<\?[\s\S]*?\?>|<!DOCTYPE[^>]*>|<(\/?)([A-Za-z_][\w:.-]*)((?:[^>"']|"[^"]*"|'[^']*')*?)(\/?)>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) {
    if (!m[2]) continue;
    const [all, close, name, , self] = m;
    if (close) {
      const top = stack.pop();
      if (!top || top.name !== name) throw new Error(`XML 태그 짝이 맞지 않음: ${name}`);
      top.closeStart = m.index;
      top.end = m.index + all.length;
    } else {
      const r: ElementRange = { start: m.index, openEnd: m.index + all.length, end: -1, closeStart: -1, name: name! };
      out.push(r);
      if (self) { r.end = r.openEnd; r.closeStart = r.openEnd; } else stack.push(r);
    }
  }
  if (stack.length) throw new Error('XML 태그가 닫히지 않음');
  return out;
}

export interface Located {
  doc: Document;
  ranges: ElementRange[];
  /** DOM 요소 → 위치 */
  rangeOf(el: Element): ElementRange;
}

/** DOM과 글 위치를 함께 만든다. DOM 요소를 문서 순서로 번호 매겨 같은 번호의 여는 태그와 짝짓는다 */
export function locate(xml: string): Located {
  const doc = new DOMParser().parseFromString(xml, 'text/xml');
  const ranges = scanElements(xml);
  const order = new Map<Element, number>();
  let n = 0;
  const walk = (el: Element) => {
    order.set(el, n++);
    for (let c = el.firstChild; c; c = c.nextSibling) if (c.nodeType === 1) walk(c as Element);
  };
  if (doc.documentElement) walk(doc.documentElement);
  if (n !== ranges.length) throw new Error(`요소 수가 맞지 않음(DOM ${n}, 글 ${ranges.length})`);
  return {
    doc,
    ranges,
    rangeOf(el: Element) {
      const i = order.get(el);
      if (i === undefined) throw new Error('요소 위치를 찾지 못함');
      const r = ranges[i]!;
      if (r.name !== el.tagName) throw new Error(`요소 짝이 맞지 않음(${r.name} / ${el.tagName})`);
      return r;
    },
  };
}

export interface Splice { start: number; end: number; text: string }

/** 겹치지 않는 바꿔 끼우기를 뒤에서부터 적용한다 */
export function applySplices(xml: string, splices: Splice[]): string {
  const sorted = [...splices].sort((a, b) => b.start - a.start);
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i]!.end > sorted[i - 1]!.start) throw new Error('바꿀 범위가 겹침');
  }
  let out = xml;
  for (const s of sorted) out = out.slice(0, s.start) + s.text + out.slice(s.end);
  return out;
}

export const escXml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export function kids(el: Element, local?: string): Element[] {
  const out: Element[] = [];
  for (let n = el.firstChild; n; n = n.nextSibling) {
    if (n.nodeType === 1 && (!local || (n as Element).localName === local)) out.push(n as Element);
  }
  return out;
}

/** 칸 범위 안의 글 내용(태그 밖)에서 체크 기호의 위치를 순서대로 찾는다 */
export function boxPositionsInText(xml: string, from: number, to: number, textTagLocal: string): number[] {
  const out: number[] = [];
  const re = new RegExp(`<([\\w]+:)?${textTagLocal}(\\s[^>]*)?>([\\s\\S]*?)</([\\w]+:)?${textTagLocal}>`, 'g');
  re.lastIndex = from;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) && m.index < to) {
    const contentStart = m.index + m[0].indexOf('>') + 1;
    const content = m[3]!;
    let inTag = false;
    let off = 0;
    for (const ch of content) {
      if (ch === '<') inTag = true;
      else if (ch === '>') inTag = false;
      else if (!inTag && /[□☐▢◻\u{F02EB}]/u.test(ch)) out.push(contentStart + off);
      off += ch.length;
    }
  }
  return out;
}

/** 압축 파일 안 항목마다 원래 압축 방식(저장/압축)을 기억한다 */
export function zipMethods(zip: import('jszip')): Map<string, 'STORE' | 'DEFLATE'> {
  const m = new Map<string, 'STORE' | 'DEFLATE'>();
  for (const [name, f] of Object.entries(zip.files)) {
    const magic = (f as unknown as { _data?: { compression?: { magic?: string } } })._data?.compression?.magic;
    m.set(name, magic === '\x08\x00' ? 'DEFLATE' : 'STORE');
  }
  return m;
}

/** 기억한 압축 방식을 항목마다 다시 붙인다. 고치지 않은 항목은 원래 압축된 바이트를 그대로 쓴다 */
export function applyZipMethods(zip: import('jszip'), methods: Map<string, 'STORE' | 'DEFLATE'>) {
  for (const [name, f] of Object.entries(zip.files)) {
    (f as unknown as { options: { compression: string } }).options.compression = methods.get(name) ?? 'DEFLATE';
  }
}
