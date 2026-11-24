import express from 'express';
import type { AppConfig } from './config.ts';
import { CaseStore, addRecord, approveSuggestion, rejectSuggestion, setGeneralByWorker, removeFact } from '../cases/store.ts';
import { extractFacts, mergeExtraction } from '../cases/extract.ts';
import { GENERAL_KEYS, NEED_AREAS, PERSON_ATTRS, RECORD_TYPES, SPEAKERS, type GeneralKey, type NeedArea } from '../cases/schema.ts';
import type { AiProvider } from '../ai/provider.ts';
import { AiCallError, AiNotConfiguredError } from '../ai/provider.ts';
import { providerFromConfig } from '../ai/index.ts';
import { logError } from './logger.ts';

/**
 * 사례 카드·기록 API (3단계). 사례는 이 PC의 data/cases/ 에만 저장한다.
 * 5단계(개인정보 가림) 전에는 가상 사례만 넣어야 한다. 화면에도 안내한다.
 */
export function casesRouter(store: CaseStore, config: AppConfig, aiOverride?: AiProvider) {
  const router = express.Router();
  router.use(express.json({ limit: '2mb' }));

  const getProvider = () => aiOverride ?? providerFromConfig(config);
  const load = (id: string, res: express.Response) => {
    try {
      const c = store.get(id);
      if (!c) res.status(404).json({ error: '사례를 찾지 못했습니다.' });
      return c;
    } catch {
      res.status(400).json({ error: '잘못된 사례 id입니다.' });
      return undefined;
    }
  };
  const fail = (res: express.Response, err: unknown, where: string) => {
    if (err instanceof AiNotConfiguredError) return res.status(409).json({ error: err.message });
    if (err instanceof AiCallError) return res.status(502).json({ error: err.message });
    if (err instanceof Error && !/at /.test(err.message) && err.message.length < 120) return res.status(400).json({ error: err.message });
    logError(where, err);
    return res.status(500).json({ error: '처리 중 오류가 났습니다.' });
  };

  router.get('/schema', (_req, res) => {
    res.json({ general: GENERAL_KEYS, needs: NEED_AREAS, personAttrs: PERSON_ATTRS, recordTypes: RECORD_TYPES, speakers: SPEAKERS, aiReady: !!aiOverride || !!config.ai.apiKey });
  });

  router.get('/', (_req, res) => res.json(store.list()));

  router.post('/', (req, res) => {
    try { res.json(store.create(String(req.body?.title ?? ''))); } catch (err) { fail(res, err, '사례 만들기'); }
  });

  router.get('/:id', (req, res) => {
    const c = load(req.params.id, res);
    if (c) res.json(c);
  });

  router.delete('/:id', (req, res) => {
    try { store.remove(req.params.id); res.json({ ok: true }); } catch (err) { fail(res, err, '사례 지우기'); }
  });

  router.post('/:id/records', (req, res) => {
    const c = load(req.params.id, res);
    if (!c) return;
    try {
      const r = addRecord(c, { date: String(req.body?.date ?? ''), type: String(req.body?.type ?? ''), rawText: String(req.body?.rawText ?? ''), author: req.body?.author ? String(req.body.author) : undefined });
      store.save(c);
      res.json({ record: r, case: c });
    } catch (err) { fail(res, err, '기록 추가'); }
  });

  router.post('/:id/records/:rid/extract', async (req, res) => {
    const c = load(req.params.id, res);
    if (!c) return;
    try {
      const result = await extractFacts(getProvider(), c, req.params.rid);
      mergeExtraction(c, req.params.rid, result);
      store.save(c);
      res.json({ accepted: result.accepted.length, rejected: result.rejected, case: c });
    } catch (err) { fail(res, err, '사실 뽑기'); }
  });

  router.post('/:id/suggestions/:sid', (req, res) => {
    const c = load(req.params.id, res);
    if (!c) return;
    try {
      const action = String(req.body?.action ?? '');
      if (action === 'approve') approveSuggestion(c, req.params.sid, typeof req.body?.value === 'string' ? req.body.value : undefined);
      else if (action === 'reject') rejectSuggestion(c, req.params.sid);
      else throw new Error('action은 approve 또는 reject여야 합니다.');
      store.save(c);
      res.json(c);
    } catch (err) { fail(res, err, '후보 처리'); }
  });

  /** 담당자가 일반사항을 직접 넣거나 지움 */
  router.put('/:id/general/:key', (req, res) => {
    const c = load(req.params.id, res);
    if (!c) return;
    try {
      if (!(req.params.key in GENERAL_KEYS)) throw new Error('없는 항목입니다.');
      setGeneralByWorker(c, req.params.key as GeneralKey, typeof req.body?.value === 'string' ? req.body.value : null);
      store.save(c);
      res.json(c);
    } catch (err) { fail(res, err, '일반사항 수정'); }
  });

  /** 확인된 사실 지우기 */
  router.delete('/:id/needs/:area/:index', (req, res) => {
    const c = load(req.params.id, res);
    if (!c) return;
    try {
      if (!(req.params.area in NEED_AREAS)) throw new Error('없는 영역입니다.');
      removeFact(c, { kind: 'need', area: req.params.area as NeedArea, index: Number(req.params.index) });
      store.save(c);
      res.json(c);
    } catch (err) { fail(res, err, '사실 지우기'); }
  });

  return router;
}
