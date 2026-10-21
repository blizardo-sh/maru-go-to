import { expect, test } from 'bun:test';
import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';
import { hc } from 'hono/client';
import { createEmptyCard, fsrs, Rating } from 'ts-fsrs';
import pino from 'pino';
import { readFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';

test('direct dependency pins satisfy installed peer constraints', () => {
  const manifest = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));
  const selected: Record<string, string> = { ...manifest.dependencies, ...manifest.devDependencies };
  for (const [name, version] of Object.entries(selected)) {
    expect(version).toMatch(/^\d+\.\d+\.\d+$/);
    const installed = JSON.parse(readFileSync(new URL(`./node_modules/${name}/package.json`, import.meta.url), 'utf8'));
    const resolve = createRequire(new URL(`./node_modules/${name}/package.json`, import.meta.url));
    expect(installed.version).toBe(version);
    for (const [peer, range] of Object.entries(installed.peerDependencies ?? {})) {
      let path: string | undefined;
      try { path = resolve.resolve(`${peer}/package.json`); } catch { /* Optional, uninstalled integration. */ }
      if (path && existsSync(path)) {
        const peerVersion = JSON.parse(readFileSync(path, 'utf8')).version;
        if (!Bun.semver.satisfies(peerVersion, String(range))) {
          throw new Error(`${name} requires ${peer} ${range}; installed ${peerVersion}`);
        }
      } else {
        expect(installed.peerDependenciesMeta?.[peer]?.optional).toBe(true);
      }
    }
  }
  expect(Bun.version).toBe('1.4.3');
});

test('Hono schema validation and OpenAPI use the pinned Zod', async () => {
  const app = new OpenAPIHono();
  const route = createRoute({ method: 'post', path: '/probe', request: { body: { content: {
    'application/json': { schema: z.object({ answer: z.string().min(1) }) },
  } } }, responses: { 200: { description: 'Accepted', content: {
    'application/json': { schema: z.object({ accepted: z.boolean() }) },
  } } } });
  const routes = app.openapi(route, (c) => c.json({ accepted: c.req.valid('json').answer === '家族' }, 200));
  app.doc('/openapi.json', { openapi: '3.0.0', info: { title: 'Probe', version: '1' } });
  const send = (body: unknown) => app.request('/probe', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  expect((await send({ answer: 42 })).status).toBe(400);
  expect(await (await send({ answer: '家族' })).json()).toEqual({ accepted: true });
  const spec = await (await app.request('/openapi.json')).json();
  expect(spec.paths['/probe'].post).toBeDefined();
  const client = hc<typeof routes>('http://probe', { fetch: (input: RequestInfo | URL, init?: RequestInit) => app.request(input, init) });
  expect(await (await client.probe.$post({ json: { answer: '家族' } })).json()).toEqual({ accepted: true });
});

test('FSRS executes on Bun and distinguishes Again from Good', () => {
  const now = new Date('2026-10-20T12:00:00Z');
  const scheduler = fsrs();
  const card = createEmptyCard(now);
  const good = scheduler.next(card, now, Rating.Good).card;
  const again = scheduler.next(card, now, Rating.Again).card;
  expect(good.due.getTime()).toBeGreaterThan(again.due.getTime());
  expect(good.reps).toBe(1);
});

test('Pino produces structured JSON on Bun without a worker transport', () => {
  let line = '';
  const log = pino({ redact: ['password'] }, { write(chunk: string) { line += chunk; } });
  log.info({ requestId: 'probe', password: 'local-test-secret' }, 'checked');
  const parsed = JSON.parse(line);
  expect(parsed.requestId).toBe('probe');
  expect(parsed.password).toBe('[Redacted]');
});

test('Bun HTTP explicit idle timeout allows a response after 10 seconds', async () => {
  const server = Bun.serve({ hostname: '127.0.0.1', port: 0, idleTimeout: 30, async fetch() {
    await Bun.sleep(11000);
    return Response.json({ done: true });
  } });
  try {
    const response = await fetch(server.url, { signal: AbortSignal.timeout(15000) });
    expect(await response.json()).toEqual({ done: true });
  } finally { await server.stop(true); }
});

test('Bun graceful stop lets an active request complete', async () => {
  let release!: () => void;
  let entered!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const started = new Promise<void>((resolve) => { entered = resolve; });
  const server = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch() {
    entered();
    await gate;
    return new Response('completed');
  } });
  const request = fetch(server.url, { signal: AbortSignal.timeout(5000) });
  try {
    await started;
    const stopping = server.stop();
    release();
    expect(await (await request).text()).toBe('completed');
    await stopping;
  } finally { release(); await server.stop(true); }
});
