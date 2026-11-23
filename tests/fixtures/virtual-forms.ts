/**
 * 시험용 가상 양식. 서울 표준 양식을 베끼지 않고 시험에 필요한 칸 종류만 넣어 새로 만든 것이다.
 * 실제 개인정보는 들어 있지 않다.
 */
import JSZip from 'jszip';
import { markdownToHwpx, hwpxToHwp } from 'kordoc';

// ── HWPX (서식 포함, 직접 작성) ─────────────────────────────

const HP = 'xmlns:hp="http://www.hancom.co.kr/hwpml/2011/paragraph" xmlns:hs="http://www.hancom.co.kr/hwpml/2011/section"';
const HH = 'xmlns:hh="http://www.hancom.co.kr/hwpml/2011/head" xmlns:hc="http://www.hancom.co.kr/hwpml/2011/core"';

function borderFill(id: number, opts: { face?: string; sides?: boolean }) {
  const side = opts.sides === false ? 'NONE' : 'SOLID';
  return `<hh:borderFill id="${id}"><hh:leftBorder type="${side}" width="0.12 mm" color="#000000"/><hh:rightBorder type="${side}" width="0.12 mm" color="#000000"/><hh:topBorder type="SOLID" width="0.12 mm" color="#000000"/><hh:bottomBorder type="SOLID" width="0.12 mm" color="#000000"/><hc:fillBrush><hc:winBrush faceColor="${opts.face ?? 'none'}" hatchColor="#000000" alpha="0"/></hc:fillBrush></hh:borderFill>`;
}

const HEADER_XML = `<?xml version="1.0" encoding="UTF-8"?><hh:head ${HH}><hh:refList>
<hh:borderFills>${borderFill(1, {})}${borderFill(2, { face: '#D8D8D8' })}${borderFill(3, { sides: false })}</hh:borderFills>
<hh:charProperties>
<hh:charPr id="0" height="1000" textColor="#000000"><hh:underline type="NONE"/></hh:charPr>
<hh:charPr id="1" height="900" textColor="#999999"><hh:italic/><hh:underline type="NONE"/></hh:charPr>
<hh:charPr id="2" height="1500" textColor="#000000"><hh:bold/><hh:underline type="NONE"/></hh:charPr>
</hh:charProperties></hh:refList></hh:head>`;

export interface C { r: number; c: number; rs?: number; cs?: number; t?: string; fill?: 1 | 2 | 3; char?: 0 | 1; h?: number; nested?: string }

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
export const para = (text: string, char = 0, inner = '') =>
  `<hp:p paraPrIDRef="0"><hp:run charPrIDRef="${char}">${inner}${text ? `<hp:t>${esc(text)}</hp:t>` : ''}</hp:run></hp:p>`;

export function table(rows: number, cols: number, cells: C[]): string {
  const byRow = new Map<number, C[]>();
  for (const c of cells) byRow.set(c.r, [...(byRow.get(c.r) ?? []), c]);
  let xml = `<hp:tbl rowCnt="${rows}" colCnt="${cols}">`;
  for (let r = 0; r < rows; r++) {
    xml += '<hp:tr>';
    for (const c of byRow.get(r) ?? []) {
      const body = (c.t ?? '').split('\n').map((line) => para(line, c.char ?? 0)).join('');
      xml += `<hp:tc borderFillIDRef="${c.fill ?? 1}"><hp:subList>${c.nested ? para('', 0, c.nested) : body}</hp:subList>`
        + `<hp:cellAddr colAddr="${c.c}" rowAddr="${c.r}"/><hp:cellSpan colSpan="${c.cs ?? 1}" rowSpan="${c.rs ?? 1}"/>`
        + `<hp:cellSz width="${(c.cs ?? 1) * 7200}" height="${c.h ?? 2000}"/></hp:tc>`;
    }
    xml += '</hp:tr>';
  }
  return xml + '</hp:tbl>';
}

