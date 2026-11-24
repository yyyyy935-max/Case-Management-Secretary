import express from 'express';
import { readForm, UnsupportedFormError } from '../forms/read.ts';
import { classifyForm, ROLE_NAMES } from '../forms/classify.ts';
import { formFingerprint, TemplateStore } from '../forms/templates.ts';
import { logError } from './logger.ts';
import { fillForm, type FillValue } from '../forms/fill/index.ts';
import { verifyFill } from '../forms/fill/verify.ts';
import { comparePages } from '../forms/fill/preview.ts';
import type { AppConfig } from './config.ts';

/** 양식 분석 API. 올린 파일은 메모리에서만 읽고 디스크에 저장하지 않는다. 담당자가 고친 칸 역할(템플릿)만 저장한다. */
export function formsRouter(store: TemplateStore, config: AppConfig) {
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

  /**
   * 사람이 정한 값으로 양식을 채운다(2단계). 원본과 같은 형식의 파일, 9.2 검사 결과, 쪽 비교 그림을 돌려준다.
   * 올린 파일과 결과 파일은 디스크에 저장하지 않는다.
   */
  router.post('/fill', express.json({ limit: '60mb' }), async (req, res) => {
    const { fileBase64, fileName, values } = req.body ?? {};
    if (typeof fileBase64 !== 'string' || typeof values !== 'object' || values === null) {
      res.status(400).json({ error: '채울 내용이 올바르지 않습니다.' });
      return;
    }
    try {
      const original = new Uint8Array(Buffer.from(fileBase64, 'base64'));
      const doc = await readForm(original);
      const template = store.get(formFingerprint(doc));
      const request = { values: values as Record<string, FillValue>, checkMark: config.checkMark, source: 'human' as const };
      const result = await fillForm(original, request, template?.overrides);
      const checks = await verifyFill(original, result, request);
      const previews = await comparePages(original, result.data, doc, result.applied).catch(() => []);
      const base = typeof fileName === 'string' ? fileName.replace(/\.[^.]+$/, '') : '양식';
      res.json({
        fileName: `${base}_채움.${result.format}`,
        fileBase64: Buffer.from(result.data).toString('base64'),
        format: result.format,
        applied: result.applied,
        skipped: result.skipped,
        warnings: result.warnings,
        pages: result.pages ?? null,
        checks,
        previews,
      });
    } catch (err) {
      if (err instanceof UnsupportedFormError) {
        res.status(415).json({ error: err.message });
        return;
      }
      logError('양식 채우기', err);
      res.status(422).json({ error: '양식을 채우지 못했습니다.' });
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
