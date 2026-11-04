// M8: historical assertions replayed against root sources and main build, isolated synthetic clone.
import './guard.mjs';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { chromium, webkit } from '@playwright/test';
execFileSync('/private/tmp/japanese-stack-toolchain-1.4.3/bun', ['m5-counter-browser-prepare.mts']);
const runtime = JSON.parse(readFileSync('.local/runtime.json', 'utf8'));
const origin = 'http://localhost:5202', kinds = ['image-counter','counter-image','reading-choice','listening-image','recall'];
const report = { passed: false, realPublishedCards: true, browserQueueProjection: true, checks: [], physicalPhones: false };
mkdirSync('test-results/m8-m5-counter', { recursive: true });
for (const engine of ['chrome', 'webkit']) {
  const browser = await (engine === 'chrome' ? chromium.launch({ channel: 'chrome', headless: true }) : webkit.launch({ headless: true }));
  try {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } }), page = await context.newPage(), errors = [];
    page.setDefaultTimeout(15000);
    page.on('pageerror', error => errors.push(error.message));
    let response; for (let attempt = 0; attempt < 3; attempt++) { response = await context.request.post(origin + '/api/auth/sign-in/email', { headers: { origin }, data: runtime.counterBrowserUsers[engine === 'chrome' ? 0 : 1] }); if (response.status() !== 429) break; const seconds = Math.min(60, Math.max(1, Number(response.headers()['retry-after']) || 60)); console.log('Respecting login Retry-After: ' + seconds + 's'); await new Promise(resolve => setTimeout(resolve, seconds * 1000)); } assert.equal(response.status(), 200);
    const cards = new Map();
    for (let i = 0; i < 12 && cards.size < kinds.length; i++) {
      const queue = await (await context.request.get(origin + '/api/training?counters=true')).json();
      for (const item of queue.items) if (!cards.has(item.counter.kind)) cards.set(item.counter.kind, item);
    }
    assert.deepEqual([...cards.keys()].sort(), [...kinds].sort());
    let selected;
    // Present one actually issued API card at a time, to deterministically inspect all five formats.
    await page.route('**/api/training?counters=true', route => route.fulfill({ json: { items: [selected], remainingNew: 1, remainingDue: 0 } }));
    const snap = () => page.evaluate(() => window.__ALBUM__.snapshot());
    const click = async id => {
      await page.waitForFunction(id => { const s = window.__ALBUM__?.snapshot(); return s?.controls.some(c => c.id === id && c.enabled) && !s.guided.busy; }, id);
      const s = await snap(), c = s.controls.find(c => c.id === id); await page.mouse.click(c.rect.x + c.rect.width / 2, c.rect.y + c.rect.height / 2);await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
      await page.waitForFunction(n => window.__ALBUM__.snapshot().renderCount > n, s.renderCount);
    };
    for (const kind of kinds) {
      selected = cards.get(kind); console.log(engine + ':' + kind);
      await page.goto(origin + '/'); await page.waitForFunction(() => window.__ALBUM__?.snapshot().authenticated && !window.__ALBUM__.snapshot().guided.busy);
      await click('counters'); await page.waitForFunction(kind => window.__ALBUM__.snapshot().counter.kind === kind, kind);
      await page.waitForFunction(() => window.__ALBUM__.snapshot().controls.some(c => ['counter-intro','counter-rule','show-answer','audio'].includes(c.id)));
      if ((await snap()).controls.some(c => c.id === 'counter-intro')) await click('counter-intro');
      if (kind === 'listening-image') {
        const s = await snap(); assert.ok(!s.controls.some(c => c.id === selected.counter.acceptedKeys[0] && c.enabled));
        await click('audio'); await page.waitForFunction(() => window.__ALBUM__.snapshot().heard);
      }
      if (kind === 'recall') { assert.ok(!(await snap()).controls.some(c => c.id === 'counter-audio')); await click('show-answer'); }
      for (const size of [{width:390,height:844},{width:1440,height:900},{width:844,height:390},{width:320,height:640}]) {
        await page.setViewportSize(size); await page.waitForTimeout(80); const s = await snap(); assert.deepEqual(s.problems, [], `${engine}/${kind}/${size.width}: ${s.problems}`);
        await page.screenshot({ path: `test-results/m8-m5-counter/${engine}-${kind}-${size.width}.png` });
      }
      await page.setViewportSize({width:390,height:844}); await page.waitForTimeout(100);
      if (engine === 'chrome') {
        const target = kind === 'recall' ? 'grade-remember' : selected.counter.acceptedKeys.find(key => selected.counter.options.some(o => o.key === key));
        const post = page.waitForResponse(r => r.request().method() === 'POST' && r.url().endsWith('/api/reviews'));
        await click(target); const ack = await post; assert.equal(ack.status(), 200, kind + ':' + await ack.text());
      }
      report.checks.push(`${engine}:${kind}:geometry-4-sizes${engine === 'chrome' ? ':API-ACK' : ''}`);
    }
    assert.deepEqual(errors, []); await context.close();
  } finally { await browser.close(); }
}
report.passed = true; writeFileSync('checks-m8-m5-counter-browser.json', JSON.stringify(report, null, 2) + '\n'); console.log(JSON.stringify(report));
