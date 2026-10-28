import assert from 'node:assert/strict';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { chromium, webkit } from '@playwright/test';
const out = new URL('./test-results/presentation/', import.meta.url); await mkdir(out, { recursive: true });
const fixture = JSON.parse(await readFile(new URL('./paper-fixtures.json', import.meta.url)));
const state = p => p.evaluate(() => window.__PAPER__.snapshot());
async function settled(p) { await p.waitForFunction(() => !window.__PAPER__.snapshot().pendingRender); await p.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))); }
async function load(p, task, composition = 'window') { await p.goto(`http://127.0.0.1:5190/paper.html?task=${task}&composition=${composition}`); await p.waitForFunction(() => window.__PAPER__?.snapshot().ready); await settled(p); }
async function click(p, id) {
  await settled(p); let value = await state(p), control = value.controls.find(c => c.id === id); assert.ok(control?.enabled, `Unavailable ${id}`);
  if (!control.docked) await p.evaluate(({ y, top }) => scrollTo(0, Math.max(0, y - top / 2)), { y: control.rect.y, top: value.dock?.top ?? await p.evaluate(() => innerHeight) });
  await settled(p); control = (await state(p)).controls.find(c => c.id === id); const scroll = await p.evaluate(() => scrollY);
  await p.mouse.click(control.rect.x + control.rect.width / 2, control.rect.y + control.rect.height / 2 - scroll); await settled(p);
}
async function position(p, id) { const r = (await state(p)).controls.find(c => c.id === id).rect; return { x: r.x, y: r.y - await p.evaluate(() => scrollY), width: r.width, height: r.height }; }
function luminance(hex) { return hex.slice(1).match(/../g).map(n => parseInt(n, 16) / 255).map(n => n <= .04045 ? n / 12.92 : ((n + .055) / 1.055) ** 2.4).reduce((n, v, i) => n + v * [.2126, .7152, .0722][i], 0); }
const result = { date: new Date().toISOString(), browsers: {} };
for (const [name, engine, options] of [['chrome', chromium, { channel: 'chrome' }], ['webkit', webkit, {}]]) {
  const browser = await engine.launch({ ...options, headless: true });
  try {
    const p = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' }), errors = [], sizes = [];
    p.on('pageerror', e => errors.push(e.message));
    for (const [width, height] of [[1440, 1000], [1538, 1468], [390, 844], [320, 640]]) {
      await p.setViewportSize({ width, height }); await load(p, 'word-intro'); const intro = await position(p, 'intro-next'), introHeight = (await state(p)).contentBottom;
      await load(p, 'construction-intro'); assert.deepEqual(await position(p, 'intro-next'), intro); assert.notEqual((await state(p)).contentBottom, introHeight);
      await p.evaluate(() => scrollTo(0, document.documentElement.scrollHeight)); await settled(p); assert.deepEqual(await position(p, 'intro-next'), intro);
      await load(p, 'word-ja'); const next = await position(p, 'next');
      await click(p, 'word-option-0'); let value = await state(p);
      assert.equal(value.feedbackSpeaker, 'cat'); assert.ok(value.speechBounds); assert.equal(value.autoAdvance, true);
      assert.ok(value.controls.filter(c => c.id.startsWith('word-option-')).every(c => c.opacity === 1));
      assert.ok((luminance(value.colors.bubble) + .05) / (luminance(value.colors.ink) + .05) >= 7);
      await p.waitForTimeout(350); assert.equal((await state(p)).wordIndex, 0);
      await p.waitForFunction(() => window.__PAPER__.snapshot().wordIndex === 1); await settled(p); assert.deepEqual(await position(p, 'next'), next);
      await load(p, 'word-ja'); await click(p, 'word-option-1'); assert.equal((await state(p)).autoAdvance, false);
      await p.waitForTimeout(1350); assert.equal((await state(p)).wordIndex, 0);
      await load(p, 'word-ja'); await click(p, 'word-option-0'); await click(p, 'auto-pause'); await p.waitForTimeout(1350); assert.equal((await state(p)).wordIndex, 0);
      await click(p, 'next'); assert.equal((await state(p)).wordIndex, 1);
      sizes.push({ width, height, actions: 'same viewport position across different card heights and scroll', success: 'advances after delay', wrong: 'stays', pause: 'stays', contrast: '>=7:1', disabledAnswerOpacity: 1 });
    }
    const compositions = [];
    await load(p, 'count-category');
    const counter = fixture.counterCards.find(c => c.kind === 'image-counter');
    await click(p, `count-option-${counter.options.findIndex(o => counter.acceptedKeys.includes(o.key))}`);
    assert.equal((await state(p)).autoAdvance, true);
    await p.waitForFunction(() => window.__PAPER__.snapshot().selection === null); await settled(p);
    for (const [width, height] of [[1440, 1000], [1538, 1468]]) for (const mode of ['zoom', 'window', 'surround']) {
      await p.setViewportSize({ width, height }); await load(p, 'word-ja', mode); await click(p, 'word-option-0'); await click(p, 'auto-pause');
      const value = await state(p), scroll = await p.evaluate(() => scrollY);
      assert.equal(value.composition, mode); assert.deepEqual(value.rotatedUi, []); assert.deepEqual(value.cspViolations, []);
      assert.ok(value.catBounds.y - scroll >= 140 && value.catBounds.y - scroll + value.catBounds.height < value.dock.stageHeight);
      await p.screenshot({ path: new URL(`${name}-${mode}-${width}.jpg`, out).pathname, type: 'jpeg', quality: 85 }); compositions.push(`${mode}/${width}`);
    }
    await p.setViewportSize({ width: 1440, height: 1000 }); await load(p, 'textbook'); await click(p, 'lesson-1'); await click(p, 'lesson-start');
    const ticket = (await state(p)).lesson.ticket;
    await click(p, 'menu'); await click(p, 'composition-surround'); assert.deepEqual((await state(p)).lesson.ticket, ticket);
    await p.emulateMedia({ reducedMotion: 'no-preference' }); await click(p, 'menu'); await click(p, 'composition-zoom');
    assert.ok((await state(p)).cameraProgress < 1); await click(p, 'skip-camera'); assert.equal((await state(p)).cameraProgress, 1);
    await p.emulateMedia({ reducedMotion: 'reduce' }); await click(p, 'menu'); await click(p, 'composition-zoom'); assert.equal((await state(p)).cameraProgress, 1);
    assert.deepEqual(errors, []);
    result.browsers[name] = { sizes, compositions, camera: 'entry transition, skip and reduced motion passed', sameLessonOnCompositionChange: true, errors };
    console.log(`${name}: fixed actions, auto-advance, contrast, cat dialogue and three compositions passed`);
  } finally { await browser.close(); }
}
await writeFile(new URL('checks.json', out), JSON.stringify(result, null, 2) + '\n');
