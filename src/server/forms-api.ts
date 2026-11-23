import express from 'express';
import { readForm, UnsupportedFormError } from '../forms/read.ts';
import { classifyForm, ROLE_NAMES } from '../forms/classify.ts';
import { logError } from './logger.ts';

/** 양식 분석 API. 올린 파일은 메모리에서만 읽고 디스크에 저장하지 않는다. */
export function formsRouter() {
  const router = express.Router();

  router.post('/analyze', express.raw({ type: '*/*', limit: '30mb' }), async (req, res) => {
    const body = req.body as Buffer | undefined;
    if (!body || !Buffer.isBuffer(body) || body.length === 0) {
      res.status(400).json({ error: '파일이 비어 있습니다.' });
      return;
    }
    try {
      const doc = await readForm(new Uint8Array(body));
      const classification = classifyForm(doc);
      res.json({ roleNames: ROLE_NAMES, document: doc, classification });
    } catch (err) {
      if (err instanceof UnsupportedFormError) {
        res.status(415).json({ error: err.message });
        return;
      }
      logError('양식 분석', err);
      res.status(422).json({ error: '파일을 읽지 못했습니다. 파일이 손상되었거나 암호가 걸려 있을 수 있습니다.' });
    }
  });

  return router;
}
