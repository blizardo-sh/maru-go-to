import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { releaseSourceFile } from './delivery';
const root = resolve(import.meta.dir, '..');
assert.equal(Bun.version, JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')).packageManager.split('@').at(-1), 'Use the pinned Bun runtime');
const paths = ['src', 'assets/canvas', 'public', 'materials', 'db', 'dist', 'scripts/release-candidate.ts', 'scripts/delivery.ts', 'release-provenance.json', 'package.json', 'bun.lock', 'bunfig.toml', 'tsconfig.json', 'vite.config.ts', 'index.html', 'legacy.html', 'tokens.css', 'drizzle.config.ts', 'Dockerfile', '.dockerignore', 'deployment/Caddyfile', 'deployment/compose.yaml', 'deployment/init-db.sh', 'deployment/nginx-http.conf'];
// Bind dist to the exact source tree being packaged; stale builds cannot become candidates.
for (const command of ['typecheck', 'build']) {
  const result = Bun.spawnSync([process.execPath, 'run', command], { cwd: root, env: { ...process.env, PATH: resolve(process.execPath, '..') + ':' + process.env.PATH }, stdout: 'inherit', stderr: 'inherit' });
  assert.equal(result.exitCode, 0, command + ' failed');
}
const files: Record<string, { sha256: string; bytes: number }> = {};
const hash = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex');
function scan(path: string) {
  const stat = lstatSync(path); assert.ok(!stat.isSymbolicLink(), 'No source symlinks in a release');
  if (stat.isDirectory()) for (const name of readdirSync(path).sort()) scan(resolve(path, name));
  else { const name = relative(root, path); if (!releaseSourceFile(name)) return; assert.ok(!/(^|\/)(\.local|\.env|node_modules|verification|test-results)(\/|$)|fixtures|\.log$/.test(name), name); const bytes = readFileSync(path); if (/\.(ts|tsx|json|md|txt|html|css)$/.test(name)) assert.ok(!/\/Users\/|postgres(?:ql)?:\/\/[^\s]+:[^\s]+@/.test(bytes.toString()), 'Private path or database credential: ' + name); files[name] = { sha256: hash(bytes), bytes: bytes.length }; }
}
for (const path of paths) scan(resolve(root, path));
assert.ok(files['dist/index.html'] && files['dist/legacy.html'], 'Build both interfaces first');
const canonical = Object.fromEntries(Object.entries(files).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0));
const id = hash(JSON.stringify(canonical));
const out = resolve(process.argv[2] ?? resolve(root, '.local/releases'), id);
if (existsSync(out)) {
  const present: string[] = [];
  function inspect(directory: string) {
    for (const name of readdirSync(directory)) {
      const path = resolve(directory, name), stat = lstatSync(path);
      assert.ok(!stat.isSymbolicLink(), 'No symlinks in an immutable candidate');
      if (stat.isDirectory()) inspect(path);
      else { assert.ok(stat.isFile(), 'Regular files only'); present.push(relative(out, path)); }
    }
  }
  inspect(out);
  assert.deepEqual(present.sort(), [...Object.keys(canonical), 'release-manifest.json'].sort(), 'Unexpected candidate files');
  const previous = JSON.parse(readFileSync(resolve(out, 'release-manifest.json'), 'utf8'));
  assert.equal(previous.id, id, 'Candidate identity differs');
  assert.deepEqual(previous.files, canonical, 'Existing candidate manifest differs');
  for (const [name, value] of Object.entries(canonical)) assert.equal(hash(readFileSync(resolve(out, name))), value.sha256, 'Immutable candidate changed: ' + name);
  console.log(JSON.stringify({ id, files: Object.keys(files).length, directory: out, reused: true }));
  process.exit(0);
}
mkdirSync(out, { recursive: true, mode: 0o700 });
for (const name of Object.keys(canonical)) { const to = resolve(out, name); mkdirSync(resolve(to, '..'), { recursive: true }); cpSync(resolve(root, name), to); }
writeFileSync(resolve(out, 'release-manifest.json'), JSON.stringify({ format: 1, id, tools: { bun: Bun.version, ...JSON.parse(readFileSync(resolve(root, 'release-provenance.json'), 'utf8')).tools }, provenance: 'release-provenance.json', interfaces: { canvas: '/index.html', compatibleReact: '/legacy.html', storage: 'same origin and browser profile; no database restore' }, files: canonical }, null, 2) + '\n');
console.log(JSON.stringify({ id, files: Object.keys(files).length, directory: out }));
