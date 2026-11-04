import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { chromium } from '@playwright/test';
const root = new URL('./.local/rehearsal-20261028/', import.meta.url), origin = 'http://localhost:5191';
const profile = JSON.parse(await readFile(new URL('login.json', root)))[1];
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
  assert.equal((await context.request.post(`${origin}/api/auth/sign-in/email`, { data: { email: profile.email, password: profile.password }, headers: { Origin: origin } })).status(), 200);
  const page = await context.newPage();
  const state = () => page.evaluate(() => window.__PAPER__.snapshot());
  const settled = () => page.waitForFunction(() => window.__PAPER__ && !window.__PAPER__.snapshot().pendingRender && !window.__PAPER__.snapshot().lesson.busy);
  const click = async id => { await settled(); let c = (await state()).controls.find(c => c.id === id); assert.ok(c?.enabled); if (!c.docked) await page.evaluate(y => scrollTo(0, Math.max(0, y - innerHeight / 2)), c.rect.y); await settled(); c = (await state()).controls.find(c => c.id === id); await page.mouse.click(c.rect.x + c.rect.width / 2, c.rect.y + c.rect.height / 2 - await page.evaluate(() => scrollY)); };
  await page.goto(`${origin}/learn.html?lesson=marugoto.starter-a1.lesson.02`); await settled(); await click('lesson-start'); await settled();
  const initial = await state();
  if (initial.task === 'word-intro') assert.equal(initial.lesson.wordId, initial.lesson.step.wordId, 'Reload resumed a different introduction');
  let pages = 0;
  while ((await state()).task === 'word-intro') { assert.ok(++pages < 20); await click('intro-next'); await settled(); }
  if ((await state()).task === 'word-listen') { await click('listen'); await page.waitForFunction(() => window.__PAPER__.snapshot().played); }
  const before = await state(), correct = before.lesson.choiceIds.indexOf(before.lesson.wordId);
  await page.route('**/api/learning/*/advance', async route => { await new Promise(resolve => setTimeout(resolve, 600)); await route.continue(); });
  await click(`word-option-${correct}`); await page.waitForFunction(() => window.__PAPER__.snapshot().lesson.busy && !window.__PAPER__.snapshot().pendingRender);
  const waiting = await state(); assert.equal(waiting.task, before.task);
  for (const control of before.controls.filter(c => c.id.startsWith('word-option-') || c.id === 'next')) {
    const current = waiting.controls.find(c => c.id === control.id); assert.ok(current, 'Control disappeared while saving'); assert.deepEqual(current.rect, control.rect); assert.equal(current.enabled, false);
  }
  await settled(); assert.equal((await state()).correct, true);
  await page.evaluate(() => dispatchEvent(new Event('blur')));
  await page.screenshot({ path: new URL('connected-desktop.png', root).pathname });
  const report = { at: new Date().toISOString(), introductionResumeCheckedHere: initial.task === 'word-intro', questionRemainsVisibleWhileSaving: true, controlsStayFixedWhileSaving: true, controlsDisabledUntilAck: true, confirmedCorrect: true, csp: (await state()).cspViolations };
  assert.deepEqual(report.csp, []); await writeFile(new URL('waiting-report.json', root), JSON.stringify(report, null, 2) + '\n'); console.log(JSON.stringify(report));
} finally { await browser.close(); }
