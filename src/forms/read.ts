import { detectFormat, detectZipFormat, hwpToHwpx, isZipFile } from 'kordoc';
import type { FormDocument } from './types.ts';
import { readHwpx } from './read-hwpx.ts';
import { readDocx } from './read-docx.ts';

export class UnsupportedFormError extends Error {
  override name = 'UnsupportedFormError';
}

/**
 * 양식 파일을 읽는다. 원본 파일은 바꾸지 않는다.
 * HWP는 구조를 읽기 위해 메모리 안에서만 HWPX로 바꿔 읽는다. 결과 파일은 언제나 원본 형식으로 만든다(2단계).
 */
export async function readForm(data: Uint8Array): Promise<FormDocument> {
  const buf = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
  // ZIP 계열(HWPX·DOCX)은 앞부분만 보면 구분되지 않으므로 압축 안의 파일 목록으로 판별한다
  const type = isZipFile(buf) ? await detectZipFormat(buf) : detectFormat(buf);
  switch (type) {
    case 'hwp': {
      const hwpx = await hwpToHwpx(data);
      return readHwpx(hwpx, 'hwp');
    }
    case 'hwpx':
      return readHwpx(data, 'hwpx');
    case 'docx':
      return readDocx(data);
    case 'hwp3':
      throw new UnsupportedFormError('한글 97 이전(HWP 3.x) 파일은 지원하지 않습니다. 한글에서 열어 새 형식으로 저장한 뒤 올려 주세요.');
    case 'pdf':
      throw new UnsupportedFormError('PDF 양식은 2차 개발 범위입니다(요구사항 4.7). 지금은 HWP, HWPX, DOCX만 읽습니다.');
    default:
      throw new UnsupportedFormError('HWP, HWPX, DOCX 파일만 읽을 수 있습니다.');
  }
}
