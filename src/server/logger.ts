/**
 * 오류 로그. 사례 내용이나 개인정보를 남기지 않도록 오류 종류와 위치만 기록한다.
 * 요청 본문, 파일 내용, 오류 메시지 원문(사례 내용이 섞일 수 있음)은 기록하지 않는다.
 */
export function logError(where: string, err: unknown): void {
  const kind = err instanceof Error ? err.name : typeof err;
  console.error(`[오류] ${new Date().toISOString()} ${where} (${kind})`);
}

export function logInfo(message: string): void {
  console.log(`[사례비서] ${message}`);
}
