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

/** 사용량 누적 (비용 확인용) */
export interface AiUsage {
  calls: number;
  inputTokens: number;
  outputTokens: number;
  /** 제공자가 알려 준 실제 금액(달러). 모르면 없음 */
  costUsd?: number;
}

export interface AiProvider {
  readonly name: string;
  /** 지금 쓰는 모델 이름 */
  readonly model?: string;
  /** 이 제공자로 지금까지 쓴 양 */
  readonly usage?: AiUsage;
  /** JSON 글을 돌려준다 */
  generate(req: AiRequest): Promise<string>;
}

/** 호출 제한(429)이나 일시적 서버 오류(5xx)면 조금씩 더 기다렸다 다시 시도한다 */
export async function withRetry(call: () => Promise<Response>, tries = 4): Promise<Response> {
  let res = await call();
  for (let i = 1; i < tries && (res.status === 429 || res.status >= 500); i++) {
    const wait = Number(res.headers.get('retry-after')) * 1000 || 1000 * 2 ** i;
    await new Promise((r) => setTimeout(r, Math.min(wait, 30000)));
    res = await call();
  }
  return res;
}

export class AiNotConfiguredError extends Error {
  override name = 'AiNotConfiguredError';
}

export class AiCallError extends Error {
  override name = 'AiCallError';
}