/** 섹션 본문 XML로 최소 HWPX 파일을 만든다 */
export async function hwpxFrom(sectionInner: string): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file('mimetype', 'application/hwp+zip');
  zip.file('Contents/header.xml', HEADER_XML);
  zip.file('Contents/section0.xml', `<?xml version="1.0" encoding="UTF-8"?><hs:sec ${HP}>${sectionInner}</hs:sec>`);
  return zip.generateAsync({ type: 'uint8array' });
}

/** 칸 종류를 고루 담은 가상 상담 기록지 (HWPX) */
export async function virtualStyledHwpx(): Promise<Uint8Array> {
  const nested = table(1, 2, [
    { r: 0, c: 0, t: '주거 형태' },
    { r: 0, c: 1, t: '□ 자가 □ 전세 □ 월세' },
  ]);
  const main = table(10, 6, [
    { r: 0, c: 0, t: '성명', fill: 2 }, { r: 0, c: 1, cs: 2 }, { r: 0, c: 3, t: '연락처', fill: 2 }, { r: 0, c: 4, cs: 2 },
    { r: 1, c: 0, t: '면담 방식', fill: 2 }, { r: 1, c: 1, cs: 5, t: '□ 방문 □ 전화 □ 내방' },
    { r: 2, c: 0, t: '상담 내용', fill: 2 }, { r: 2, c: 1, cs: 5, t: '※ 상담에서 들은 내용을 적습니다.', char: 1 },
    { r: 3, c: 0, rs: 3, t: '가족', fill: 2 }, { r: 3, c: 1, t: '관계', fill: 2 }, { r: 3, c: 2, cs: 2, t: '이름', fill: 2 }, { r: 3, c: 4, cs: 2, t: '비고', fill: 2 },
    { r: 4, c: 1 }, { r: 4, c: 2, cs: 2 }, { r: 4, c: 4, cs: 2 },
    { r: 5, c: 1 }, { r: 5, c: 2, cs: 2 }, { r: 5, c: 4, cs: 2 },
    { r: 6, c: 0, t: '생활 형편', fill: 2 }, { r: 6, c: 1, cs: 5, nested },
    { r: 7, c: 0, t: '건강 상태', fill: 2 }, { r: 7, c: 1, t: '0' }, { r: 7, c: 2, t: '1' }, { r: 7, c: 3, t: '2' }, { r: 7, c: 4, t: '3' }, { r: 7, c: 5 },
    { r: 8, c: 0, t: '선정 여부', fill: 2 }, { r: 8, c: 1, cs: 5, t: '□ 선정 □ 미선정' },
    { r: 9, c: 0, t: '개인정보 동의', fill: 2 }, { r: 9, c: 1, cs: 5, t: '□ 동의함 □ 동의하지 않음' },
  ]);
  const head = table(3, 4, [
    { r: 0, c: 0, t: '작성일', fill: 2 }, { r: 0, c: 1 }, { r: 0, c: 2, t: '작성자', fill: 2 }, { r: 0, c: 3 },
    { r: 1, c: 0, fill: 3, h: 700 }, { r: 1, c: 1, fill: 3, h: 700 }, { r: 1, c: 2, fill: 3, h: 700 }, { r: 1, c: 3, fill: 3, h: 700 },
    { r: 2, c: 0, t: '확인자', fill: 2 }, { r: 2, c: 1, cs: 3, t: '(서명)' },
  ]);
  const section = `<?xml version="1.0" encoding="UTF-8"?><hs:sec ${HP}>`
    + para('[서식1] 가상 상담 기록지', 2)
    + para('', 0, head)
    + para('', 0, main)
    + para('이 기록은 시험용 가상 자료입니다.')
    + para('위 내용에 동의하십니까?  □ 예  □ 아니오')
    + `</hs:sec>`;
  const zip = new JSZip();
  zip.file('mimetype', 'application/hwp+zip');
  zip.file('Contents/header.xml', HEADER_XML);
  zip.file('Contents/section0.xml', section);
  return zip.generateAsync({ type: 'uint8array' });
}

// ── HWP와 HWPX 짝 (kordoc으로 생성) ──────────────────────────

