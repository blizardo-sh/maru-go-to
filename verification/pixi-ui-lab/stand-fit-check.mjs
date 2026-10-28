import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium, webkit } from '@playwright/test';
const failures = [];
const checked = [];
for (const [name, type, options] of [['chrome', chromium, { channel: 'chrome' }], ['webkit', webkit, {}]]) {
  const browser = await type.launch({ ...options, headless: true });
  try {
    for (const [width, height] of [[900, 1016], [1440, 1000], [390, 844]]) {
      const page = await browser.newPage({ viewport: { width, height }, reducedMotion: 'reduce' });
      const settled = async () => { await page.waitForFunction(() => window.__PAPER__ && !window.__PAPER__.snapshot().pendingRender); await page.waitForTimeout(30); };
      const state = () => page.evaluate(() => window.__PAPER__.snapshot());
      const click = async id => { await settled(); let c = (await state()).controls.find(c => c.id === id); assert.ok(c?.enabled, id); if (!c.docked) await page.evaluate(y => scrollTo(0, Math.max(0, y - innerHeight / 2)), c.rect.y); await settled(); c = (await state()).controls.find(c => c.id === id); await page.mouse.click(c.rect.x + c.rect.width / 2, c.rect.y + c.rect.height / 2 - await page.evaluate(() => scrollY)); await settled(); };
      await page.goto('http://127.0.0.1:5190/paper.html?lesson=marugoto.starter-a1.lesson.02'); await settled();
      if (await page.locator('canvas').evaluate(el => getComputedStyle(el).position) !== 'fixed') failures.push(`${name} ${width}: canvas scrolls with document`);
      await click('lesson-start');
      for (let i = 0; i < 4; i++) await click('intro-next');
      const intro = await state();
      const texts = await page.evaluate(() => { const values = []; const visit = node => { if (typeof node.text === 'string' && node.text.trim()) { const b = node.getBounds(); values.push({ text: node.text, y: b.minY + scrollY, bottom: b.maxY + scrollY }); } node.children.forEach(visit); }; visit(window.__PAPER__.app.stage.children[1]); return values; });
      const hidden = texts.filter(t => t.bottom > intro.dock.top + 1);
      if (hidden.length && !intro.scroll?.max) failures.push(`${name} ${width}: introduction clipped without continuation`);
      await click('intro-next');
      await page.evaluate(() => window.__PAPER__.navigate('word-ru', true)); await settled();
      const quiz = await state(), options = quiz.controls.filter(c => c.id.startsWith('word-option-'));
      const cut = options.filter(c => c.rect.y + c.rect.height > quiz.dock.top + .5);
      if (cut.length && !quiz.scroll?.max) failures.push(`${name} ${width}: ${cut.length} answers clipped without continuation`);
      if (width >= 900 && cut.length) failures.push(`${name} ${width}: desktop answers do not fit`);
      await page.evaluate(() => window.__PAPER__.navigate('textbook')); await settled();
      let s = await state();
      if (!s.controls.some(c => c.id === 'scroll-more' && c.enabled)) failures.push(`${name} ${width}: no lesson continuation cue`);
      const firstScroll = await page.evaluate(() => scrollY); await click('scroll-more');
      if (await page.evaluate(() => scrollY) <= firstScroll) failures.push(`${name} ${width}: paper continuation does not scroll`);
      const before = await page.evaluate(() => { const b = window.__PAPER__.app.stage.children[0].children[0].getBounds(); return { x: b.minX, y: b.minY, width: b.maxX - b.minX, height: b.maxY - b.minY }; });
      await page.mouse.wheel(0, 360); await page.waitForTimeout(160); await settled();
      const after = await page.evaluate(() => { const b = window.__PAPER__.app.stage.children[0].children[0].getBounds(); return { x: b.minX, y: b.minY, width: b.maxX - b.minX, height: b.maxY - b.minY }; });
      if (Object.keys(before).some(key => Math.abs(before[key] - after[key]) > .25)) failures.push(`${name} ${width}: world moves during sheet scroll: ${JSON.stringify({ before, after })}`);
      s = await state(); if (!s.controls.some(c => c.id === 'scroll-back' && c.enabled)) failures.push(`${name} ${width}: no return cue`);
      await page.getByRole('button', { name: /^Урок 18\./ }).focus(); await page.waitForTimeout(100);
      const focus = await page.getByRole('button', { name: /^Урок 18\./ }).boundingBox();
      if (!focus || focus.y < 0 || focus.y + focus.height > height - 20) failures.push(`${name} ${width}: keyboard-focused lesson remains outside view ${JSON.stringify({ focus, scroll: await page.evaluate(() => scrollY), max: (await state()).scroll.max })}`);
      assert.deepEqual((await state(page)).cspViolations, []);
      checked.push({ browser: name, width, height, fixedWorld: true, paperCues: true, keyboardLesson18: true });
      await page.close(); console.log(`${name} ${width}x${height} checked`);
    }
    const moving = await browser.newPage({ viewport: { width: 390, height: 844 }, reducedMotion: 'no-preference' });
    await moving.goto('http://127.0.0.1:5190/paper.html?task=textbook'); await moving.waitForFunction(() => window.__PAPER__);
    await moving.mouse.move(195, 400); await moving.mouse.wheel(0, 120);
    await moving.waitForFunction(() => scrollY > 0 && !document.querySelector('#stage').classList.contains('stand-enter'));
    assert.equal(await moving.locator('canvas').evaluate(el => Math.abs(el.getBoundingClientRect().top) < .25), true, 'Entrance animation must not unfix the world during scroll');
    assert.equal(await moving.locator('#stage').evaluate(el => el.classList.contains('stand-enter')), false);
    await moving.close();
  } finally { await browser.close(); }
}
assert.deepEqual(failures, []);
await mkdir(new URL('./test-results/stand-content/', import.meta.url), { recursive: true });
await writeFile(new URL('./test-results/stand-content/scroll-report.json', import.meta.url), JSON.stringify({ at: new Date().toISOString(), cases: checked }, null, 2) + '\n');
