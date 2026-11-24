import type { AiProvider, AiRequest } from './provider.ts';
import { AiCallError } from './provider.ts';

/**
 * Google Gemini API 연결.
 * - 키는 config.local.json에만 두고, 요청 머리글(x-goog-api-key)로 보낸다(주소에 넣지 않음).
 * - 결제가 연결된 유료 등급 키만 쓴다(무료 등급은 입력이 학습에 쓰일 수 있음, 요구사항 7장).
 * - 모델 이름을 정하지 않으면 쓸 수 있는 모델 목록에서 flash 계열을 골라 쓴다.
 * - 오류 기록에는 사례 내용을 남기지 않는다.
 */
const BASE = 'https://generativelanguage.googleapis.com/v1beta';

export class GeminiProvider implements AiProvider {
  readonly name = 'gemini';
  private model?: string;

  constructor(private apiKey: string, model?: string, private fetchImpl: typeof fetch = fetch) {
    this.model = model || undefined;
  }

  private headers() {
    return { 'content-type': 'application/json', 'x-goog-api-key': this.apiKey };
  }

  /** 모델 목록에서 글 생성을 지원하는 flash 모델을 고른다(미리보기·경량판은 뒤로) */
  async resolveModel(): Promise<string> {
    if (this.model) return this.model;
    const res = await this.fetchImpl(`${BASE}/models?pageSize=200`, { headers: this.headers() });
    if (!res.ok) throw new AiCallError(`모델 목록을 가져오지 못했습니다(HTTP ${res.status}). API 키를 확인하세요.`);
    const json = (await res.json()) as { models?: { name: string; supportedGenerationMethods?: string[] }[] };
    const names = (json.models ?? [])
      .filter((m) => m.supportedGenerationMethods?.includes('generateContent') && /flash/.test(m.name) && !/image|tts|audio|live|embedding/.test(m.name))
      .map((m) => m.name.replace(/^models\//, ''));
    const score = (n: string) => (/preview|exp/.test(n) ? 2 : 0) + (/lite/.test(n) ? 1 : 0);
    names.sort((a, b) => score(a) - score(b) || b.localeCompare(a, undefined, { numeric: true }));
    if (!names.length) throw new AiCallError('쓸 수 있는 Gemini flash 모델을 찾지 못했습니다. config.local.json의 ai.model에 모델 이름을 적어 주세요.');
    this.model = names[0]!;
    return this.model;
  }

  async generate(req: AiRequest): Promise<string> {
    const model = await this.resolveModel();
    const body = {
      systemInstruction: { parts: [{ text: req.system }] },
      contents: [{ role: 'user', parts: [{ text: req.prompt }] }],
      generationConfig: {
        temperature: 0,
        responseMimeType: 'application/json',
        ...(req.responseSchema ? { responseSchema: req.responseSchema } : {}),
      },
    };
    const res = await this.fetchImpl(`${BASE}/models/${encodeURIComponent(model)}:generateContent`, { method: 'POST', headers: this.headers(), body: JSON.stringify(body) });
    if (!res.ok) {
      const hint = res.status === 400 ? '요청 형식' : res.status === 401 || res.status === 403 ? 'API 키 또는 권한' : res.status === 429 ? '사용 한도' : '서버 상태';
      throw new AiCallError(`Gemini 호출 실패(HTTP ${res.status}, ${hint}을 확인하세요).`);
    }
    const json = (await res.json()) as { candidates?: { content?: { parts?: { text?: string }[] }; finishReason?: string }[] };
    const text = json.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? '';
    if (!text) throw new AiCallError(`Gemini 응답이 비어 있습니다(${json.candidates?.[0]?.finishReason ?? '이유 모름'}).`);
    return text;
  }
}
