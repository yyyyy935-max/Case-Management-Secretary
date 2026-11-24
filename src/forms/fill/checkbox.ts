/** 체크 기호 찾기와 바꾸기. 칸 글에서 "□ 가정방문" 같은 선택지를 찾아 체크할 □의 위치를 돌려준다. */

const BOX = /[□☐▢◻\u{F02EB}]/u;

export interface BoxOption {
  /** 칸 글 전체에서 □의 위치 (글자 단위, 코드 포인트 기준) */
  index: number;
  /** □ 뒤의 선택지 이름 */
  label: string;
}

/** 칸 글에서 선택지 목록을 뽑는다. 선택지 이름은 다음 □나 줄 끝까지의 글(괄호 속 빈칸은 뺌) */
export function boxOptions(text: string): BoxOption[] {
  const cps = [...text];
  const out: BoxOption[] = [];
  for (let i = 0; i < cps.length; i++) {
    if (!BOX.test(cps[i]!)) continue;
    let j = i + 1;
    while (j < cps.length && !BOX.test(cps[j]!) && cps[j] !== '\n') j++;
    let label = cps.slice(i + 1, j).join('').trim();
    // "유 □ 무 □"처럼 □가 뒤에 오는 양식: 앞 글을 이름으로 쓴다
    if (!label) {
      let k = i - 1;
      while (k >= 0 && !BOX.test(cps[k]!) && cps[k] !== '\n') k--;
      label = cps.slice(k + 1, i).join('').trim();
    }
    out.push({ index: i, label });
  }
  return out;
}

const norm = (s: string) => s.replace(/\s+/g, '').replace(/\(\s*\)$/, '');

/** 체크할 선택지 이름들로 □ 위치를 찾는다. 찾지 못한 이름은 missing으로 돌려준다 */
export function findBoxes(text: string, wanted: string[]): { indexes: number[]; missing: string[] } {
  const opts = boxOptions(text);
  const indexes: number[] = [];
  const missing: string[] = [];
  for (const w of wanted) {
    const n = norm(w);
    const hit = opts.find((o) => norm(o.label) === n) ?? opts.find((o) => norm(o.label).startsWith(n));
    if (hit) indexes.push(hit.index);
    else missing.push(w);
  }
  return { indexes, missing };
}
