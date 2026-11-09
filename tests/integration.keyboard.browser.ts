import { chromium, webkit, expect } from '@playwright/test';
import { preview } from 'vite';
import { output } from './helpers/artifact-output';

const engine = process.env.KEYBOARD_BROWSER === 'webkit' ? 'webkit' : 'chromium';
const web = await preview({ preview: { host: '127.0.0.1', port: 0, strictPort: true } });
const address = web.httpServer.address();
if (!address || typeof address === 'string') throw new Error('Missing local preview port');
const base = `http://127.0.0.1:${address.port}`;
const browser = await (engine === 'webkit' ? webkit.launch() : chromium.launch({ channel: 'chrome' }));
const records: unknown[] = [];
try {
  for (const width of [320, 390, 440]) {
    const context = await browser.newContext({ viewport: { width, height: 844 }, hasTouch: true, isMobile: true, reducedMotion: 'reduce' });
    try {
      // Model iOS keyboard/panning events: desktop Playwright has no native phone keyboard.
      await context.addInitScript(() => {
        const viewport = visualViewport!, metrics = { height: innerHeight, offsetTop: 0, scale: 1 };
        for (const key of Object.keys(metrics) as (keyof typeof metrics)[]) Object.defineProperty(viewport, key, { get: () => metrics[key] });
        (window as any).__keyboardViewport = (next: Partial<typeof metrics>) => {
          Object.assign(metrics, next); viewport.dispatchEvent(new Event('resize')); viewport.dispatchEvent(new Event('scroll'));
        };
      });
      const page = await context.newPage(), errors: string[] = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.route('**/api/**', route => { expect(route.request().method()).toBe('GET'); return route.fulfill({ status: 401, contentType: 'application/json', body: '{"error":"Local keyboard fixture"}' }); });
      for (const path of ['/', '/register', '/recover']) {
        console.info(`Keyboard fixture: ${engine} ${width}px ${path}`);
        await page.bringToFront();
        await page.goto(base + path); await page.locator('#startup').waitFor({ state: 'hidden', timeout: 60000 });
        const password = page.getByLabel('Пароль', { exact: true });
        await expect(password).toBeVisible(); await password.fill('Local fixture only');
        const original = await password.boundingBox();
        await password.focus(); await password.evaluate((input: HTMLInputElement) => input.setSelectionRange(5, 5));
        const viewport = async (height: number, offsetTop = 0, scale = 1) => page.evaluate(async value => {
          (window as any).__keyboardViewport(value);
          await Promise.race([
            (async () => { await new Promise(requestAnimationFrame); await new Promise(requestAnimationFrame); })(),
            new Promise((_, reject) => setTimeout(() => reject(new Error(`Keyboard frames unavailable: ${document.visibilityState}, focused=${document.hasFocus()}, ${location.pathname}, ${JSON.stringify(value)}`)), 5000)),
          ]);
        }, { height, offsetTop, scale });
        const visibleEditors = async (height: number, top = 0) => {
          await expect.poll(async () => page.locator('.native-editor:visible').evaluateAll((fields, bounds) => fields.every(field => {
            const rect = field.getBoundingClientRect(); return rect.top >= bounds.top + 15 && rect.bottom <= bounds.top + bounds.height - 15;
          }), { height, top })).toBe(true);
        };
        await viewport(300); await visibleEditors(300);
        await expect(password).toBeFocused(); expect(await password.inputValue()).toBe('Local fixture only');
        expect(await password.evaluate((input: HTMLInputElement) => input.selectionStart)).toBe(5);
        await viewport(280, 36); await visibleEditors(280, 36);
        const shifted = await password.boundingBox();
        for (let i = 0; i < 3; i++) await viewport(280, 36);
        await visibleEditors(280, 36); expect((await password.boundingBox())!.y).toBeCloseTo(shifted!.y, 0);
        await viewport(160);
        const focused = (await password.boundingBox())!;
        expect(focused.y).toBeGreaterThanOrEqual(15); expect(focused.y + focused.height).toBeLessThanOrEqual(145);
        await viewport(280, 36); await visibleEditors(280, 36);
        const email = page.getByLabel('Электронная почта', { exact: true });
        if (await email.isVisible()) {
          const rect = (await email.boundingBox())!;
          await page.touchscreen.tap(rect.x + rect.width / 2, rect.y + rect.height / 2);
          await expect(email).toBeFocused(); await visibleEditors(280, 36);
          await password.focus();
        }
        // The Done button can dismiss the keyboard while leaving the input focused.
        await viewport(844); await expect.poll(() => page.locator('#stage').evaluate(node => (node as HTMLElement).style.translate)).toBe('');
        await expect(password).toBeFocused(); expect((await password.boundingBox())!.y).toBeCloseTo(original!.y, 0);
        expect(await password.inputValue()).toBe('Local fixture only');
        await viewport(300); await visibleEditors(300); await password.blur();
        await expect.poll(() => page.locator('#stage').evaluate(node => (node as HTMLElement).style.translate)).toBe('');
        await password.focus(); await viewport(300, 0, 2);
        await expect.poll(() => page.locator('#stage').evaluate(node => (node as HTMLElement).style.translate)).toBe('');
        await viewport(844);
        records.push({ width, path, keyboardAndPan: true, focusedFieldFallback: true, noDrift: true, inputAndCaretPreserved: true, dismissalWithoutBlur: true, physicalDevice: false });
      }
      expect(errors).toEqual([]);
    } finally { await context.close(); }
  }
  await Bun.write(`${output}/keyboard-${engine}.json`, JSON.stringify({ engine, green: true, records }, null, 2));
  console.info(`Keyboard viewport: ${records.length} ${engine} form/width scenarios passed; simulated keyboard, no account or database writes.`);
} finally { await browser.close(); await web.close(); }
