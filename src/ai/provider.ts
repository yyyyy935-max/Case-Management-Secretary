/**
 * AI 호출 모듈의 공통 형식. 제공자(Gemini 등)를 바꿀 때 이 형식만 맞추면 된다(요구사항 7장).
 * 실제 사례는 개인정보 가림(5단계)을 거친 글만 넣는다. 5단계 전에는 가상 사례로만 쓴다.
 */
export interface AiRequest {
  /** 지침(시스템 프롬프트) */
  system: string;
  /** 작업 글 (가림 처리된 글만) */
  prompt: string;
  /** 응답 JSON 형식 */
  responseSchema?: Record<string, unknown>;
}

export interface AiProvider {
  readonly name: string;
  /** JSON 글을 돌려준다 */
  generate(req: AiRequest): Promise<string>;
}

export class AiNotConfiguredError extends Error {
  override name = 'AiNotConfiguredError';
}

export class AiCallError extends Error {
  override name = 'AiCallError';
}
