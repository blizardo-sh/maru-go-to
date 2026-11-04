import assert from 'node:assert/strict';
import { chromium, webkit } from '@playwright/test';

for (const [name, type, options] of [['chrome', chromium, { channel: 'chrome' }], ['webkit', webkit, {}]]) {
  const browser = await type.launch({ ...options, headless: true });
  try {
    for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
      const page = await browser.newPage({ viewport, reducedMotion: 'reduce' });
      await page.goto('http://localhost:5191/learn.html');
      await page.waitForFunction(() => window.__PAPER__?.snapshot().ready);
      for (const [name, value] of [['Электронная почта', 'pupil@example.test'], ['Пароль локальной копии', 'test-only-123']]) {
        const field = page.getByLabel(name, { exact: true });
        await field.click(); await page.waitForTimeout(120);
        assert.equal(await field.evaluate(el => document.activeElement === el), true, `${name}: click loses focus after Canvas redraw`);
        await page.keyboard.type(value, { delay: 25 }); await page.waitForTimeout(120);
        assert.equal(await field.inputValue(), value, `${name}: ordinary typing was lost`);
        assert.equal(await field.evaluate(el => document.activeElement === el), true);
        assert.equal(await field.evaluate(el => el.selectionStart), value.length, `${name}: caret not at typed end`);
        await page.keyboard.press('ArrowLeft'); await page.keyboard.press('Backspace'); await page.waitForTimeout(80);
        assert.equal(await field.inputValue(), value.slice(0, -2) + value.slice(-1), `${name}: edit at caret failed`);
      }
      await page.keyboard.press('Tab');
      assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('aria-label')), 'Войти');
      await page.close(); console.log(`${name} ${viewport.width}: mouse focus, typing, caret edit and Tab passed`);
    }
  } finally { await browser.close(); }
}
