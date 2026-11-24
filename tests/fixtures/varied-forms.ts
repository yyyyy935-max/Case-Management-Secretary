/**
 * 서울 표준 양식·보건복지부 서식과 모양이 다른 가상 양식들. 규칙이 특정 양식에만 맞지 않는지 시험한다.
 * 모두 새로 만든 가상 양식이며 실제 개인정보는 없다.
 * 각 양식의 danger: 자동으로 채우면 안 되는 칸(판단·서명·인적사항)과 기대 역할.
 */
import { docxFrom, hwpxFrom, para, table, tc, wp } from './virtual-forms.ts';
import type { CellRole } from '../../src/forms/classify.ts';

export interface VariedForm {
  name: string;
  build: () => Promise<Uint8Array>;
  /** 칸 id → 기대 역할 (자동 기입 금지 칸) */
  danger: Record<string, CellRole>;
  /** 칸 id → 기대 역할 (채워도 되는 칸) */
  fillable: Record<string, CellRole>;
}

export const VARIED_FORMS: VariedForm[] = [
  {
    // A. 항목명이 칸 위에 있고 배경색이 없는 DOCX
    name: 'A. 항목명이 위에 있는 표, 배경색 없음 (DOCX)',
    build: () =>
      docxFrom(
        wp('가정방문 상담표', '<w:b/><w:sz w:val="32"/>') +
          `<w:tbl><w:tblGrid><w:gridCol/><w:gridCol/><w:gridCol/></w:tblGrid>` +
          `<w:tr>${tc(wp('대상자 성명'))}${tc(wp('생년월일'))}${tc(wp('연락처'))}</w:tr>` +
          `<w:tr>${tc('')}${tc('')}${tc('')}</w:tr>` +
          `<w:tr>${tc(wp('상담 내용'), { span: 3 })}</w:tr>` +
          `<w:tr>${tc('', { span: 3 })}</w:tr>` +
          `<w:tr>${tc(wp('사례관리 필요성 판정'), { span: 3 })}</w:tr>` +
          `<w:tr>${tc(wp('□ 필요  □ 불필요'), { span: 3 })}</w:tr>` +
          `<w:tr>${tc(wp('담당자 의견'), { span: 3 })}</w:tr>` +
          `<w:tr>${tc('', { span: 3 })}</w:tr>` +
          `<w:tr>${tc(wp('대상자 확인'))}${tc(wp('(서명)'), { span: 2 })}</w:tr>` +
          `</w:tbl>`,
      ),
    danger: { 't0-r1-c0': 'personal', 't0-r1-c1': 'personal', 't0-r1-c2': 'personal', 't0-r5-c0': 'judgment', 't0-r8-c1': 'signature' },
    fillable: { 't0-r3-c0': 'input', 't0-r7-c0': 'input' },
  },
  {
    // B. 왼쪽 항목명 열, 원 숫자와 글자 띄운 항목명, 배경색 없음 (HWPX)
    name: 'B. 원 숫자·글자 띄운 항목명, 배경색 없음 (HWPX)',
    build: () =>
      hwpxFrom(
        para('위기가구 초기 확인표', 2) +
          para('', 0, table(7, 2, [
            { r: 0, c: 0, t: '① 성     명' }, { r: 0, c: 1 },
            { r: 1, c: 0, t: '② 주     소' }, { r: 1, c: 1 },
            { r: 2, c: 0, t: '③ 가구 형태' }, { r: 2, c: 1, t: '□ 1인 □ 부부 □ 한부모 □ 기타(    )' },
            { r: 3, c: 0, t: '④ 위기도 점수' }, { r: 3, c: 1, t: '(      점)' },
            { r: 4, c: 0, t: '⑤ 개입 우선순위' }, { r: 4, c: 1 },
            { r: 5, c: 0, t: '⑥ 정보 제공 동의' }, { r: 5, c: 1, t: '□ 예 □ 아니오' },
            { r: 6, c: 0, t: '⑦ 주요 어려움' }, { r: 6, c: 1 },
          ])),
      ),
    danger: { 't0-r0-c1': 'personal', 't0-r1-c1': 'personal', 't0-r3-c1': 'judgment', 't0-r4-c1': 'judgment', 't0-r5-c1': 'signature' },
    fillable: { 't0-r2-c1': 'checkbox_group', 't0-r6-c1': 'input' },
  },
  {
    // C. 표 없이 밑줄 빈칸만 있는 양식 (HWPX)
    name: 'C. 표 없는 밑줄 양식 (HWPX)',
    build: () =>
      hwpxFrom(
        para('간이 상담 메모지', 2) +
          para('성명: ________   연락처: ________') +
          para('상담일: 20   년   월   일') +
          para('주요 내용: ______________________') +
          para('판정 결과: □ 선정  □ 비선정') +
          para('확인자: ________ (인)'),
      ),
    danger: { p1: 'personal', p4: 'judgment', p5: 'signature' },
    fillable: { p2: 'input', p3: 'input' },
  },
  {
    // D. 제목 막대 + 작성 방법 표 + 작성 예시 + 실제 양식 (HWPX)
    name: 'D. 제목 막대·작성 방법·작성 예시가 함께 있는 서식 모음 (HWPX)',
    build: () => {
      const form = (name: string, date: string) => table(3, 4, [
        { r: 0, c: 0, t: '대상자명' }, { r: 0, c: 1, t: name }, { r: 0, c: 2, t: '작성일' }, { r: 0, c: 3, t: date },
        { r: 1, c: 0, t: '방문 내용' }, { r: 1, c: 1, cs: 3 },
        { r: 2, c: 0, t: '지원 여부' }, { r: 2, c: 1, cs: 3, t: '□ 지원  □ 미지원' },
      ]);
      return hwpxFrom(
        para('', 0, table(1, 3, [{ r: 0, c: 0, t: '서식 3' }, { r: 0, c: 1 }, { r: 0, c: 2, t: '방문 확인서' }])) +
          para('', 0, form('', '')) +
          para('(1) 작성 방법 - 방문 확인서') +
          para('', 0, table(3, 2, [
            { r: 0, c: 0, t: '항목' }, { r: 0, c: 1, t: '작성방법' },
            { r: 1, c: 0, t: '대상자명' }, { r: 1, c: 1 },
            { r: 2, c: 0, t: '방문 내용' }, { r: 2, c: 1, t: '○ 방문하여 확인한 내용' },
          ])) +
          para('(2) 작성 예시 - 방문 확인서') +
          para('', 0, form('○○○', '20○○. ○. ○.')),
      );
    },
    danger: { 't1-r0-c1': 'personal', 't1-r2-c1': 'judgment' },
    fillable: { 't1-r1-c1': 'input', 't1-r0-c3': 'input', 't2-r1-c1': 'fixed', 't3-r0-c1': 'fixed', 't3-r2-c1': 'fixed' },
  },
  {
    // E. 숫자 없는 설문 응답표 (DOCX)
    name: 'E. 숫자 없는 설문 응답표 (DOCX)',
    build: () =>
      docxFrom(
        wp('서비스 이용 설문') +
          `<w:tbl><w:tblGrid><w:gridCol/><w:gridCol/><w:gridCol/><w:gridCol/></w:tblGrid>` +
          `<w:tr>${tc(wp('문항'))}${tc(wp('그렇지 않다'))}${tc(wp('보통'))}${tc(wp('그렇다'))}</w:tr>` +
          `<w:tr>${tc(wp('1. 상담이 도움이 되었다.'))}${tc('')}${tc('')}${tc('')}</w:tr>` +
          `<w:tr>${tc(wp('2. 다시 이용하고 싶다.'))}${tc('')}${tc('')}${tc('')}</w:tr>` +
          `</w:tbl>`,
      ),
    danger: { 't0-r1-c1': 'judgment', 't0-r1-c2': 'judgment', 't0-r1-c3': 'judgment', 't0-r2-c3': 'judgment' },
    fillable: {},
  },
  {
    // F. 점수 숫자가 머리글 행에 있고 아래 빈칸에 표시하는 조사표 (HWPX)
    name: 'F. 점수 숫자가 머리글에 있는 조사표 (HWPX)',
    build: () =>
      hwpxFrom(
        para('생활 어려움 조사표', 2) +
          para('', 0, table(3, 5, [
            { r: 0, c: 0, t: '문항' }, { r: 0, c: 1, t: '0' }, { r: 0, c: 2, t: '1' }, { r: 0, c: 3, t: '2' }, { r: 0, c: 4, t: '3' },
            { r: 1, c: 0, t: '1. 끼니를 거르는 일이 있다.' }, { r: 1, c: 1 }, { r: 1, c: 2 }, { r: 1, c: 3 }, { r: 1, c: 4 },
            { r: 2, c: 0, t: '2. 집세를 내기 어렵다.' }, { r: 2, c: 1 }, { r: 2, c: 2 }, { r: 2, c: 3 }, { r: 2, c: 4 },
          ])),
      ),
    danger: { 't0-r1-c1': 'judgment', 't0-r1-c4': 'judgment', 't0-r2-c2': 'judgment' },
    fillable: {},
  },
];
