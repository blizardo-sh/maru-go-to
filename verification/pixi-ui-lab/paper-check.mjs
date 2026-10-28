import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { chromium, webkit } from '@playwright/test';

const base = 'http://127.0.0.1:5190/paper.html';
const output = new URL('./test-results/paper/', import.meta.url); await mkdir(output, { recursive: true });
const fixture = JSON.parse(await readFile(new URL('./paper-fixtures.json', import.meta.url)));
assert.equal(fixture.courseSha256, createHash('sha256').update(await readFile(new URL('../../materials/course.json', import.meta.url))).digest('hex'));
const state = page => page.evaluate(() => window.__PAPER__.snapshot());
async function settled(page) { await page.waitForFunction(() => !window.__PAPER__.snapshot().pendingRender); await page.waitForTimeout(80); }
async function load(page, task) {
  await page.goto(`${base}?task=${task}`); await page.waitForFunction(() => window.__PAPER__?.snapshot().ready); await settled(page);
}
async function click(page, id) {
  await settled(page);
  let control = await page.evaluate(id => window.__PAPER__.snapshot().controls.find(item => item.id === id), id);
  assert.ok(control?.enabled, `Unavailable ${id} on ${(await state(page)).task}`);
  if (!control.docked) await page.evaluate(({ y, top }) => scrollTo(0, Math.max(0, y - top / 2)), { y: control.rect.y, top: (await state(page)).dock?.top ?? await page.evaluate(() => innerHeight) });
  await settled(page);
  control = (await state(page)).controls.find(item => item.id === id);
  const scroll = await page.evaluate(() => scrollY);
  await page.mouse.click(control.rect.x + control.rect.width / 2, control.rect.y + control.rect.height / 2 - scroll); await settled(page);
}
function geometry(value, width, height) {
  assert.equal(value.fontLoaded, true); assert.deepEqual(value.cspViolations, []);
  const cat = value.catBounds, study = value.studyBounds;
  if (value.catVisible) assert.ok(cat.x >= study.x + study.width + 20 || cat.x + cat.width <= study.x - 20 || cat.y >= study.y + study.height + 20, 'Cat must leave visible study content clear');
  for (const control of value.controls) {
    assert.ok(control.rect.width >= 44 && control.rect.height >= 44, `Small control ${control.id}`);
    assert.ok(control.rect.x >= 0 && control.rect.x + control.rect.width <= width + 1, `Offscreen ${control.id}`);
    assert.ok(control.rect.y + control.rect.height <= height + 1, `Control below canvas ${control.id}`);
  }
  for (const item of value.controlText) {
    if (!item.value) continue;
    if (item.id.startsWith('nav-') || item.id === 'menu' || item.id === 'help') assert.ok(item.fontSize >= 20, `Small navigation type ${item.id}`);
    assert.ok(item.bounds.x >= item.rect.x - 2 && item.bounds.x + item.bounds.width <= item.rect.x + item.rect.width + 2, `Caption outside control ${item.id}: ${item.value}`);
    assert.ok(item.bounds.y >= item.rect.y - 2 && item.bounds.y + item.bounds.height <= item.rect.y + item.rect.height + 2, `Caption too tall ${item.id}: ${item.value}`);
  }
  for (const group of value.ruby) assert.equal(group.overflow, false);
}
const result = { date: new Date().toISOString(), scope: 'Selected overhead Canvas design; offline prototype', browsers: {} };
for (const [name, type, options] of [['chrome', chromium, { channel: 'chrome' }], ['webkit', webkit, {}]]) {
  const browser = await type.launch({ ...options, headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, reducedMotion: 'reduce' });
    const errors = [], requests = [];
    page.on('pageerror', error => { errors.push(error.message); console.error(name, error.message); });
    page.on('request', request => requests.push(request.url()));
    await load(page, 'word-ja'); const tasks = await page.evaluate(() => Object.keys(window.__PAPER__.tasks));
    const matrix = [];
    for (const [width, height] of [[390, 844], [320, 640], [1280, 900], [844, 390]]) {
      await page.setViewportSize({ width, height });
      for (const task of tasks) {
        await load(page, task); const value = await state(page);
        geometry(value, width, await page.locator('canvas').first().evaluate(el => el.clientHeight));
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
        if (width === 390) await page.screenshot({ path: new URL(`${name}-${task}.jpg`, output).pathname, type: 'jpeg', quality: 82 });
        matrix.push(`${width}/${task}`);
      }
      console.log(`${name}: paper layouts ${width}px passed`);
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await load(page, 'word-ja'); assert.equal((await state(page)).hintVisible, true);
    await click(page, 'word-option-0'); assert.equal((await state(page)).correct, true); assert.equal((await state(page)).hintVisible, false);
    await click(page, 'next'); assert.equal((await state(page)).wordIndex, 1); assert.equal((await state(page)).hintVisible, false);
    await click(page, 'help'); assert.equal((await state(page)).hintVisible, true);
    await click(page, 'dismiss-hint'); assert.equal((await state(page)).hintVisible, false);
    await click(page, 'menu'); assert.equal((await state(page)).menuOpen, true);
    assert.ok((await state(page)).controls.filter(item => item.enabled).every(item => item.id.startsWith('nav-') || item.id === 'menu-close'));
    await click(page, 'nav-textbook'); assert.equal((await state(page)).task, 'textbook');
    await click(page, 'lesson-1'); assert.equal((await state(page)).task, 'lesson-overview');
    await click(page, 'lesson-start'); assert.equal((await state(page)).task, 'word-intro');
    await load(page, 'recall-ru'); assert.equal((await state(page)).revealed, false); assert.equal((await state(page)).ruby.length, 0);
    assert.equal(await page.locator('h1.semantic-copy').innerText().then(text => text.includes('魚')), false);
    assert.equal((await page.locator('#canvas-description').textContent()).includes('魚'), false, 'Screen-reader copy must not disclose a hidden answer');
    await click(page, 'reveal'); assert.equal((await state(page)).revealed, true);
    assert.equal((await page.locator('#canvas-description').textContent()).includes('魚'), true);
    await click(page, 'remember'); assert.equal((await state(page)).wordIndex, 1);
    await load(page, 'word-listen'); assert.ok((await state(page)).controls.filter(item => item.id.startsWith('word-option')).every(item => !item.enabled));
    await click(page, 'listen'); await page.waitForFunction(() => window.__PAPER__.snapshot().played);
    await click(page, 'word-option-0'); assert.equal((await state(page)).correct, true);
    await load(page, 'construction');
    for (const index of [0, 1, 2, 3]) await click(page, `token-${index}`);
    await click(page, 'check'); assert.equal((await state(page)).correct, true);
    await click(page, 'selected-1'); assert.deepEqual((await state(page)).tokens, [0, 2, 3]);
    await click(page, 'manual'); await page.locator('textarea').fill(fixture.construction.example.surface);
    await page.locator('textarea').evaluate(el => el.dispatchEvent(new CompositionEvent('compositionstart')));
    await click(page, 'check'); assert.equal((await state(page)).feedback, 'Завершите выбор японского текста.');
    await page.locator('textarea').evaluate(el => el.dispatchEvent(new CompositionEvent('compositionend')));
    await click(page, 'check'); assert.equal((await state(page)).correct, true);
    await page.evaluate(() => {
      const canvas = window.__PAPER__.app.canvas;
      const gl = canvas.getContext('webgl2') ?? canvas.getContext('webgl');
      gl.getExtension('WEBGL_lose_context').loseContext();
    });
    await page.locator('#recovery').waitFor({ state: 'visible' });
    await page.waitForTimeout(300); await page.locator('#retry').click();
    await page.locator('#recovery').waitFor({ state: 'hidden' }); await settled(page);
    assert.equal((await state(page)).editorValue, fixture.construction.example.surface);
    await page.setViewportSize({ width: 1280, height: 900 }); await load(page, 'construction');
    const token = (await state(page)).controls.find(item => item.id === 'token-0');
    const drop = (await state(page)).constructionDrop;
    const dragScroll = await page.evaluate(() => scrollY);
    await page.mouse.move(token.rect.x + token.rect.width / 2, token.rect.y + 20 - dragScroll); await page.mouse.down();
    await page.mouse.move(drop.x + drop.width / 2, drop.y + drop.height / 2 - dragScroll, { steps: 10 }); await page.mouse.up(); await settled(page);
    assert.deepEqual((await state(page)).tokens, [0], 'Dragging a token must add it to the phrase');
    for (const [task, kind] of [['count-category', 'image-counter'], ['count-picture', 'counter-image'], ['count-reading', 'reading-choice'], ['count-listen', 'listening-image']]) {
      await load(page, task); if (task === 'count-listen') { await click(page, 'listen'); await page.waitForFunction(() => window.__PAPER__.snapshot().played); }
      const card = fixture.counterCards.find(card => card.kind === kind), index = card.options.findIndex(option => card.acceptedKeys.includes(option.key));
      await click(page, `count-option-${index}`); assert.equal((await state(page)).correct, true);
    }
    await load(page, 'count-recall'); await click(page, 'reveal-counter'); assert.equal((await state(page)).revealed, true);
    await load(page, 'construction-intro'); await click(page, 'breakdown'); assert.equal((await state(page)).hintVisible, false);
    await load(page, 'word-ja'); await page.evaluate(() => window.__PAPER__.replay()); await page.waitForTimeout(100);
    assert.deepEqual({ x: (await state(page)).motion.x, y: (await state(page)).motion.y }, { x: 0, y: -8 });
    await page.emulateMedia({ reducedMotion: 'no-preference' }); await page.evaluate(() => window.__PAPER__.replay());
    await page.waitForFunction(() => Math.abs(window.__PAPER__.snapshot().motion.y) > .5);
    const moving = (await state(page)).motion; assert.equal(moving.rotation, 0); assert.ok(Math.abs(moving.x) <= 1.6 && moving.y >= -8);
    await page.waitForFunction(() => window.__PAPER__.snapshot().motion.y === -8); assert.equal((await state(page)).motion.y, -8);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await load(page, 'video'); await click(page, 'video-play'); await page.waitForFunction(() => !window.__PAPER__.video.paused && window.__PAPER__.video.videoWidth > 0);
    await click(page, 'video-play'); assert.equal((await state(page)).video.paused, true);
    const before = (await state(page)).video.time; await click(page, 'video-seek'); assert.ok((await state(page)).video.time > before + 4.5);
    await page.screenshot({ path: new URL(`${name}-video-playing.jpg`, output).pathname, type: 'jpeg', quality: 82 });
    await load(page, 'word-ja'); await page.getByRole('button', { name: fixture.words[0].meaningRu, exact: true }).focus(); await page.keyboard.press('Enter'); await settled(page); assert.equal((await state(page)).correct, true);
    await page.goto('http://127.0.0.1:5190/?view=lab'); await page.waitForFunction(() => window.__LAB__?.snapshot().ready); assert.deepEqual(await page.evaluate(() => window.__LAB__.snapshot().cspViolations), []);
    assert.deepEqual(errors, []); assert.equal(requests.some(url => new URL(url).pathname.startsWith('/api')), false);
    result.browsers[name] = { version: browser.version(), matrix, errors, source: fixture.source, cspViolations: [], motion: 'steady raised sheet, no sway, reduced motion passed', interactions: 'choice, recall, hints, navigation, tokens/drag, IME guard, five counter modes, audio, native video, keyboard' };
    console.log(`${name}: paper interactions passed`); await page.close();
  } finally { await browser.close(); }
}
await writeFile(new URL('checks.json', output), JSON.stringify(result, null, 2) + '\n');
