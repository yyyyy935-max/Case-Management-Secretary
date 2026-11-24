/**
 * 가상 사례 10개 (요구사항 9.1). 실제 사례를 각색하지 않고 새로 지어낸 것이다. 이름·주소·연락처도 모두 가상이다.
 * 형태를 일부러 다르게 했다: 짧은 메모, 긴 서술, 맞춤법이 엉망인 메모, 정보가 많이 빠진 메모, 여러 번에 걸친 기록.
 *
 * expect: 뽑혀야 할 사실 (category·key와 값에 들어 있어야 할 말). 얼마나 잘 뽑는지 재는 데 쓴다.
 * forbid: 뽑히면 안 되는 말. 담당자의 추측·의견이거나, 기록에 없는데 AI가 지어내기 쉬운 것.
 *         후보 값에 이 말이 들어 있으면 "기록에 없는 사실"로 센다.
 */
export interface VirtualRecord { date: string; type: '상담' | '방문' | '전화' | '회의' | '기타'; rawText: string }
export interface VirtualCase {
  no: number;
  title: string;
  kind: string;
  style: string;
  records: VirtualRecord[];
  expect: { category: 'general' | 'need' | 'person' | 'service'; key: string; contains: string[] }[];
  forbid: string[];
}

export const VIRTUAL_CASES: VirtualCase[] = [
  {
    no: 1,
    title: '가상01 독거 어르신',
    kind: '독거 어르신',
    style: '짧은 메모, 3차 방문',
    records: [
      { date: '2026-10-05', type: '방문', rawText: '이웃 제보로 첫 방문. 할머니(81) 혼자 사심. 무릎 아파서 장보기 힘들다 하심. 반지하 월세.' },
      { date: '2026-10-19', type: '방문', rawText: '2차 방문. 기초연금 받고 계심. 월세 25만원 두 달 밀림(집주인이 기다려준다 함). 아들 있는데 연락 안 한 지 5년.' },
      { date: '2026-11-02', type: '전화', rawText: '할머니 통화. 지난주 넘어지셨다고 함. 병원은 안 가심. "그냥 참으면 낫지" 하심.' },
    ],
    expect: [
      { category: 'general', key: 'referralPath', contains: ['이웃'] },
      { category: 'general', key: 'householdType', contains: ['1인가구'] },
      { category: 'need', key: 'health', contains: ['무릎'] },
      { category: 'need', key: 'economy', contains: ['25만'] },
      { category: 'person', key: 'contactFrequency', contains: ['5년'] },
      { category: 'need', key: 'safety', contains: ['넘어'] },
    ],
    forbid: ['골절', '관절염', '치매', '우울', '고독사'],
  },
  {
    no: 2,
    title: '가상02 한부모 가정',
    kind: '한부모',
    style: '긴 서술',
    records: [
      {
        date: '2026-09-12',
        type: '상담',
        rawText:
          '어머니 김가람(가명, 38세)이 복지관에 직접 찾아와 상담함. 2년 전 이혼 후 초등학교 3학년 딸, 6살 아들과 함께 다세대주택 2층에 월세로 살고 있다고 함. 보증금 500만원에 월세 40만원. 낮에는 마트 계산원으로 일하고 월급은 약 170만원이라고 함. 전 남편은 양육비를 1년째 보내지 않고 있다고 함. 어머니는 "아이들 저녁을 제대로 못 챙겨 주는 게 제일 마음 아파요"라고 말함. 딸은 학교에서 돌아오면 혼자 동생을 돌본다고 함. 어머니 본인은 허리 디스크로 병원 치료를 받고 있으며, 의사가 무거운 물건을 들지 말라고 했다고 함. 친정어머니가 같은 동네에 살아 주말에는 아이들을 봐준다고 함. 한부모가족 지원은 신청 방법을 몰라 아직 받지 않고 있다고 함.',
      },
    ],
    expect: [
      { category: 'general', key: 'householdType', contains: ['한부모'] },
      { category: 'general', key: 'housingOwnership', contains: ['월세'] },
      { category: 'need', key: 'economy', contains: ['40만'] },
      { category: 'need', key: 'carePrimary', contains: ['동생'] },
      { category: 'need', key: 'health', contains: ['디스크'] },
      { category: 'person', key: 'occupation', contains: ['계산원'] },
      { category: 'need', key: 'familySocialRelations', contains: ['친정'] },
    ],
    forbid: ['우울', '방임', '학대', '기초생활수급', '차상위'],
  },
  {
    no: 3,
    title: '가상03 학교 밖 청소년',
    kind: '청소년',
    style: '맞춤법이 엉망인 메모',
    records: [
      { date: '2026-10-08', type: '상담', rawText: '민준(가명) 17살 고1때 자퇴햇다고함. 할머니랑 둘이삼. 편의점 알바 주3회 한다고. 검정고시 보고싶은데 학원비 업다고 함. 밤에 잠을 잘 못잔다 함. 친구들이랑 연락 안됨.' },
    ],
    expect: [
      { category: 'need', key: 'educationDevelopment', contains: ['검정고시'] },
      { category: 'need', key: 'employment', contains: ['편의점'] },
      { category: 'person', key: 'age', contains: ['17'] },
      { category: 'need', key: 'familySocialRelations', contains: ['친구'] },
    ],
    forbid: ['우울증', '불면증', '비행', '가출', '게임 중독'],
  },
  {
    no: 4,
    title: '가상04 지체장애 1인 가구',
    kind: '장애인',
    style: '정보가 많이 빠진 메모',
    records: [{ date: '2026-10-21', type: '전화', rawText: '주민센터 의뢰. 휠체어 사용. 혼자 산다고 함. 다음 주 방문 약속.' }],
    expect: [
      { category: 'general', key: 'referralPath', contains: ['주민센터'] },
      { category: 'general', key: 'householdType', contains: ['1인가구'] },
      { category: 'need', key: 'dailyLiving', contains: ['휠체어'] },
    ],
    forbid: ['1급', '2급', '척수', '하반신', '기초생활'],
  },
  {
    no: 5,
    title: '가상05 정신건강 위기',
    kind: '정신건강',
    style: '전화 기록, 가족 진술과 본인 진술이 섞임',
    records: [
      {
        date: '2026-10-14',
        type: '전화',
        rawText: '누나에게서 전화 옴. 동생(42세, 대상자)이 3주째 방에서 안 나온다고 함. 누나 말로는 작년에 정신건강의학과에서 조울증 진단을 받았는데 약을 끊었다고 함. 누나는 "또 예전처럼 될까 봐 무섭다"고 함.',
      },
      {
        date: '2026-10-16',
        type: '방문',
        rawText: '누나와 함께 방문. 대상자는 방 안에서 짧게 대화함. "다 귀찮다. 그냥 내버려 둬라"고 말함. 방 안에 배달 음식 용기가 쌓여 있었음. 직장은 6월에 그만뒀다고 함. 담당자 소견: 우울감이 깊어 보이며 자해 위험 평가가 필요해 보임.',
      },
    ],
    expect: [
      { category: 'need', key: 'health', contains: ['조울증'] },
      { category: 'need', key: 'psychological', contains: ['귀찮'] },
      { category: 'need', key: 'employment', contains: ['6월'] },
      { category: 'person', key: 'age', contains: ['42'] },
    ],
    forbid: ['자해', '자살', '우울감', '우울증', '조현병', '입원'],
  },
  {
    no: 6,
    title: '가상06 결혼이민자 가정',
    kind: '다문화',
    style: '통역을 거친 상담',
    records: [
      {
        date: '2026-09-30',
        type: '상담',
        rawText: '가족센터 통역사와 함께 상담. 대상자는 베트남 출신, 한국에 온 지 7년. 남편(55세)은 건설 일용직인데 겨울에는 일이 거의 없다고 함. 7살 딸이 내년에 초등학교에 들어가는데 한국어로 된 입학 안내문을 읽기 어렵다고 함. 대상자는 "한국어를 더 배워서 일하고 싶다"고 말함. 시어머니와 함께 살고 있음.',
      },
    ],
    expect: [
      { category: 'general', key: 'householdType', contains: ['다문화'] },
      { category: 'person', key: 'occupation', contains: ['일용직'] },
      { category: 'need', key: 'educationDevelopment', contains: ['입학'] },
      { category: 'need', key: 'employment', contains: ['한국어'] },
    ],
    forbid: ['불법', '체류', '가정폭력', '이혼'],
  },
  {
    no: 7,
    title: '가상07 조손 가정',
    kind: '조손',
    style: '여러 번에 걸친 기록',
    records: [
      { date: '2026-10-02', type: '방문', rawText: '할아버지(74)와 손자(초6) 둘이 삶. 아들 내외는 연락 끊김. 할아버지가 폐지 주워 생활비 보탬. 생계급여 받는 중.' },
      { date: '2026-10-23', type: '방문', rawText: '담임 선생님과 통화 내용 할아버지가 전해 줌. 손자가 최근 지각이 잦고 숙제를 안 해 온다고 함. 손자는 "할아버지 아프면 내가 밥해야 돼서"라고 말함. 할아버지는 당뇨약 드시는 중.' },
    ],
    expect: [
      { category: 'general', key: 'householdType', contains: ['조손'] },
      { category: 'general', key: 'protectionType', contains: ['생계급여'] },
      { category: 'need', key: 'educationDevelopment', contains: ['지각'] },
      { category: 'need', key: 'carePrimary', contains: ['밥'] },
      { category: 'need', key: 'health', contains: ['당뇨'] },
    ],
    forbid: ['방임', 'ADHD', '학습장애', '치매'],
  },
  {
    no: 8,
    title: '가상08 재혼·동거 가족',
    kind: '복합가족',
    style: '관계가 복잡한 서술',
    records: [
      {
        date: '2026-10-10',
        type: '상담',
        rawText: '대상자(여, 45세)는 3년 전 재혼함. 현재 남편(48세), 남편이 전 부인과 낳은 아들(16세), 대상자가 전 남편과 낳은 딸(13세)과 함께 삶. 대상자 말로는 딸과 남편의 아들이 자주 다투고, 남편은 아들 편만 든다고 느낀다고 함. 대상자의 전 남편은 매달 양육비 30만원을 보내고 있음. 대상자는 "다 같이 밥 먹는 날이 한 번이라도 있었으면 좋겠다"고 말함.',
      },
    ],
    expect: [
      { category: 'need', key: 'familySocialRelations', contains: ['다투'] },
      { category: 'need', key: 'economy', contains: ['30만'] },
      { category: 'person', key: 'age', contains: ['16'] },
      { category: 'person', key: 'age', contains: ['13'] },
    ],
    forbid: ['폭력', '학대', '이혼 예정', '별거'],
  },
  {
    no: 9,
    title: '가상09 중장년 실직 1인 가구',
    kind: '중장년 실직',
    style: '숫자와 날짜가 많은 메모',
    records: [
      {
        date: '2026-11-03',
        type: '방문',
        rawText: '박가상(가명, 58세) 고시원 거주(월 35만원). 2026년 4월 공장 폐업으로 실직. 카드빚 약 1,200만원, 3개월 연체. 11월 20일까지 미납 시 단전 예정이라는 안내문을 보여 줌. 고혈압약은 보건소에서 받고 있음. 형이 대전에 사는데 1년에 한두 번 통화한다고 함.',
      },
    ],
    expect: [
      { category: 'general', key: 'housingType', contains: ['고시원'] },
      { category: 'need', key: 'economy', contains: ['1,200'] },
      { category: 'need', key: 'housing', contains: ['11월 20일'] },
      { category: 'need', key: 'employment', contains: ['4월'] },
      { category: 'need', key: 'health', contains: ['고혈압'] },
    ],
    forbid: ['파산', '신용회복', '알코올', '노숙'],
  },
  {
    no: 10,
    title: '가상10 노인부부 돌봄',
    kind: '노인부부',
    style: '담당자의 추측이 섞인 메모',
    records: [
      {
        date: '2026-10-27',
        type: '방문',
        rawText: '할아버지(83)와 할머니(80) 두 분이 아파트 임대주택에 사심. 할머니가 같은 질문을 여러 번 하심. 할아버지 말로는 요즘 할머니가 가스 불을 켜 놓고 잊어버린 적이 두 번 있었다고 함. 장기요양 등급은 아직 신청 안 함. 할아버지가 혼자 식사와 빨래를 다 하시는데 "나도 이제 힘에 부친다"고 하심. 담당자 생각: 할머니 치매가 의심되며 할아버지 돌봄 부담이 커 보임.',
      },
    ],
    expect: [
      { category: 'general', key: 'householdType', contains: ['노인부부'] },
      { category: 'need', key: 'safety', contains: ['가스'] },
      { category: 'need', key: 'carePrimary', contains: ['힘에 부친다'] },
      { category: 'general', key: 'longTermCare', contains: ['신청'] },
    ],
    forbid: ['치매', '알츠하이머', '요양원'],
  },
];
