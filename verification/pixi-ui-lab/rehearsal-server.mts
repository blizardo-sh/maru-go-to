import { readFileSync, realpathSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import assert from 'node:assert/strict';
import { createApp } from './.local/rehearsal-20261028/server-release/src/server/app';
import { connectDatabase } from './.local/rehearsal-20261028/server-release/src/server/db';
import { currentPublication, getPublication, legacyPublication } from './.local/rehearsal-20261028/server-release/src/server/publications';
import { configSchema } from './.local/rehearsal-20261028/server-release/src/server/config';

const root = new URL('.', import.meta.url).pathname;
const privateRoot = resolve(root, '.local/rehearsal-20261028');
const runtime = JSON.parse(readFileSync(resolve(privateRoot, 'runtime.json'), 'utf8'));
assert.equal(new URL(runtime.database).hostname, '127.0.0.1');
assert.equal(new URL(runtime.database).pathname, '/japanese_pixi_work');
assert.equal(runtime.origin, 'http://localhost:5191');
// Free input cannot spend a real provider key in this local rehearsal.
const analysis = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: () => Response.json({ choices: [{ message: { content: JSON.stringify({ translationRu: 'Локальная проба свободного ввода', grammar: 'uncertain', naturalness: 'uncertain', explanationRu: 'В стенде внешний анализ отключён. Подготовленные ответы проверяет настоящий сервер.', warnings: ['Локальный образец анализа.'] }) } }] }) });
const config = configSchema.parse({ DATABASE_URL: runtime.database, APP_URL: runtime.origin, BETTER_AUTH_SECRET: runtime.secret,
  ANALYSIS_PROVIDER: 'generic', ANALYSIS_URL: `${analysis.url.origin}/chat/completions`, ANALYSIS_MODEL: 'local-stand-fixture', ANALYSIS_FREE_ONLY: 'true' });
const database = connectDatabase(runtime.database), course = await currentPublication(database);
const app = createApp({ database, config, course, publications: (id, old) => id ? getPublication(database, id) : old ? legacyPublication(database) : currentPublication(database) });
const csp = readFileSync(resolve(root, '../../deployment/nginx-http.conf'), 'utf8').match(/add_header Content-Security-Policy "([^"]+)" always;/)?.[1];
assert.ok(csp);
const staticRoots = [resolve(root, 'dist'), resolve(privateRoot, 'server-release/dist'), resolve(privateRoot, 'content/media'), resolve(privateRoot, 'server-release/public'), resolve(root, '../../public')];
const headers = { 'Content-Security-Policy': csp, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' };
const server = Bun.serve({ hostname: '127.0.0.1', port: 5191, idleTimeout: 30, async fetch(request) {
  const url = new URL(request.url);
  if (url.host !== 'localhost:5191') return new Response('Use http://localhost:5191', { status: 403 });
  if (url.pathname.startsWith('/api/')) {
    // Ports share cookies. Only the stand namespace can authenticate this copied database.
    const incoming = new Headers(request.headers);
    incoming.set('cookie', (incoming.get('cookie') ?? '').split(';').map(value => value.trim()).filter(value => value.startsWith('pixi-stand.')).map(value => value.replace(/^pixi-stand\./, 'better-auth.')).join('; '));
    const response = await app.fetch(new Request(request, { headers: incoming }));
    const outgoing = new Headers(response.headers), cookies = outgoing.getSetCookie(); outgoing.delete('set-cookie');
    for (const cookie of cookies) outgoing.append('set-cookie', cookie.replace(/^better-auth\./, 'pixi-stand.'));
    for (const [name, value] of Object.entries(headers)) outgoing.set(name, value);
    return new Response(response.body, { status: response.status, headers: outgoing });
  }
  if (url.pathname === '/') return Response.redirect(`${runtime.origin}/learn.html`, 302);
  if (url.pathname === '/__meta') return Response.json({ local: true, snapshot: runtime.snapshot, source: runtime.source, productionWrites: false });
  let pathname: string;
  try { pathname = decodeURIComponent(url.pathname); } catch { return new Response(null, { status: 400 }); }
  if (pathname.includes('\0') || pathname.split('/').includes('..') || pathname.includes('\\')) return new Response(null, { status: 400 });
  const media = /^\/(audio|word-illustrations|counters)\//.test(pathname);
  const roots = pathname === '/legacy.html' ? [staticRoots[1]!] : media ? staticRoots.slice(2, 4) : staticRoots;
  for (const base of roots) {
    const file = resolve(base, '.' + (pathname === '/legacy.html' ? '/index.html' : pathname));
    if (!file.startsWith(base + sep)) continue;
    const blob = Bun.file(file);
    if (!await blob.exists()) continue;
    if (!realpathSync(file).startsWith(realpathSync(base) + sep)) return new Response(null, { status: 403 });
    return new Response(blob, { headers });
  }
  return new Response(null, { status: 404, headers });
} });
console.log(`Local copied-database stand: ${runtime.origin}/learn.html`);
for (const signal of ['SIGTERM', 'SIGINT'] as const) process.on(signal, async () => { await server.stop(true); await analysis.stop(true); await database.sql.close(); process.exit(0); });
