import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
const root = new URL('.', import.meta.url).pathname;
const source = 'b378244d9fc40a357dc8fafd931400e42b7e1752';
const privateRoot = resolve(root, '.local/rehearsal-20261028'), release = resolve(privateRoot, 'server-release');
mkdirSync(privateRoot, { recursive: true, mode: 0o700 });
if (!existsSync(release)) {
  const archive = resolve(privateRoot, 'source.tar');
  execFileSync('git', ['archive', '--format=tar', `--output=${archive}`, source], { cwd: root });
  mkdirSync(release, { mode: 0o700 });
  execFileSync('tar', ['-xf', archive, '-C', release]); rmSync(archive);
}
for (const path of ['package.json', 'bun.lock', 'src/server/index.ts', 'src/server/app.ts', 'src/server/learning.ts', 'src/server/publications.ts', 'src/shared/learning.ts', 'src/client/api.ts', 'src/client/guidedApi.ts']) {
  assert.deepEqual(readFileSync(resolve(release, path)), execFileSync('git', ['show', `${source}:${path}`], { cwd: root, maxBuffer: 10 * 1024 * 1024 }), `Pinned source changed: ${path}`);
}
assert.deepEqual(readFileSync(resolve(release, 'package.json')), readFileSync(resolve(root, '../../package.json')), 'Server dependencies differ from the pinned release');
if (!existsSync(resolve(release, 'node_modules'))) symlinkSync(resolve(root, '../../node_modules'), resolve(release, 'node_modules'), 'dir');
writeFileSync(resolve(privateRoot, 'source-revision'), source + '\n', { mode: 0o600 });
