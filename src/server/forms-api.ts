import express from 'express';
import { readForm, UnsupportedFormError } from '../forms/read.ts';
import { classifyForm, ROLE_NAMES } from '../forms/classify.ts';
import { formFingerprint, TemplateStore } from '../forms/templates.ts';
import { logError } from './logger.ts';

/** 양식 분석 API. 올린 파일은 메모리에서만 읽고 디스크에 저장하지 않는다. 담당자가 고친 칸 역할(템플릿)만 저장한다. */
export function formsRouter(store: TemplateStore) {
  const router = express.Router();

  router.post('/analyze', express.raw({ type: '*/*', limit: '30mb' }), async (req, res) => {
    const body = req.body as Buffer | undefined;
    if (!body || !Buffer.isBuffer(body) || body.length === 0) {
      res.status(400).json({ error: '파일이 비어 있습니다.' });
      return;
    }
    try {
      const doc = await readForm(new Uint8Array(body));
      const fingerprint = formFingerprint(doc);
      const template = store.get(fingerprint);
      const classification = classifyForm(doc, template?.overrides);
      res.json({ roleNames: ROLE_NAMES, fingerprint, template: template ?? null, document: doc, classification });
    } catch (err) {
      if (err instanceof UnsupportedFormError) {
        res.status(415).json({ error: err.message });
        return;
      }
      logError('양식 분석', err);
      res.status(422).json({ error: '파일을 읽지 못했습니다. 파일이 손상되었거나 암호가 걸려 있을 수 있습니다.' });
    }
  });

  router.get('/templates', (_req, res) => {
    res.json(store.list().map((t) => ({ fingerprint: t.fingerprint, name: t.name, format: t.format, updatedAt: t.updatedAt, changed: Object.keys(t.overrides).length })));
  });

  router.put('/templates/:fp', express.json({ limit: '2mb' }), (req, res) => {
    const { name, format, overrides } = req.body ?? {};
    if (typeof name !== 'string' || !['hwp', 'hwpx', 'docx'].includes(format) || typeof overrides !== 'object' || overrides === null) {
      res.status(400).json({ error: '저장할 내용이 올바르지 않습니다.' });
      return;
    }
    try {
      res.json(store.save(req.params.fp, { name, format, overrides }));
    } catch (err) {
      logError('템플릿 저장', err);
      res.status(400).json({ error: '템플릿을 저장하지 못했습니다.' });
    }
  });

  return router;
}
