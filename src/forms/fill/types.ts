import type { FormFormat } from '../types.ts';

/** 칸 하나에 넣을 값. text: 칸 전체를 이 글로 바꿈(줄바꿈 \n은 문단 나눔). check: 체크할 선택지 이름들 */
export interface FillValue {
  text?: string;
  check?: string[];
}

export interface FillRequest {
  /** 칸 id(t3-r2-c1) → 값 */
  values: Record<string, FillValue>;
  /** 체크 기호 (설정값, 기본 ☑) */
  checkMark: string;
  /**
   * 값을 정한 주체. 'ai'이면 판단·서명·인적사항 칸은 쓰지 않는다(절대 규칙 3·4).
   * 2단계는 사람이 정한 값만 쓰므로 'human'.
   */
  source: 'human' | 'ai';
}

export interface FillWarning {
  id: string;
  message: string;
}

export interface FillResult {
  format: FormFormat;
  data: Uint8Array;
  applied: string[];
  skipped: FillWarning[];
  warnings: FillWarning[];
  /** 쪽 수 (알 수 있을 때만) */
  pages?: { before: number; after: number };
}