const PAIR_MD = `# 가상 면담 기록

<table><tr><td>성명</td><td></td><td>생년월일</td><td></td></tr>
<tr><td rowspan="2">가족</td><td>관계</td><td colspan="2">이름</td></tr>
<tr><td></td><td colspan="2"></td></tr>
<tr><td>면담 결과</td><td colspan="3">□ 선정 □ 미선정</td></tr></table>
`;

/** 같은 내용의 HWPX와 HWP를 만든다 (HWP 5.x 읽기 경로 시험용) */
export async function virtualHwpPair(): Promise<{ hwpx: Uint8Array; hwp: Uint8Array }> {
  const hwpx = new Uint8Array(await markdownToHwpx(PAIR_MD));
  const hwp = await hwpxToHwp(hwpx);
  return { hwpx, hwp };
}

// ── DOCX (직접 작성) ────────────────────────────────────────

const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
export const run = (t: string, rpr = '') => `<w:r>${rpr ? `<w:rPr>${rpr}</w:rPr>` : ''}<w:t xml:space="preserve">${esc(t)}</w:t></w:r>`;
export const wp = (t: string, rpr = '') => `<w:p>${t ? run(t, rpr) : ''}</w:p>`;
export function tc(content: string, o: { span?: number; vmerge?: 'restart' | 'continue'; shade?: string; w?: number } = {}) {
  return `<w:tc><w:tcPr><w:tcW w:w="${o.w ?? 1800}" w:type="dxa"/>${o.span ? `<w:gridSpan w:val="${o.span}"/>` : ''}${o.vmerge === 'restart' ? '<w:vMerge w:val="restart"/>' : o.vmerge === 'continue' ? '<w:vMerge/>' : ''}${o.shade ? `<w:shd w:val="clear" w:color="auto" w:fill="${o.shade}"/>` : ''}</w:tcPr>${content || '<w:p/>'}</w:tc>`;
}

/** 본문 XML로 최소 DOCX 파일을 만든다 */
export async function docxFrom(bodyInner: string): Promise<Uint8Array> {
  const doc = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document ${W}><w:body>${bodyInner}<w:sectPr/></w:body></w:document>`;
  const zip = new JSZip();
  zip.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`);
  zip.file('_rels/.rels', `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`);
  zip.file('word/document.xml', doc);
  return zip.generateAsync({ type: 'uint8array' });
}

/** 가상 사례회의 기록 (DOCX) */
export async function virtualDocx(): Promise<Uint8Array> {
  const G = 'D9D9D9';
  const tbl = `<w:tbl><w:tblGrid><w:gridCol/><w:gridCol/><w:gridCol/><w:gridCol/></w:tblGrid>`
    + `<w:tr>${tc(wp('대상자 성명'), { shade: G })}${tc('')}${tc(wp('회의 일자'), { shade: G })}${tc('')}</w:tr>`
    + `<w:tr>${tc(wp('참석자'), { shade: G, vmerge: 'restart' })}${tc(wp('(총    명)'), { span: 3 })}</w:tr>`
    + `<w:tr>${tc('', { vmerge: 'continue' })}${tc('', { span: 3 })}</w:tr>`
    + `<w:tr>${tc(wp('회의 내용'), { shade: G })}${tc(wp('※ 논의한 내용을 적습니다.', '<w:i/><w:color w:val="808080"/>'), { span: 3 })}</w:tr>`
    + `<w:tr>${tc(wp('우선순위'), { shade: G })}${tc('', { span: 3 })}</w:tr>`
    + `<w:tr>${tc(wp('기록자 확인'), { shade: G })}${tc(wp('(서명 또는 인)'), { span: 3 })}</w:tr>`
    + `</w:tbl>`;
  const doc = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document ${W}><w:body>`
    + wp('[서식2] 가상 사례회의 기록', '<w:b/><w:sz w:val="32"/>') + tbl + wp('시험용 가상 자료입니다.')
    + `<w:sectPr/></w:body></w:document>`;
  const zip = new JSZip();
  zip.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`);
  zip.file('_rels/.rels', `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`);
  zip.file('word/document.xml', doc);
  return zip.generateAsync({ type: 'uint8array' });
}
