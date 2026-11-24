import type { AiProvider, AiRequest } from './provider.ts';

/** 시험용 가짜 AI. 정해 둔 응답을 차례로 돌려주고, 받은 요청을 기록한다 */
export class FakeProvider implements AiProvider {
  readonly name = 'fake';
  readonly requests: AiRequest[] = [];
  constructor(private responses: (string | ((req: AiRequest) => string))[]) {}
  async generate(req: AiRequest): Promise<string> {
    this.requests.push(req);
    const r = this.responses.shift();
    if (r === undefined) throw new Error('가짜 AI 응답이 더 없음');
    return typeof r === 'function' ? r(req) : r;
  }
}
