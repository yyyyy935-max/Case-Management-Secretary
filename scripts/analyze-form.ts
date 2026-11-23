/**
 * 양식 파일의 칸 분류 결과를 표로 만든다.
 * 사용법: npm run analyze -- <양식 파일> [결과 파일.md]
 * 결과에는 양식의 글이 들어가므로 test-data/reports/ 아래(저장소에 올라가지 않음)에 두는 것을 권장한다.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, basename } from 'node:path';
import { readForm } from '../src/forms/read.ts';
import { classifyForm, ROLE_NAMES, type CellRole } from '../src/forms/classify.ts';

const [file, outArg] = process.argv.slice(2);
if (!file) {
  console.error('사용법: npm run analyze -- <양식 파일> [결과 파일.md]');
  process.exit(1);
}
const doc = await readForm(readFileSync(file));
const cls = classifyForm(doc);
const byId = new Map(cls.cells.map((c) => [c.id, c]));
const short = (s: string, n = 40) => {
  const t = s.replace(/\s+/g, ' ').trim();
  return (t.length > n ? t.slice(0, n) + '…' : t).replace(/\|/g, '\\|');
};

const lines: string[] = [];
lines.push(`# 칸 분류 결과: ${basename(file)}`, '');
lines.push(`- 형식: ${doc.format.toUpperCase()} / 표 ${doc.tables.length}개(셀 안 표 포함) / 칸 ${cls.cells.length}개 / 본문 채움 문단 ${cls.body.length}개`, '');

const roles = Object.keys(ROLE_NAMES) as CellRole[];
const groups = [...new Set(doc.tables.map((t) => t.groupTitle ?? '(제목 없음)'))];
lines.push('## 양식별 역할 개수', '', `| 양식 | ${roles.map((r) => ROLE_NAMES[r]).join(' | ')} | 합계 |`, `|---|${roles.map(() => '---:').join('|')}|---:|`);
for (const g of groups) {
  const cells = doc.tables.filter((t) => (t.groupTitle ?? '(제목 없음)') === g).flatMap((t) => t.cells.map((c) => byId.get(c.id)!));
  const body = cls.body.filter((b) => (doc.bodyParagraphs.find((p) => p.id === b.id)?.groupTitle ?? '(제목 없음)') === g);
  const all = [...cells, ...body];
  lines.push(`| ${g} | ${roles.map((r) => all.filter((c) => c.role === r).length || '').join(' | ')} | ${all.length} |`);
}
lines.push('');

for (const g of groups) {
  lines.push(`## ${g}`, '');
  for (const t of doc.tables.filter((t) => (t.groupTitle ?? '(제목 없음)') === g)) {
    lines.push(`### 표 ${t.index} (${t.rows}행 × ${t.cols}열)${t.parentCellId ? ` — ${t.parentCellId} 칸 안의 표` : ''}`, '');
    lines.push('| 칸 | 역할 | 칸 안의 글 | 항목명(행 / 열) | 이유 |', '|---|---|---|---|---|');
    for (const c of t.cells) {
      const k = byId.get(c.id)!;
      const labels = [k.rowLabel, k.colLabel].map((l) => (l ? short(l, 18) : '-')).join(' / ');
      lines.push(`| ${c.id} | **${ROLE_NAMES[k.role]}** | ${short(c.text) || '(빈칸)'} | ${['label', 'fixed'].includes(k.role) ? '' : labels} | ${short(k.reason, 60)}${k.warning ? ` ⚠ ${k.warning}` : ''} |`);
    }
    lines.push('');
  }
  const body = cls.body.filter((b) => doc.bodyParagraphs.find((p) => p.id === b.id)?.groupTitle === g);
  if (body.length) {
    lines.push('### 본문 문단', '', '| 문단 | 역할 | 글 | 이유 |', '|---|---|---|---|');
    for (const b of body) lines.push(`| ${b.id} | **${ROLE_NAMES[b.role]}** | ${short(doc.bodyParagraphs.find((p) => p.id === b.id)!.paragraph.text, 50)} | ${b.reason} |`);
    lines.push('');
  }
}

const out = outArg ?? `test-data/reports/${basename(file).replace(/\.[^.]+$/, '')}-칸분류.md`;
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, lines.join('\n'));
console.log(`저장함: ${out}`);
