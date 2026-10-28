import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { chromium, webkit } from '@playwright/test';
const privateRoot = new URL('./.local/rehearsal-20261028/', import.meta.url);
const profiles = JSON.parse(await readFile(new URL('login.json', privateRoot)));
const origin = 'http://localhost:5191';
const state = page => page.evaluate(() => window.__PAPER__.snapshot());
async function settled(page) { await page.waitForFunction(() => window.__PAPER__ && !window.__PAPER__.snapshot().lesson.busy && !window.__PAPER__.snapshot().pendingRender); await page.waitForTimeout(70); }
async function click(page, id) {
  await settled(page);
  let c = (await state(page)).controls.find(c => c.id === id);
  if (!c?.enabled) { await page.screenshot({ path: new URL('failure.png', privateRoot).pathname }); console.log(JSON.stringify({ wanted: id, snapshot: (await state(page)).lesson, controls: (await state(page)).controls.map(c => c.id) })); }
  assert.ok(c?.enabled, `Unavailable control ${id}`);
  if (!c.docked) await page.evaluate(y => scrollTo(0, Math.max(0, y - innerHeight / 2)), c.rect.y);
  await settled(page); c = (await state(page)).controls.find(c => c.id === id);
  const scroll = await page.evaluate(() => scrollY);
  await page.mouse.click(c.rect.x + c.rect.width / 2, c.rect.y + c.rect.height / 2 - scroll);
  await settled(page);
}
async function login(page, profile) {
  await page.goto(`${origin}/learn.html`);
  await page.waitForFunction(() => window.__PAPER__?.snapshot().ready);
  await page.getByLabel('Электронная почта', { exact: true }).fill(profile.email);
  await page.getByLabel('Пароль локальной копии', { exact: true }).fill(profile.password);
  await click(page, 'sign-in');
  await page.waitForFunction(() => window.__PAPER__.snapshot().lesson.authenticated);
  await settled(page);
}
const report = { at: new Date().toISOString(), browsers: {}, fullLesson: null };
for (const [name, type, options] of [['chrome', chromium, { channel: 'chrome' }], ['webkit', webkit, {}]]) {
  const browser = await type.launch({ ...options, headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: name === 'chrome' ? 1440 : 390, height: name === 'chrome' ? 1000 : 844 }, reducedMotion: 'reduce' });
    const errors = [], posts = [];
    page.on('pageerror', error => { errors.push(error.message); console.log('Page error:', error.stack); });
    page.on('request', request => { if (request.method() === 'POST' && request.url().endsWith('/advance')) posts.push(JSON.parse(request.postData())); });
    await login(page, profiles[name === 'chrome' ? 1 : 0]);
    const course = await page.evaluate(async () => (await fetch('/api/course')).json());
    if (name === 'webkit') {
      // Existing unfinished route from the backup, without starting it over.
      await click(page, 'lesson-4'); await click(page, 'lesson-start');
      const before = (await state(page)).lesson;
      await page.reload(); await page.waitForFunction(() => window.__PAPER__); await click(page, 'lesson-start');
      const after = (await state(page)).lesson;
      assert.equal(after.version, before.version); assert.equal(after.step.id, before.step.id);
      await page.screenshot({ path: new URL('connected-mobile.png', privateRoot).pathname });
      report.browsers[name] = { login: true, existingRouteResume: true, csp: (await state(page)).cspViolations };
    } else {
      await click(page, 'lesson-1'); await click(page, 'lesson-start');
      let iterations = 0, wrongTested = false, reloaded = false;
      while ((await state(page)).task !== 'lesson-complete') {
        assert.ok(++iterations < 180, 'Lesson did not finish');
        const value = await state(page), step = value.lesson.step;
        assert.equal(value.lesson.error, '');
        if (value.task === 'word-intro') await click(page, 'intro-next');
        else if (value.task.startsWith('word-')) {
          if (value.task === 'word-listen') { await click(page, 'listen'); await page.waitForFunction(() => window.__PAPER__.snapshot().played); }
          const index = value.lesson.choiceIds.indexOf(value.lesson.wordId);
          if (!wrongTested) {
            await click(page, `word-option-${(index + 1) % value.lesson.choiceIds.length}`);
            const wrong = await state(page), count = posts.length;
            assert.equal(wrong.correct, false);
            assert.equal(wrong.controls.filter(c => c.highlight === 'selected').length, 0, 'Correct answer leaked');
            assert.equal(wrong.lesson.confirmedNext, true);
            await click(page, `word-option-${index}`);
            assert.equal(posts.length, count, 'Correction generated a second grade');
            assert.equal((await state(page)).correct, true);
            wrongTested = true;
          } else await click(page, `word-option-${index}`);
          await click(page, 'next');
          if (!reloaded) {
            const before = (await state(page)).lesson;
            await page.reload(); await page.waitForFunction(() => window.__PAPER__); await click(page, 'lesson-start');
            const after = (await state(page)).lesson;
            assert.equal(after.version, before.version); assert.equal(after.step.id, before.step.id); reloaded = true;
          }
        } else if (value.task === 'construction-intro') await click(page, 'intro-next');
        else if (value.task.startsWith('recall-')) {
          if (value.task === 'recall-listen') { await click(page, 'listen'); await page.waitForFunction(() => window.__PAPER__.snapshot().played); }
          await click(page, 'dock-reveal'); await click(page, 'remember');
        } else if (value.task === 'construction') {
          const exercise = course.exercises.find(exercise => exercise.id === step.exerciseId);
          for (const id of exercise.acceptedOrders[0]) await click(page, `token-${exercise.tokens.findIndex(token => token.id === id)}`);
          await click(page, 'check'); assert.equal((await state(page)).correct, true); await click(page, 'next');
        } else if (value.task === 'video') await click(page, 'video-next');
        else if (value.task === 'part-complete') await click(page, 'part-next');
        else throw new Error(`Unsupported state ${value.task}`);
      }
      const final = await state(page);
      assert.equal(final.lesson.progress.finished, true); assert.equal(final.lesson.progress.percent, 100);
      assert.ok(wrongTested && reloaded);
      await page.screenshot({ path: new URL('connected-complete.png', privateRoot).pathname });
      // The pinned previous client shares this local cookie namespace and database.
      await page.goto(`${origin}/legacy.html`); await page.waitForTimeout(600);
      const old = await page.evaluate(async () => (await fetch('/api/learning')).json());
      assert.equal(old.lessons.find(lesson => lesson.lessonId === final.lesson.lessonId).completed, true);
      report.fullLesson = { iterations, advances: posts.length, firstErrorPreserved: true, reloadResume: true, completed: true, legacyReadsCompletion: true };
      report.browsers[name] = { login: true, csp: final.cspViolations };
    }
    assert.deepEqual(errors, []); assert.deepEqual(report.browsers[name].csp, []);
  } finally { await browser.close(); }
}
await writeFile(new URL('browser-report.json', privateRoot), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report));
