import type { AiProvider, AiRequest, AiUsage } from './provider.ts';
import { AiCallError, withRetry } from './provider.ts';

/**
 * OpenRouter 연결. 키 하나로 여러 회사의 모델(Gemini, Claude, GPT 등)을 같은 방식으로 부른다.
 * - 모델 이름은 "google/gemini-2.5-flash"처럼 회사/모델 꼴로 config.local.json의 ai.model에 적는다.
 * - 입력을 학습·보관하는 모델 회사는 쓰지 않도록 요청한다(provider.data_collection = "deny").
 * - 응답마다 실제 금액(달러)을 받아 누적한다.
 * - 키는 Authorization 머리글로만 보낸다. 오류 기록에 사례 내용을 남기지 않는다.
 */
const URL = 'https://openrouter.ai/api/v1/chat/completions';

/** Gemini 형식 스키마(type: 'OBJECT' 등 대문자)를 일반 JSON Schema(소문자)로 바꾼다 */
export function toJsonSchema(s: unknown): unknown {
  if (Array.isArray(s)) return s.map(toJsonSchema);
  if (!s || typeof s !== 'object') return s;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(s as Record<string, unknown>)) {
    out[k] = k === 'type' && typeof v === 'string' ? v.toLowerCase() : toJsonSchema(v);
  }
  if (out.type === 'object' && out.properties && out.additionalProperties === undefined) out.additionalProperties = false;
  return out;
}

export class OpenRouterProvider implements AiProvider {
  readonly name = 'openrouter';
  readonly usage: AiUsage = { calls: 0, inputTokens: 0, outputTokens: 0, costUsd: 0 };

  constructor(private apiKey: string, readonly model: string, private fetchImpl: typeof fetch = fetch) {
    if (!model) throw new AiCallError('OpenRouter는 모델 이름이 필요합니다. config.local.json의 ai.model에 예: google/gemini-2.5-flash');
  }

  async generate(req: AiRequest): Promise<string> {
    const body = {
      model: this.model,
      temperature: 0,
      messages: [
        { role: 'system', content: req.system },
        { role: 'user', content: req.prompt },
      ],
      response_format: req.responseSchema
        ? { type: 'json_schema', json_schema: { name: 'result', strict: true, schema: toJsonSchema(req.responseSchema) } }
        : { type: 'json_object' },
      provider: { data_collection: 'deny' },
      usage: { include: true },
    };
    const res = await withRetry(() =>
      this.fetchImpl(URL, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${this.apiKey}` }, body: JSON.stringify(body) }),
    );
    if (!res.ok) {
      const hint = res.status === 401 ? 'API 키' : res.status === 402 ? '남은 크레딧' : res.status === 404 ? '모델 이름 또는 학습 거부 조건에 맞는 제공자' : res.status === 429 ? '사용 한도' : '서버 상태';
      throw new AiCallError(`OpenRouter 호출 실패(HTTP ${res.status}, ${hint}을 확인하세요).`);
    }
    const json = (await res.json()) as { choices?: { message?: { content?: string }; finish_reason?: string }[]; usage?: { prompt_tokens?: number; completion_tokens?: number; cost?: number } };
    this.usage.calls++;
    this.usage.inputTokens += json.usage?.prompt_tokens ?? 0;
    this.usage.outputTokens += json.usage?.completion_tokens ?? 0;
    this.usage.costUsd = (this.usage.costUsd ?? 0) + (json.usage?.cost ?? 0);
    const text = json.choices?.[0]?.message?.content ?? '';
    if (!text) throw new AiCallError(`OpenRouter 응답이 비어 있습니다(${json.choices?.[0]?.finish_reason ?? '이유 모름'}).`);
    return text;
  }
}
