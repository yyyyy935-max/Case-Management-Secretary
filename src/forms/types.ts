/** 양식 파일을 읽은 결과. HWP·HWPX·DOCX 모두 이 형식으로 바꿔 다룬다. */

export type FormFormat = 'hwp' | 'hwpx' | 'docx';

export interface TextRun {
  text: string;
  /** 글자 색 (#RRGGBB) */
  color?: string;
  italic?: boolean;
  bold?: boolean;
  underline?: boolean;
  /** 글자 크기(pt) */
  sizePt?: number;
}

export interface Paragraph {
  text: string;
  runs: TextRun[];
}

export interface FormCell {
  /** 표 안에서의 고유 이름. 예: t3-r2-c1 */
  id: string;
  row: number;
  col: number;
  rowSpan: number;
  colSpan: number;
  /** 셀 안 문단을 줄바꿈으로 이은 글 */
  text: string;
  paragraphs: Paragraph[];
  /** 셀 폭·높이(mm). 알 수 없으면 없음 */
  widthMm?: number;
  heightMm?: number;
  /** 배경색 (#RRGGBB). 흰색이나 배경 없음이면 없음 */
  fillColor?: string;
  /** 왼쪽·오른쪽 테두리 선이 보이는지. 알 수 없으면 없음 (보이지 않는 간격 줄 판별용) */
  sideBorders?: { left: boolean; right: boolean };
  /** 이 셀 안에 들어 있는 표의 번호 */
  nestedTableIndexes: number[];
}

export interface FormTable {
  /** 문서 안의 표 순서 (0부터, 셀 안 표 포함) */
  index: number;
  /** 다른 표의 셀 안에 들어 있으면 그 셀 id */
  parentCellId?: string;
  /** 이 표가 속한 양식 제목. 예: "[양식3] 인테이크 기록지" */
  groupTitle?: string;
  /** 표 바로 앞 본문 문단 (최대 3개) */
  precedingTexts: string[];
  rows: number;
  cols: number;
  /** 병합으로 가려진 칸은 빼고, 병합된 칸의 왼쪽 위 칸만 담는다 */
  cells: FormCell[];
}

/** 표 밖 본문 문단 중 체크박스나 빈칸(년 월 일 등)이 있는 문단 */
export interface FormBodyParagraph {
  id: string;
  groupTitle?: string;
  paragraph: Paragraph;
}

export interface FormDocument {
  format: FormFormat;
  pageCount?: number;
  tables: FormTable[];
  bodyParagraphs: FormBodyParagraph[];
  warnings: string[];
}
