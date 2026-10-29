import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium, webkit } from '@playwright/test';
const output = new URL('./test-results/practice-study/', import.meta.url); mkdirSync(output, { recursive: true });
const report = [];
for (const [name, type, options] of [['chrome', chromium, { channel: 'chrome' }], ['webkit', webkit, {}]]) {
  const browser = await type.launch({ ...options, headless: true });
  try {
    for (const [width, height] of [[1968, 2386], [984, 1193], [1096, 1454], [1440, 1000], [390, 844], [320, 640], [844, 390]]) {
      const page = await browser.newPage({ viewport: { width, height }, reducedMotion: 'reduce' }), errors = [], api = [];
      // Keep manual Next deterministic under concurrent screenshot load; real auto-advance is checked on a clean page below.
      await page.addInitScript(() => { const original = window.setTimeout; window.setTimeout = (run, delay, ...args) => original(run, delay === 1200 ? 600000 : delay, ...args); });
      page.on('pageerror', error => errors.push(error.message));
      await page.route('**/api/**', async route => { api.push(route.request().url()); await route.abort(); });
      const state = () => page.evaluate(() => window.__PAPER__.snapshot());
      const settled = async () => { await page.waitForFunction(() => window.__PAPER__?.snapshot().ready && !window.__PAPER__.snapshot().pendingRender); await page.waitForTimeout(40); };
      const click = async id => {
        await settled(); let snapshot = await state(), c = snapshot.controls.find(c => c.id === id); assert.ok(c?.enabled, `Unavailable ${id}`);
        if (!c.docked) await page.evaluate(({ y, top }) => scrollTo(0, Math.max(0, y - top)), { y: c.rect.y + c.rect.height / 2, top: ((snapshot.layout.maskTop ?? 0) + (snapshot.dock?.top ?? height)) / 2 });
        await settled(); c = (await state()).controls.find(c => c.id === id);
        await page.mouse.click(c.rect.x + c.rect.width / 2, c.rect.y + c.rect.height / 2 - await page.evaluate(() => scrollY)); await settled();
      };
      await page.goto('http://localhost:5191/paper.html?study=compare'); await settled();
      assert.equal((await state()).practice.phase, 'choose');
      const checkPaperText = async () => {
        const texts = await page.evaluate(() => {
          const result = []; const visit = node => { if (node.text && node.parent?.parent?.label !== 'button') { const b = node.getBounds(); result.push({ text: node.text, x: b.minX, y: b.minY, right: b.maxX, bottom: b.maxY }); } node.children.forEach(visit); };
          visit(window.__PAPER__.app.stage.children[1]); return result;
        });
        for (let a = 0; a < texts.length; a++) for (let b = a + 1; b < texts.length; b++) {
          const one = texts[a], two = texts[b];
          assert.ok(one.right <= two.x + 1 || two.right <= one.x + 1 || one.bottom <= two.y + 1 || two.bottom <= one.y + 1, `Text overlaps: ${one.text} / ${two.text}`);
        }
      };
      await checkPaperText();
      await page.screenshot({ path: new URL(`${name}-${width}-choose.png`, output).pathname });
      for (const variant of ['choice', 'recall']) {
        await click(`study-start-${variant}`);
        for (let intro = 0; intro < 3; intro++) await click('study-next');
        assert.equal((await state()).practice.phase, 'question');
        let turn = 0, usedHint = false, usedWrong = false, selfAgain = false, assessmentY = null;
        while ((await state()).practice.phase === 'question' && turn++ < 40) {
          const snapshot = await state(), demo = snapshot.practice;
          if (snapshot.scroll.max) await page.screenshot({ path: new URL(`${name}-${width}-overflow.png`, output).pathname });
          assert.equal(snapshot.scroll.max, 0, `${name} ${width} ${variant} ${demo.wordId} ${demo.mode}: exercise requires scrolling`);
          const scroll = await page.evaluate(() => scrollY);
          for (const control of snapshot.controls.filter(c => c.id.startsWith('study-') && c.enabled)) {
            const cat = snapshot.catBounds, c = { ...control.rect };
            if (!control.docked) {
              const end = Math.min(c.y + c.height, scroll + snapshot.dock.top - (snapshot.scroll.max ? 48 : 0));
              c.y = Math.max(c.y, scroll + snapshot.layout.maskTop); c.height = Math.max(0, end - c.y);
            }
            if (!c.height) continue;
            if (snapshot.catVisible) assert.ok(c.x + c.width <= cat.x || cat.x + cat.width <= c.x || c.y + c.height <= cat.y || cat.y + cat.height <= c.y, `Cat obscures ${control.id}`);
          }
          if (demo.recall && !demo.hinted && !demo.revealed) {
            if (!usedHint) {
              const reveal = snapshot.controls.find(c => c.id === 'study-reveal');
              assert.ok(reveal.rect.y - snapshot.contentBottom >= 12 && reveal.rect.y - snapshot.contentBottom <= 40, 'Reveal action detached from question');
              await page.screenshot({ path: new URL(`${name}-${width}-recall.png`, output).pathname });
              await click('study-hint'); usedHint = true;
              const hinted = (await state()).practice;
              assert.equal(hinted.hinted, true); assert.equal(hinted.revealed, false); assert.equal(hinted.correct, null);
            } else {
              await click('study-reveal');
              await page.waitForFunction(() => window.__PAPER__.snapshot().controls.some(c => c.id === 'study-self-remember'));
              const revealed = await state(), assessment = revealed.controls.find(c => c.id === 'study-self-remember');
              const gap = assessment.rect.y - revealed.contentBottom;
              assert.equal(revealed.scroll.max, 0, 'Revealed answer must fit without scrolling');
              assert.ok(gap >= 12 && gap <= 40, `${name} ${width}: assessment detached from answer (${gap}px)`);
              const relativeY = assessment.rect.y - revealed.stand.board.y;
              if (assessmentY !== null) assert.ok(Math.abs(relativeY - assessmentY) < .5, 'Assessment moved between words');
              assessmentY = relativeY;
              if (!selfAgain) await page.screenshot({ path: new URL(`${name}-${width}-revealed.png`, output).pathname });
              await click(selfAgain ? 'study-self-remember' : 'study-self-again'); selfAgain = true;
              continue;
            }
          }
          let current = (await state()).practice;
          if (current.mode === 'listening') { await click('listen'); await page.waitForFunction(() => window.__PAPER__.snapshot().played); }
          if (!usedWrong) {
            await click(`word-option-${current.choices.findIndex(id => id !== current.wordId)}`); usedWrong = true;
            assert.equal((await state()).practice.correct, false);
            const wrong = (await state()).controls.filter(c => c.id.startsWith('word-option-'));
            assert.equal(wrong.some(c => c.highlight === 'selected'), false, 'Error revealed correct choice');
          }
          current = (await state()).practice;
          await click(`word-option-${current.choices.indexOf(current.wordId)}`);
          assert.equal((await state()).practice.correct, true, `${name} ${width} ${variant} turn ${turn}: correct choice did not activate`);
          await click('next');
        }
        const end = await state(); assert.equal(end.practice.phase, 'summary'); assert.ok(turn < 40);
        assert.ok(end.practice.records[variant].some(record => record.firstError));
        if (variant === 'recall') {
          assert.ok(end.practice.records.recall.some(record => record.hint));
          assert.ok(end.practice.records.recall.some(record => record.self === false));
          assert.ok(end.practice.records.recall.some(record => record.self === true));
        }
      }
      await checkPaperText();
      await page.screenshot({ path: new URL(`${name}-${width}-summary.png`, output).pathname });
      await click('study-recheck'); assert.equal((await state()).practice.delayed, true);
      assert.equal(await page.evaluate(() => localStorage.length), 0);
      assert.equal(await page.evaluate(() => sessionStorage.length), 0);
      assert.deepEqual(api, []); assert.deepEqual(errors, []); assert.deepEqual((await state()).cspViolations, []);
      report.push({ browser: name, width, height, fullScenarios: 2, passed: true }); await page.close();
    }
    const auto = await browser.newPage({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
    const api = []; await auto.route('**/api/**', route => { api.push(route.request().url()); return route.abort(); });
    await auto.goto('http://localhost:5191/paper.html?task=word-ja');
    await auto.waitForFunction(() => window.__PAPER__?.snapshot().ready && !window.__PAPER__.snapshot().pendingRender);
    const tap = async id => { const c = await auto.evaluate(id => window.__PAPER__.snapshot().controls.find(c => c.id === id), id); assert.ok(c?.enabled, id); await auto.mouse.click(c.rect.x + c.rect.width / 2, c.rect.y + c.rect.height / 2); };
    const started = Date.now(); await tap('word-option-0');
    await auto.waitForFunction(() => window.__PAPER__.snapshot().wordIndex === 1, undefined, { timeout: 5000 });
    assert.ok(Date.now() - started >= 1000, 'Auto advance skipped the feedback delay');
    await tap('word-option-1');
    await auto.waitForFunction(() => window.__PAPER__.snapshot().controls.some(c => c.id === 'auto-pause'));
    await tap('auto-pause'); await auto.waitForTimeout(1400);
    assert.equal(await auto.evaluate(() => window.__PAPER__.snapshot().wordIndex), 1, 'Pause did not cancel automatic advance');
    assert.deepEqual(api, []); report.push({ browser: name, realAutoAdvance: true, pause: true }); await auto.close();
  } finally { await browser.close(); }
}
writeFileSync(new URL('report.json', output), JSON.stringify(report, null, 2) + '\n'); console.log('28 complete demo scenarios passed in Chrome/WebKit, no API/storage writes.');
