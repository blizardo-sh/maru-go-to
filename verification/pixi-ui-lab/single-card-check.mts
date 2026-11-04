import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium, webkit } from '@playwright/test';
import { loadCourse } from './.local/rehearsal-20261028/server-release/src/server/course';
import { learningParts } from './.local/rehearsal-20261028/server-release/src/shared/learning';
import { learningWordChoices } from './.local/rehearsal-20261028/server-release/src/shared/learningChoices';
const course = { ...loadCourse(), publicationId: 'a'.repeat(64) }, route = course.learning!.find(route => route.lessonId.endsWith('.02'))!;
const parts = learningParts(route), steps = parts.flat(), intros = steps.filter(step => step.kind === 'word-intro');
const cases = [{ name: 'completion', step: intros[0]!, completed: true }, { name: 'part-complete', step: steps.find(step => step.kind === 'part-complete')! }, { name: 'overview', step: intros[0]!, overview: true },
  { name: 'long-intro', step: intros[4]! }, { name: 'group2-intro', step: intros[5]! },
  ...(['ja-ru', 'ru-ja', 'listening'] as const).map(mode => ({ name: mode, step: steps.find(step => step.kind === 'word-practice' && step.mode === mode && step.wordId === intros[2]!.wordId)! }))];
const output = new URL('./test-results/single-card/', import.meta.url); mkdirSync(output, { recursive: true });
const report = [], failures = [];
for (const [name, type, options] of [['chrome', chromium, { channel: 'chrome' }], ['webkit', webkit, {}]] as const) {
  const browser = await type.launch({ ...options, headless: true });
  try {
    for (const [width, height] of [[1096,1454],[900,1016],[1440,1000],[390,844],[320,640],[844,390]]) for (const item of cases) {
      const page = await browser.newPage({ viewport: { width: width!, height: height! }, reducedMotion: 'reduce' }), errors: string[] = [];
      page.on('pageerror', error => errors.push(error.message));
      const state = { publicationId: course.publicationId, lessonId: route.lessonId, routeVersion: route.version, version: 0,
        partIndex: parts.findIndex(part => part.some(step => step.id === item.step.id)), totalParts: parts.length, completedSteps: item.completed ? steps.length : 0, totalSteps: steps.length, completed: !!item.completed, step: item.completed ? null : item.step,
        ...(item.step.kind === 'word-practice' ? { wordChoices: learningWordChoices(course, route, item.step) } : {}) };
      await page.route('**/api/**', async request => {
        const path = new URL(request.request().url()).pathname;
        if (path === '/api/me') return request.fulfill({ json: { id: 'fit-check', name: 'Проверка', email: 'fit@example.test' } });
        if (path === '/api/course') return request.fulfill({ json: course });
        if (path === '/api/learning') return request.fulfill({ json: { lessons: [state] } });
        if (path === `/api/learning/${route.lessonId}`) return request.fulfill({ json: state });
        throw new Error(`Unexpected API ${path}`);
      });
      const settled = async () => { await page.waitForFunction(() => (window as any).__PAPER__?.snapshot().ready && !(window as any).__PAPER__.snapshot().pendingRender); await page.waitForTimeout(30); };
      const snapshot = () => page.evaluate(() => (window as any).__PAPER__.snapshot());
      const click = async (id: string) => { const c = (await snapshot()).controls.find((c: any) => c.id === id); assert.ok(c?.enabled, id); await page.mouse.click(c.rect.x + c.rect.width/2, c.rect.y + c.rect.height/2); await settled(); };
      await page.goto(`http://localhost:5191/learn.html?lesson=${route.lessonId}`); await settled();
      if (!item.overview) await click('lesson-start');
      const initial = await snapshot(), tabs = initial.controls.filter((c: any) => c.id.startsWith(item.overview ? 'overview-tab-' : 'intro-tab-'));
      const checks = tabs.length ? tabs.map((tab: any) => tab.id) : ['current'];
      for (const tab of checks) {
        if (tab !== 'current') { await click(tab); await page.waitForFunction((id: string) => (window as any).__PAPER__.snapshot().controls.find((c: any) => c.id === id)?.highlight === 'selected', tab); const current = await snapshot(); assert.equal(item.overview ? current.layout.overviewTab : current.layout.introTab, Number(tab.split('-').at(-1)), `Tab did not open ${name} ${width} ${item.name} ${tab}`); }
        const value = await snapshot();
        const textBounds = await page.evaluate(() => { const result: any[] = []; const visit = (node: any) => { if (node.text?.trim()) { const b = node.getBounds(); result.push({ text: node.text, top: b.minY, bottom: b.maxY }); } node.children.forEach(visit); }; visit((window as any).__PAPER__.app.stage.children[1]); return result; });
        const clipped = textBounds.filter(text => text.top < value.layout.maskTop - 2 || text.bottom > value.dock.top - 4);
        const bad = value.scroll.max !== 0 || clipped.length > 0 || value.controls.some((c: any) => c.id.startsWith('scroll-'));
        if (bad) failures.push({ browser: name, width, height, case: item.name, tab, scroll: value.scroll.max, clipped, introHeight: value.layout.introSlotHeight, board: value.stand.board, dock: value.dock });
        if (bad || tab === checks[0]) await page.screenshot({ path: new URL(`${name}-${width}-${item.name}-${tab}.png`, output).pathname });
        assert.deepEqual(errors, []); assert.deepEqual(value.cspViolations, []);
      }
      report.push({ browser: name, width, height, case: item.name, tabs: checks.length }); await page.close();
    }
  } finally { await browser.close(); }
}
writeFileSync(new URL('report.json', output), JSON.stringify({ report, failures }, null, 2) + '\n');
console.log(`${report.length} single-card cases checked; ${failures.length} failures`); if (failures.length) console.log(JSON.stringify(failures.slice(0,8), null, 2)); assert.equal(failures.length, 0);
