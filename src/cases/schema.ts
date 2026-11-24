/**
 * 사례 카드 항목 정의 (요구사항 3.2). 서울시 사회복지관 사례관리 표준 매뉴얼의 인테이크·사정기록지 항목을 기준으로 했다.
 * AI가 후보로 낼 수 있는 항목은 여기 있는 것뿐이다. 판단 항목(욕구수준·우선순위·선정 여부 등)은 넣지 않았다.
 */

/** 일반사항 항목 */
export const GENERAL_KEYS = {
  protectionType: { label: '보호구분', options: ['생계급여', '의료급여', '주거급여', '교육급여', '조건부수급', '차상위', '일반저소득', '기타'], multiple: true },
  householdType: { label: '가구유형', options: ['1인가구', '노인부부', '부모자녀', '한부모', '조손', '다문화', '기타'] },
  housingType: { label: '주거 형태', hint: '아파트, 단독주택, 다세대, 원룸, 고시원 등' },
  housingOwnership: { label: '주거 소유', options: ['자가', '전세', '월세', '공공임대', '무상', '기타'] },
  housingCondition: { label: '주거 상태', hint: '집 안팎 환경, 안전, 위생 등 관찰·진술된 상태' },
  disability: { label: '장애', hint: '장애 유무와 유형·정도' },
  longTermCare: { label: '장기요양 등급', hint: '예: 3등급, 등급외, 없음' },
  referralPath: { label: '접수 경로', hint: '직접 신청, 이웃 제보, 기관 의뢰 등' },
  interviewType: { label: '면접 유형', options: ['내방', '가정방문', '전화', '지역사회기관 방문'] },
} as const;

/** 욕구 14개 영역 */
export const NEED_AREAS = {
  clothing: '의생활',
  food: '식생활',
  dailyLiving: '일상생활',
  health: '건강(신체·정신)',
  psychological: '심리정서',
  employment: '직업',
  economy: '경제',
  housing: '주거',
  educationDevelopment: '교육(학습)·발달',
  carePrimary: '돌봄·부양',
  familySocialRelations: '가족·사회적 관계',
  familyFunction: '가족 기능',
  safety: '안전',
  rightsLegal: '권익보장·법률',
} as const;

/** 인물(대상자·가족·관계인) 항목 */
export const PERSON_ATTRS = {
  name: '이름',
  sex: '성별',
  birthYear: '출생연도',
  age: '나이',
  occupation: '직업',
  cohabiting: '동거 여부',
  health: '건강·장애',
  contactFrequency: '연락 빈도',
  note: '특이사항',
} as const;

export type GeneralKey = keyof typeof GENERAL_KEYS;
export type NeedArea = keyof typeof NEED_AREAS;
export type PersonAttr = keyof typeof PERSON_ATTRS;

export const RECORD_TYPES = ['상담', '방문', '전화', '회의', '기타'] as const;
export type RecordType = (typeof RECORD_TYPES)[number];

/** 정보를 누가 말했거나 보았는가 (작성 지침 2.4) */
export const SPEAKERS = {
  client: '대상자 말',
  other: '가족·이웃·기관 말',
  observed: '담당자가 직접 봄',
  document: '서류·시스템 확인',
} as const;
export type Speaker = keyof typeof SPEAKERS;

/**
 * 고르는 항목의 선택지마다, 근거 문장에 있어야 하는 말(이 중 하나).
 * 선택지 값은 근거와 말이 달라도 되지만, 아무 근거나 붙이는 것을 막기 위해 뒷받침하는 말을 요구한다.
 */
export const OPTION_CUES: Record<string, Record<string, string[]>> = {
  householdType: {
    '1인가구': ['혼자', '홀로', '독거', '1인', '혼자서'],
    노인부부: ['부부', '두 분', '두분', '할아버지와 할머니', '할머니와 할아버지'],
    부모자녀: ['자녀', '아들', '딸', '부모'],
    한부모: ['한부모', '이혼', '사별', '미혼', '혼자 키', '혼자 아이', '혼자서 아이'],
    조손: ['손자', '손녀', '손주', '조부모', '조손', '할머니랑', '할아버지랑', '할머니와 둘이', '할아버지와 둘이'],
    다문화: ['다문화', '결혼이민', '출신', '외국', '귀화', '이주', '베트남', '중국', '필리핀', '캄보디아', '태국', '몽골', '우즈베키스탄'],
    기타: [],
  },
  housingOwnership: {
    자가: ['자가', '자기 집', '본인 집', '소유'],
    전세: ['전세'],
    월세: ['월세'],
    공공임대: ['임대', 'LH', '영구임대', '국민임대', '매입임대'],
    무상: ['무상', '얹혀', '친척 집', '무료로'],
    기타: [],
  },
  interviewType: {
    내방: ['내방', '찾아와', '찾아옴', '방문하여 상담', '복지관에'],
    가정방문: ['가정방문', '방문', '집에 가'],
    전화: ['전화', '통화'],
    '지역사회기관 방문': ['기관', '센터', '학교'],
  },
  protectionType: {
    생계급여: ['생계'],
    의료급여: ['의료급여'],
    주거급여: ['주거급여'],
    교육급여: ['교육급여'],
    조건부수급: ['조건부'],
    차상위: ['차상위'],
    일반저소득: ['저소득'],
    기타: [],
  },
};
