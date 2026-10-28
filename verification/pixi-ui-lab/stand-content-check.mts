import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium, webkit } from '@playwright/test';
import { loadCourse } from './.local/rehearsal-20261028/server-release/src/server/course';
import { learningParts } from './.local/rehearsal-20261028/server-release/src/shared/learning';
import { learningWordChoices } from './.local/rehearsal-20261028/server-release/src/shared/learningChoices';

const course = { ...loadCourse(), publicationId: 'a'.repeat(64) }, route = course.learning!.find(route => route.lessonId.endsWith('.02'))!;
const parts = learningParts(route), steps = parts.flat();
const repeat = course.words.find(word => word.meaningRu.includes('Повторите, пожалуйста'))!;
const listen = course.words.find(word => word.meaningRu.includes('Послушайте, пожалуйста'))!;
assert.ok(repeat && listen);
const cases = [{ name: 'introduction', step: steps.find(step => step.kind === 'word-intro' && step.wordId === listen.id)! },
  { name: 'long-answers', step: steps.find(step => step.kind === 'word-practice' && step.wordId === repeat.id && step.mode === 'ru-ja')! }];
const output = new URL('./test-results/stand-content/', import.meta.url); mkdirSync(output, { recursive: true });
const results = [];
for (const [name, type, options] of [['chrome', chromium, { channel: 'chrome' }], ['webkit', webkit, {}]] as const) {
  const browser = await type.launch({ ...options, headless: true });
  try {
    for (const [width, height] of [[900, 1016], [1440, 1000], [1280, 900], [390, 844], [320, 640], [844, 390]]) for (const item of cases) {
      const page = await browser.newPage({ viewport: { width: width!, height: height! }, reducedMotion: 'reduce' });
      const errors: string[] = [], posted: any[] = [];
      page.on('pageerror', error => errors.push(error.message));
      const state = { publicationId: course.publicationId, lessonId: route.lessonId, routeVersion: route.version, version: 0,
        partIndex: parts.findIndex(part => part.some(step => step.id === item.step.id)), totalParts: parts.length, completedSteps: 0, totalSteps: steps.length, completed: false, step: item.step,
        ...(item.step.kind === 'word-practice' ? { wordChoices: learningWordChoices(course, route, item.step) } : {}) };
      // Real released curriculum, synthetic issued state. No request reaches a pupil database.
      await page.route('**/api/**', async request => {
        const path = new URL(request.request().url()).pathname;
        if (path === '/api/me') return request.fulfill({ json: { id: 'layout-check', name: 'Проверка', email: 'layout@example.test' } });
        if (path === '/api/course') return request.fulfill({ json: course });
        if (path === '/api/learning') return request.fulfill({ json: { lessons: [state] } });
        if (path === `/api/learning/${route.lessonId}`) return request.fulfill({ json: state });
        if (path.endsWith('/advance')) {
          const body = request.request().postDataJSON(); posted.push(body);
          return request.fulfill({ json: { attemptId: body.attemptId, state: { ...state, version: 1 }, reviewResult: { correct: body.choiceWordId === repeat.id } } });
        }
        throw new Error(`Unexpected API request ${path}`);
      });
      await page.goto(`http://localhost:5191/learn.html?lesson=${route.lessonId}`);
      await page.waitForFunction(() => (window as any).__PAPER__?.snapshot().ready && !(window as any).__PAPER__.snapshot().pendingRender);
      let snapshot = await page.evaluate(() => (window as any).__PAPER__.snapshot());
      const start = snapshot.controls.find((control: any) => control.id === 'lesson-start'); assert.ok(start?.enabled);
      await page.mouse.click(start.rect.x + start.rect.width / 2, start.rect.y + start.rect.height / 2);
      await page.waitForFunction(() => !(window as any).__PAPER__.snapshot().pendingRender); await page.waitForTimeout(30);
      snapshot = await page.evaluate(() => (window as any).__PAPER__.snapshot());
      if (item.name === 'long-answers') {
        const choices = snapshot.controls.filter((control: any) => control.id.startsWith('word-option-'));
        assert.equal(choices.length, 4);
        if (width! >= 900) for (const choice of choices) assert.ok(choice.rect.y + choice.rect.height <= snapshot.dock.top + .5, `${name} ${width}: desktop answer clipped`);
        assert.equal(snapshot.ruby.some((ruby: any) => ruby.overflow), false);
        if (snapshot.scroll.max) await page.evaluate(() => scrollTo(0, (window as any).__PAPER__.snapshot().scroll.max));
        await page.waitForTimeout(60); snapshot = await page.evaluate(() => (window as any).__PAPER__.snapshot());
        const last = snapshot.controls.find((control: any) => control.id === 'word-option-3');
        await page.mouse.click(last.rect.x + last.rect.width / 2, last.rect.y + last.rect.height / 2 - await page.evaluate(() => scrollY));
        await page.waitForFunction(() => !(window as any).__PAPER__.snapshot().lesson.busy && (window as any).__PAPER__.snapshot().selection !== null);
        await page.waitForFunction(() => !(window as any).__PAPER__.snapshot().pendingRender);
        assert.equal(posted.length, 1); assert.equal(posted[0].choiceWordId, state.wordChoices![3]);
        const confirmed = await page.evaluate(() => (window as any).__PAPER__.snapshot());
        const selected = confirmed.controls.find((control: any) => control.id === 'word-option-3');
        assert.ok(selected.rect.y + selected.rect.height - await page.evaluate(() => scrollY) <= confirmed.dock.top - (confirmed.scroll.max ? 48 : 0) + 1, `${name} ${width}: feedback hid selected answer`);
      } else {
        const textBounds = await page.evaluate(() => { const result: number[] = []; const visit = (node: any) => { if (typeof node.text === 'string' && node.text.trim()) result.push(node.getBounds().maxY + scrollY); node.children.forEach(visit); }; visit((window as any).__PAPER__.app.stage.children[1]); return result; });
        const clipped = textBounds.some(bottom => bottom > snapshot.dock.top + .5);
        if (width! >= 900) assert.equal(clipped, false, `${name} ${width}: desktop introduction clipped`);
        if (clipped) assert.ok(snapshot.scroll.max > 0 && snapshot.controls.some((control: any) => control.id === 'scroll-more'), 'No continuation for long explanation');
      }
      assert.deepEqual(errors, []); assert.deepEqual(snapshot.cspViolations, []);
      await page.screenshot({ path: new URL(`${name}-${width}-${item.name}.png`, output).pathname });
      results.push({ browser: name, width, height, case: item.name, passed: true }); await page.close();
    }
  } finally { await browser.close(); }
}
writeFileSync(new URL('report.json', output), JSON.stringify(results, null, 2) + '\n'); console.log(`${results.length} released-curriculum layout/click cases passed; no pupil database requests.`);
