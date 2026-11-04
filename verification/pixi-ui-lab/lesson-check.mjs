import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { chromium, webkit } from '@playwright/test';

const fixture = JSON.parse(await readFile(new URL('./lesson-fixtures.json', import.meta.url)));
const output = new URL('./test-results/lesson/', import.meta.url); await mkdir(output, { recursive: true });
const snapshot = page => page.evaluate(() => window.__PAPER__.snapshot());
async function settle(page) {
  await page.waitForFunction(() => !window.__PAPER__.snapshot().pendingRender);
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}
async function click(page, id) {
  await settle(page);
  let value = await snapshot(page), control = value.controls.find(control => control.id === id);
  assert.ok(control?.enabled, `${value.task}: unavailable ${id}`);
  if (!control.docked) await page.evaluate(({ y, top }) => scrollTo(0, Math.max(0, y - top / 2)), { y: control.rect.y, top: (await snapshot(page)).dock?.top ?? await page.evaluate(() => innerHeight) }); await settle(page);
  control = (await snapshot(page)).controls.find(control => control.id === id);
  const scroll = await page.evaluate(() => scrollY);
  await page.mouse.click(control.rect.x + control.rect.width / 2, control.rect.y + control.rect.height / 2 - scroll); await settle(page);
}
function geometry(value, width) {
  assert.deepEqual(value.rotatedUi, []); assert.equal(value.view, value.composition === 'stand' ? 'flat-front' : 'orthographic-top-down');
  assert.equal(value.desktopBackground, width >= 900); assert.deepEqual(value.cspViolations, []);
  const cat = value.catBounds, study = value.studyBounds;
  if (value.catVisible) assert.ok(cat.x >= study.x + study.width + 20 || cat.x + cat.width <= study.x - 20 || cat.y >= study.y + study.height + 20, 'Cat must leave visible study content clear');
  for (const control of value.controls) {
    assert.ok(control.rect.width >= 44 && control.rect.height >= 44, `Small ${control.id}`);
    assert.ok(control.rect.x >= 0 && control.rect.x + control.rect.width <= width + 1, `Outside ${control.id}`);
  }
  for (const text of value.controlText) {
    if (!text.value) continue;
    assert.ok(text.bounds.x >= text.rect.x - 2 && text.bounds.x + text.bounds.width <= text.rect.x + text.rect.width + 2, `Wide ${text.id}`);
    assert.ok(text.bounds.y >= text.rect.y - 2 && text.bounds.y + text.bounds.height <= text.rect.y + text.rect.height + 2, `Tall ${text.id}`);
  }
  value.ruby.forEach(group => assert.equal(group.overflow, false));
}
const result = { date: new Date().toISOString(), source: fixture.source, browsers: {} };
for (const [name, engine, options, viewport] of [['chrome', chromium, { channel: 'chrome' }, { width: 1440, height: 1000 }], ['webkit', webkit, {}, { width: 390, height: 844 }]]) {
  const browser = await engine.launch({ ...options, headless: true });
  try {
    const page = await browser.newPage({ viewport, reducedMotion: 'reduce' }), errors = [], api = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', request => { if (new URL(request.url()).pathname.startsWith('/api')) api.push(request.url()); });
    await page.goto('http://127.0.0.1:5190/paper.html'); await page.waitForFunction(() => window.__PAPER__?.snapshot().ready); await settle(page);
    const captures = new Set(), matrix = [], lessons = [];
    async function capture(label) {
      if (captures.has(label)) return; captures.add(label);
      await page.evaluate(() => scrollTo(0, 0)); await settle(page);
      await page.screenshot({ path: new URL(`${name}-${label}.jpg`, output).pathname, type: 'jpeg', quality: 85 });
    }
    async function sizes(label) {
      const before = (await snapshot(page)).lesson.ticket;
      for (const [width, height] of [[1440, 1000], [1280, 900], [390, 844], [320, 640]]) {
        await page.setViewportSize({ width, height }); await settle(page); geometry(await snapshot(page), width);
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
        assert.deepEqual((await snapshot(page)).lesson.ticket, before); matrix.push(`${label}/${width}`);
      }
      await page.setViewportSize(viewport); await settle(page);
    }
    await capture('01-chooser'); await sizes('chooser');
    for (const number of [2, 3]) {
      const lesson = fixture.lessons.find(lesson => lesson.number === number);
      await click(page, `lesson-${number}`); assert.equal((await snapshot(page)).task, 'lesson-overview');
      await capture('02-overview'); await sizes(`overview-${number}`);
      await click(page, 'lesson-start'); assert.equal((await snapshot(page)).lesson.active, true);
      const introId = (await snapshot(page)).lesson.wordId, introWord = fixture.words.find(word => word.id === introId);
      assert.ok((await page.locator('#canvas-description').textContent()).includes(introWord.meaningRu));
      await capture('03-introduction'); await sizes(`intro-${number}`);
      if (number === 2) {
        await click(page, 'intro-next'); const before = (await snapshot(page)).lesson;
        await click(page, 'lesson-exit'); await click(page, `lesson-${number}`); await click(page, 'lesson-start');
        assert.deepEqual((await snapshot(page)).lesson.ticket, before.ticket); assert.equal((await snapshot(page)).lesson.introIndex, before.introIndex);
      }
      let moves = 0, mistake = false, manual = false, playedVideo = false;
      const seen = new Set();
      while ((await snapshot(page)).task !== 'lesson-complete') {
        assert.ok(++moves < 250, `Lesson ${number} did not finish`);
        const value = await snapshot(page), step = value.lesson.step; assert.ok(step);
        geometry(value, viewport.width); seen.add(`${step.kind}/${step.mode ?? ''}`);
        if (step.kind === 'word-intro') { await click(page, 'intro-next'); continue; }
        if (step.kind === 'word-practice') {
          if (step.mode === 'listening') { await click(page, 'listen'); await page.waitForFunction(() => window.__PAPER__.snapshot().played); await settle(page); }
          const correctIndex = value.lesson.choiceIds.indexOf(step.wordId); assert.ok(correctIndex >= 0);
          const index = mistake ? correctIndex : (correctIndex + 1) % 4;
          await capture(step.mode === 'listening' ? '05-listening' : step.mode === 'ru-ja' ? '06-japanese-answers' : '04-question');
          await click(page, `word-option-${index}`);
          assert.equal((await snapshot(page)).correct, mistake);
          if (!mistake) { mistake = true; await capture('07-repeat-feedback'); }
          await click(page, 'next'); continue;
        }
        if (step.kind === 'construction-intro') { await capture('08-construction-intro'); await sizes('construction-intro'); await click(page, 'intro-next'); continue; }
        if (step.kind === 'construction-practice' && step.mode !== 'grammar') {
          if (step.mode === 'listening') { await click(page, 'listen'); await page.waitForFunction(() => window.__PAPER__.snapshot().played); await settle(page); }
          await click(page, 'reveal'); assert.equal((await snapshot(page)).revealed, true); await capture('09-recall'); await click(page, 'remember'); continue;
        }
        if (step.kind === 'construction-practice') {
          const exercise = fixture.constructions.find(exercise => exercise.exerciseId === step.exerciseId);
          await capture('10-construction');
          for (const index of exercise.acceptedOrders[0]) await click(page, `token-${index}`);
          await click(page, 'check'); assert.equal((await snapshot(page)).correct, true);
          if (!manual) {
            manual = true; await click(page, 'manual'); await page.locator('textarea').fill(exercise.example.surface);
            await page.locator('textarea').evaluate(element => element.dispatchEvent(new CompositionEvent('compositionstart')));
            await click(page, 'check'); assert.equal((await snapshot(page)).correct, null);
            assert.equal((await snapshot(page)).controls.some(control => control.id === 'next'), false);
            await page.locator('textarea').evaluate(element => element.dispatchEvent(new CompositionEvent('compositionend')));
            await click(page, 'check'); assert.equal((await snapshot(page)).correct, true);
          }
          await click(page, 'next'); continue;
        }
        if (step.kind === 'video') {
          if (!playedVideo) { await click(page, 'video-play'); await page.waitForFunction(() => window.__PAPER__.video.videoWidth > 0 && !window.__PAPER__.video.paused); await click(page, 'video-play'); playedVideo = true; }
          await capture('11-video'); await click(page, 'video-next'); continue;
        }
        assert.equal(step.kind, 'part-complete'); await capture('12-part-complete'); await click(page, 'part-next');
      }
      const complete = (await snapshot(page)).lesson;
      assert.equal(complete.progress.percent, 100); assert.equal(complete.again, 1);
      assert.equal(complete.completed.length, new Set(complete.completed).size);
      await capture('13-complete'); await sizes(`complete-${number}`);
      await click(page, 'lesson-back'); await click(page, `lesson-${number}`); await click(page, 'lesson-start');
      assert.equal((await snapshot(page)).task, 'lesson-complete');
      await click(page, 'lesson-restart'); assert.equal((await snapshot(page)).lesson.progress.percent, 0);
      await click(page, 'lesson-exit');
      lessons.push({ number, total: complete.progress.total, attempts: complete.attempts, again: complete.again, steps: [...seen], resume: 'same exact step/intro', restart: 'reset local session' });
      console.log(`${name}: complete lesson ${number} passed`);
    }
    await page.route('**/assets/movies/**', async route => { await new Promise(resolve => setTimeout(resolve, 500)); await route.abort().catch(() => {}); });
    await page.goto('http://127.0.0.1:5190/paper.html?task=video'); await page.waitForFunction(() => window.__PAPER__?.snapshot().ready);
    await click(page, 'video-play');
    if (viewport.width < 700) await click(page, 'menu');
    await click(page, 'nav-textbook'); await page.waitForTimeout(600);
    assert.equal((await snapshot(page)).feedback, '', 'Cancelled playback must not leave an error on the next screen');
    assert.deepEqual(errors, []); assert.deepEqual(api, []);
    result.browsers[name] = { version: browser.version(), lessons, matrix, errors, api, csp: [], mediaCancel: 'delayed playback -> exit without stale error', desktop: 'top-down background; no UI rotation/skew' };
  } finally { await browser.close(); }
}
await writeFile(new URL('checks.json', output), JSON.stringify(result, null, 2) + '\n');
