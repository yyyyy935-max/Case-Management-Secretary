/**
 * AI 호출 모듈의 공통 형식. 제공자(Gemini 등)를 바꿀 때 이 형식만 맞추면 된다.
 * 여기로 들어오는 글은 반드시 개인정보 가림(5단계)을 거친 뒤여야 한다.
 * 실제 호출 코드는 3단계에서 만든다.
 */
export interface AiRequest {
  /** 가림 처리된 글만 넣는다 */
  maskedPrompt: string;
  /** 응답 형식(JSON 스키마 등). 3단계에서 정한다 */
  responseSchema?: unknown;
}

export interface AiProvider {
  readonly name: string;
  generate(req: AiRequest): Promise<string>;
}
