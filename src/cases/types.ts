import type { GeneralKey, NeedArea, PersonAttr, RecordType, Speaker } from './schema.ts';

/** 사례 카드의 값 하나. 값, 근거 기록, 확인 여부를 함께 가진다 (요구사항 3.1) */
export interface Field<T = string> {
  value: T;
  /** 근거가 된 기록 id */
  sourceRecordIds: string[];
  /** confirmed: 담당자가 확인함 / suggested: AI 후보 */
  status: 'confirmed' | 'suggested';
  /** 근거 문장(기록 원문에서 그대로 인용) */
  evidence?: string[];
  speaker?: Speaker;
  updatedAt: string;
}

/** 상담·방문·전화·회의 기록. 원문을 그대로 보관한다 */
export interface CaseRecord {
  id: string;
  /** 상담한 날 (YYYY-MM-DD) */
  date: string;
  type: RecordType;
  rawText: string;
  author?: string;
  createdAt: string;
  /** 마지막으로 AI 사실 뽑기를 한 때 */
  extractedAt?: string;
}

export interface Person {
  id: string;
  /** 대상자와의 관계 (본인, 손자, 큰딸 등) */
  relation: string;
  isClient: boolean;
  attrs: Partial<Record<PersonAttr, Field>>;
}

export interface Service {
  id: string;
  text: Field;
}

/** AI가 낸 후보. 담당자가 승인해야 사례 카드에 들어간다 */
export interface Suggestion {
  id: string;
  recordId: string;
  target:
    | { kind: 'general'; key: GeneralKey }
    | { kind: 'need'; area: NeedArea }
    | { kind: 'person'; relation: string; attr: PersonAttr }
    | { kind: 'service' };
  value: string;
  evidence: string;
  speaker: Speaker;
  /** 이미 확인된 값과 다르면 그 값 (담당자가 둘 중 고름) */
  conflictWith?: string;
  createdAt: string;
}

/** 걸러진 후보 (보여 주기만 하고 카드에는 넣지 않음) */
export interface RejectedSuggestion {
  recordId: string;
  raw: unknown;
  reason: string;
}

export interface Case {
  id: string;
  /** 관리용 이름 (가명 권장) */
  title: string;
  createdAt: string;
  updatedAt: string;
  records: CaseRecord[];
  general: Partial<Record<GeneralKey, Field>>;
  people: Person[];
  /** 욕구 영역별 사실 목록. 욕구수준·우선순위는 담당자 입력 전용이라 여기 넣지 않는다 */
  needs: Partial<Record<NeedArea, Field[]>>;
  services: Service[];
  /** 담당자 확인을 기다리는 후보 */
  suggestions: Suggestion[];
  /** 최근 사실 뽑기에서 걸러진 후보 */
  rejected: RejectedSuggestion[];
}
