import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';

const endpoint = 'http://127.0.0.1:5192';
const output = new URL('./test-results/', import.meta.url);
await mkdir(output, { recursive: true });
async function command(path, body, method = body === undefined ? 'GET' : 'POST') {
  const response = await fetch(endpoint + path, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(35000) });
  const { value } = await response.json();
  if (!response.ok) throw new Error(value?.message || value?.error || JSON.stringify(value) || `WebDriver ${response.status}`);
  return value;
}
const created = process.env.SAFARI_SESSION ? null : await command('/session', { capabilities: { alwaysMatch: { browserName: 'safari' } } });
const session = process.env.SAFARI_SESSION ?? created.sessionId;
const path = `/session/${session}`;
const js = (fn, ...args) => command(path + '/execute/sync', { script: `return (${fn.toString()})(...arguments)`, args });
const state = () => js(() => window.__LAB__?.snapshot());
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(fn, name) {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) { const value = await fn(); if (value) return value; await delay(100); }
  throw new Error(`Timed out: ${name}`);
}
async function load(query) {
  await command(path + '/url', { url: 'http://127.0.0.1:5190/?' + query });
  await until(async () => (await state())?.ready, 'Canvas ready');
  await delay(150);
}
async function click(id) {
  const control = await until(async () => (await state()).controls.find(c => c.id === id), id);
  const element = await command(path + '/element', { using: 'css selector', value: `button[aria-label=${JSON.stringify(control.label)}]` });
  await command(path + `/element/${element['element-6066-11e4-a52e-4f735466cecf']}/value`, { text: '\uE007' });
  await delay(150);
  await until(async () => !(await state()).pendingRender, 'click render');
}
async function fill(selector, text) {
  const element = await command(path + '/element', { using: 'css selector', value: selector });
  const id = element['element-6066-11e4-a52e-4f735466cecf'];
  await command(path + `/element/${id}/clear`, {});
  await command(path + `/element/${id}/value`, { text });
  await delay(150);
}
async function screenshot(name) {
  const data = await command(path + '/screenshot');
  await writeFile(new URL(`safari-${name}.png`, output), Buffer.from(data, 'base64'));
}
const result = { date: new Date().toISOString(), browser: created?.capabilities ?? { browserName: 'Safari', browserVersion: '27.0', safariUseSimulator: false }, cases: [], physicalIME: 'manual-required', iPhone: 'manual-required', voiceOver: 'manual-required', passwordAutofill: 'manual-required' };
try {
  await command(path + '/window/rect', { x: 0, y: 25, width: 1440, height: 1050 });
  await load('view=lab');
  const initial = await state();
  assert.equal(initial.renderer, 'WebGL');
  assert.deepEqual(initial.cspViolations, []);
  assert.ok(initial.htmlText.width > 0 && initial.htmlText.height > 0);
  await fill('textarea', '今日は東京です。\n魚を食べます。');
  assert.equal(await js(() => document.activeElement === window.__LAB__.editor), true);
  assert.equal(await js(() => window.__LAB__.editor.value), '今日は東京です。\n魚を食べます。');
  const commits = (await state()).inputCommits;
  await js(() => { const el = window.__LAB__.editor; el.dispatchEvent(new CompositionEvent('compositionstart')); el.dispatchEvent(new InputEvent('input', { isComposing: true })); });
  assert.equal((await state()).inputCommits, commits);
  await js(() => window.__LAB__.editor.dispatchEvent(new CompositionEvent('compositionend')));
  assert.equal((await state()).composing, false);
  await fill('input[type=password]', 'test-only-123');
  assert.equal((await state()).passwordLength, 13);
  await screenshot('lab');
  console.log('Safari: ruby and native input passed; synthetic composition only');
  await click('probe-video');
  const media = await until(async () => { const value = (await state()).video; return typeof value === 'object' && value; }, 'official video');
  assert.equal(media.native, 'playing'); assert.equal(media.crossOrigin, 'blocked'); assert.equal(media.upload, 'SecurityError');
  await click('pause-video');
  assert.equal(await js(() => window.__LAB__.video.paused), true);
  const time = await js(() => window.__LAB__.video.currentTime);
  await click('seek-video');
  assert.ok(await js(() => window.__LAB__.video.currentTime) >= time + 4.5);
  await screenshot('video'); result.video = media;
  result.viewport = await js(() => ({ width: innerWidth, height: innerHeight, dpr: devicePixelRatio }));
  assert.deepEqual((await state()).cspViolations, []);
  result.userAgent = await js(() => navigator.userAgent);
  result.contextRecovery = 'not-verified; Safari WebDriver offscreen focus/zoom blocked the extended run';
  result.activation = 'native keyboard; pointer still requires manual verification';
  result.cspViolations = [];
  result.status = 'passed-basic-probes';
  console.log('Safari: basic probes passed: WebGL, ruby, input, password masking, native video, CORS/WebGL restriction, CSP. Extended UI/recovery and physical IME remain open.');
} catch (error) {
  result.status = 'failed'; result.error = String(error); result.snapshot = await state().catch(() => null); await screenshot('failure').catch(() => {}); throw error;
} finally {
  await writeFile(new URL('safari-checks.json', output), JSON.stringify(result, null, 2) + '\n');
  await command(path, undefined, 'DELETE');
}
