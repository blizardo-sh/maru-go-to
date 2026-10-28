import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
const root = new URL('./.local/rehearsal-20261028/', import.meta.url);
const profile = JSON.parse(await readFile(new URL('login.json', root)))[0];
const endpoint = 'http://127.0.0.1:5192';
async function command(path, body, method = body === undefined ? 'GET' : 'POST') {
  const response = await fetch(endpoint + path, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(35000) });
  const { value } = await response.json(); if (!response.ok) throw new Error(value?.message ?? `WebDriver ${response.status}`); return value;
}
const created = await command('/session', { capabilities: { alwaysMatch: { browserName: 'safari' } } });
const path = `/session/${created.sessionId}`;
const js = (fn, ...args) => command(path + '/execute/sync', { script: `return (${fn.toString()})(...arguments)`, args });
const state = () => js(() => window.__PAPER__?.snapshot());
async function until(fn) { const deadline = Date.now() + 30000; while (Date.now() < deadline) { const value = await fn(); if (value) return value; await new Promise(resolve => setTimeout(resolve, 120)); } throw new Error('Safari wait timed out'); }
async function element(selector) { const e = await command(path + '/element', { using: 'css selector', value: selector }); return `${path}/element/${e['element-6066-11e4-a52e-4f735466cecf']}`; }
async function fill(selector, text) { const e = await element(selector); await command(e + '/clear', {}); await command(e + '/value', { text }); }
async function enter(selector) { await js(selector => document.querySelector(selector).focus(), selector); await command(path + '/actions', { actions: [{ type: 'key', id: 'keyboard', actions: [{ type: 'keyDown', value: '\uE007' }, { type: 'keyUp', value: '\uE007' }] }] }); await until(async () => !(await state()).lesson.busy); await new Promise(resolve => setTimeout(resolve, 200)); }
try {
  await command(path + '/window/rect', { x: 0, y: 25, width: 1440, height: 1050 });
  await command(path + '/url', { url: 'http://localhost:5191/learn.html' }); await until(async () => (await state())?.ready);
  await fill('input[type=email]', profile.email); await fill('input[type=password]', profile.password); await enter('button[aria-label="Войти"]');
  await until(async () => (await state()).lesson.authenticated);
  await enter('button[aria-label^="Урок 4."]'); await enter('button[aria-label^="Продолжить"]');
  const before = (await state()).lesson;
  await command(path + '/refresh', {}); await until(async () => (await state())?.ready); await enter('button[aria-label^="Продолжить"]');
  const after = await state(); assert.equal(after.lesson.version, before.version); assert.equal(after.lesson.step.id, before.step.id); assert.deepEqual(after.cspViolations, []);
  await writeFile(new URL('connected-safari.png', root), Buffer.from(await command(path + '/screenshot'), 'base64'));
  const report = { at: new Date().toISOString(), browser: created.capabilities.browserName, version: created.capabilities.browserVersion, login: true, keyboardControls: true, existingRouteResume: true, csp: after.cspViolations,
    physicalIME: 'manual-required', iPhone: 'manual-required', voiceOver: 'manual-required', passwordAutofill: 'manual-required' };
  await writeFile(new URL('safari-report.json', root), JSON.stringify(report, null, 2) + '\n'); console.log(JSON.stringify(report));
} catch (error) {
  console.log(JSON.stringify(await js(() => ({ lesson: window.__PAPER__?.snapshot().lesson, controls: window.__PAPER__?.snapshot().controls.map(c => c.id), pendingRender: window.__PAPER__?.snapshot().pendingRender, visibility: document.visibilityState, focus: document.activeElement?.getAttribute('aria-label') }))));
  throw error;
} finally { await command(path, undefined, 'DELETE'); }
