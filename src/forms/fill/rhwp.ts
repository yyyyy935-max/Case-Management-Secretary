import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

/** rhwp(WASM) 한 번만 초기화해서 쓴다 */
type Rhwp = typeof import('@rhwp/core');
let mod: Rhwp | undefined;

export async function loadRhwp(): Promise<Rhwp> {
  if (mod) return mod;
  const m = (await import('@rhwp/core')) as Rhwp;
  const require = createRequire(import.meta.url);
  const wasm = readFileSync(join(dirname(require.resolve('@rhwp/core/package.json')), 'rhwp_bg.wasm'));
  m.initSync({ module: wasm });
  mod = m;
  return m;
}
