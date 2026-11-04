import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { chromium, webkit } from '@playwright/test';

const base = 'http://127.0.0.1:5190/';
const technicalOnly = process.argv.includes('--technical-only');
const output = new URL('./test-results/', import.meta.url);
await mkdir(output, { recursive: true });
const fixture = JSON.parse(await readFile(new URL('./fixtures.json', import.meta.url)));
assert.equal(createHash('sha256').update(await readFile(new URL('../../materials/course.json', import.meta.url))).digest('hex'), fixture.courseSha256);
const nginx = await readFile(new URL('../../deployment/nginx-http.conf', import.meta.url), 'utf8');
const response = await fetch(base);
assert.equal(response.headers.get('content-security-policy'), nginx.match(/add_header Content-Security-Policy "([^"]+)" always;/)[1]);
assert.equal((await fetch(base + 'api/session')).status, 404);
assert.equal((await fetch(base + '%2e%2e%2fpackage.json')).status, 404);

const result = { date: new Date().toISOString(), source: fixture.source, browsers: {}, physicalDevices: 'manual-required', safari: 'remote-automation-disabled', voiceOver: 'manual-required' };
const settle = page => page.waitForTimeout(100);
const state = page => page.evaluate(() => window.__LAB__.snapshot());
async function load(page, query) {
  await page.goto(base + '?' + query);
  await page.waitForFunction(() => window.__LAB__?.snapshot().ready);
  await settle(page);
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}
async function click(page, id) {
  await page.waitForFunction(id => window.__LAB__.snapshot().controls.some(control => control.id === id), id, { timeout: 5000 });
  let control = (await state(page)).controls.find(value => value.id === id);
  assert.ok(control, `Missing Canvas control ${id}`);
  await page.evaluate(y => window.scrollTo(0, Math.max(0, y - innerHeight / 2)), control.rect.y);
  await settle(page);
  await page.waitForFunction(() => !window.__LAB__.snapshot().pendingRender);
  control = (await state(page)).controls.find(value => value.id === id);
  const scroll = await page.evaluate(() => scrollY);
  await page.mouse.click(control.rect.x + control.rect.width / 2, control.rect.y - scroll + control.rect.height / 2);
  await settle(page);
  await page.waitForFunction(() => !window.__LAB__.snapshot().pendingRender);
}
function geometry(snapshot, width) {
  if (snapshot.view === 'cards') {
    const a = snapshot.cardBounds, b = snapshot.catBounds;
    assert.ok(b.x >= a.x + a.width || b.y >= a.y + a.height || b.x + b.width <= a.x || b.y + b.height <= a.y, 'Card must leave the cat visible');
  }
  for (const ruby of snapshot.rubyGeometry) {
    assert.equal(ruby.overflow, false);
    for (let i = 1; i < ruby.groups.length; i++) {
      const a = ruby.groups[i - 1], b = ruby.groups[i];
      assert.ok(b.y > a.y || b.x >= a.x + a.width - .01, 'Ruby groups overlap');
    }
  }
  for (const control of snapshot.controls) {
    assert.ok(control.rect.width >= 44 && control.rect.height >= 44, 'Touch target <44px');
    assert.ok(control.rect.x >= 0 && control.rect.x + control.rect.width <= width + .1, `Offscreen control ${control.id}`);
  }
  assert.deepEqual(snapshot.cspViolations, []);
}

for (const [name, type, options] of [['chrome', chromium, { channel: 'chrome' }], ['webkit', webkit, {}]]) {
  const browser = await type.launch({ ...options, headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 2, reducedMotion: 'reduce' });
    const errors = [], violations = [], requests = [];
    page.on('pageerror', error => { errors.push(error.message); console.error(name, error.message); });
    page.on('request', request => requests.push(request.url()));
    await page.addInitScript(() => {
      window.__violations = [];
      document.addEventListener('securitypolicyviolation', event => window.__violations.push({ directive: event.effectiveDirective, blocked: event.blockedURI }));
    });
    await load(page, 'view=lab');
    console.log(`${name}: lab ready`);
    assert.equal((await state(page)).renderer, 'WebGL');
    geometry(await state(page), 1440);
    await page.locator('textarea').fill('今日は東京へ行きます。\n魚を食べます。');
    assert.equal(await page.locator('textarea').evaluate(el => document.activeElement === el), true, 'Canvas render must keep editor focus');
    await page.locator('textarea').evaluate(el => el.setSelectionRange(3, 5));
    await page.keyboard.insertText('新聞');
    assert.equal(await page.locator('textarea').inputValue(), '今日は新聞へ行きます。\n魚を食べます。');
    const commits = (await state(page)).inputCommits;
    await page.locator('textarea').evaluate(el => {
      el.dispatchEvent(new CompositionEvent('compositionstart', { data: 'さかな' }));
      el.value = 'さかな';
      el.dispatchEvent(new InputEvent('input', { data: 'さかな', isComposing: true, bubbles: true }));
    });
    assert.equal((await state(page)).composing, true);
    assert.equal((await state(page)).inputCommits, commits);
    await page.locator('textarea').evaluate(el => el.dispatchEvent(new CompositionEvent('compositionend', { data: '魚' })));
    assert.equal((await state(page)).composing, false);
    await page.locator('textarea').fill('わたしはがくせいです。');
    await page.locator('input[type=password]').fill('test-only-123');
    assert.equal((await state(page)).passwordLength, 13);
    assert.equal(await page.locator('input[type=password]').getAttribute('autocomplete'), 'new-password');
    await page.locator('input[type=password]').blur();
    await page.screenshot({ path: new URL(`${name}-lab.png`, output).pathname, fullPage: true });
    console.log(`${name}: input passed; starting video`);

    await click(page, 'probe-video');
    await page.waitForFunction(() => typeof window.__LAB__.snapshot().video === 'object', { timeout: 30000 });
    const media = (await state(page)).video;
    console.log(`${name}: video ${JSON.stringify(media)}`);
    assert.equal(media.native, 'playing');
    assert.equal(media.crossOrigin, 'blocked');
    assert.equal(media.upload, 'SecurityError');
    assert.ok(await page.locator('video').evaluate(el => el.videoWidth > 0));
    await click(page, 'pause-video');
    assert.equal(await page.locator('video').evaluate(el => el.paused), true);
    const time = await page.locator('video').evaluate(el => el.currentTime);
    await click(page, 'seek-video');
    assert.ok(await page.locator('video').evaluate(el => el.currentTime) >= time + 4.5);
    await page.screenshot({ path: new URL(`${name}-video.png`, output).pathname, fullPage: true });

    await click(page, 'lose-context');
    await page.waitForFunction(() => window.__LAB__.snapshot().context === 'lost');
    await page.locator('#retry').click();
    await page.waitForFunction(() => window.__LAB__.snapshot().context === 'restored');
    console.log(`${name}: context restored`);
    assert.equal(await page.locator('textarea').inputValue(), 'わたしはがくせいです。');
    await page.evaluate(() => {
      const canvas = window.__LAB__.app.canvas;
      (canvas.getContext('webgl2') ?? canvas.getContext('webgl')).getExtension('WEBGL_lose_context').loseContext();
    });
    await page.waitForFunction(() => window.__LAB__.snapshot().context === 'lost');
    await page.locator('#retry').click();
    await page.waitForFunction(() => window.__LAB__.snapshot().context === 'restored');
    assert.equal(await page.locator('textarea').inputValue(), 'わたしはがくせいです。');
    await click(page, 'construction');
    for (const token of [0, 1, 2, 3]) await click(page, `token-${token}`);
    await click(page, 'check-phrase');
    assert.deepEqual((await state(page)).selectedTokens, [0, 1, 2, 3]);
    await page.keyboard.press('ArrowRight');
    assert.equal((await state(page)).variant, 'B');
    assert.deepEqual((await state(page)).selectedTokens, [0, 1, 2, 3]);
    await click(page, 'manual');
    await page.locator('textarea').fill('わたしはがくせいです。');
    await page.locator('textarea').evaluate(el => el.dispatchEvent(new CompositionEvent('compositionstart')));
    await click(page, 'check-phrase');
    assert.equal((await state(page)).feedback, 'Завершите ввод японского текста.');
    await page.locator('textarea').evaluate(el => el.dispatchEvent(new CompositionEvent('compositionend')));
    await click(page, 'check-phrase');
    await click(page, 'word');
    await page.getByRole('button', { name: 'рыба', exact: true }).focus();
    await page.keyboard.press('Enter');
    await settle(page);
    assert.equal((await state(page)).chosen, 0, 'Accessible button must answer using keyboard');
    console.log(`${name}: keyboard passed; starting layout matrix`);

    const matrix = [];
    for (const [size, width, height] of technicalOnly ? [] : [['desktop', 1440, 1000], ['laptop', 1280, 900], ['tablet', 768, 1024], ['phone', 390, 844], ['narrow', 320, 640], ['landscape', 844, 390]]) {
      await page.setViewportSize({ width, height });
      console.log(`${name}: ${size}`);
      for (const variant of ['A', 'B', 'C']) for (const exercise of ['word', 'construction']) {
        await load(page, `variant=${variant}&exercise=${exercise}`);
        const snapshot = await state(page);
        assert.equal(snapshot.variant, variant);
        assert.equal(snapshot.exercise, exercise);
        geometry(snapshot, width);
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
        assert.equal(await page.evaluate(() => document.documentElement.scrollHeight <= document.querySelector('#stage').clientHeight + 1), true, 'Invisible semantics must not add page overflow');
        if (size === 'desktop' || size === 'phone') await page.screenshot({ path: new URL(`${name}-${size}-${variant}-${exercise}.png`, output).pathname, fullPage: true });
        if (exercise === 'word') {
          await click(page, 'answer-0');
          assert.equal((await state(page)).chosen, 0);
          await click(page, 'next-word');
          assert.equal((await state(page)).wordIndex, 1);
          for (let i = 0; i < 3; i++) { await click(page, 'script'); geometry(await state(page), width); }
        } else {
          for (const token of [0, 1, 2, 3]) await click(page, `token-${token}`);
          await click(page, 'check-phrase');
          assert.deepEqual((await state(page)).selectedTokens, [0, 1, 2, 3]);
          await click(page, 'selected-1');
          assert.deepEqual((await state(page)).selectedTokens, [0, 2, 3]);
        }
        matrix.push(`${size}/${variant}/${exercise}`);
      }
      await load(page, 'view=lab');
      geometry(await state(page), width);
    }
    for (let i = 0; i < 5; i++) { await click(page, 'scene'); }
    await page.waitForLoadState('networkidle');
    assert.deepEqual(await page.evaluate(() => window.__violations), []);
    assert.deepEqual(errors, []);
    assert.equal(requests.some(url => new URL(url).pathname.startsWith('/api')), false, 'Prototype must never call app API');
    result.browsers[name] = { version: browser.version(), renderer: 'WebGL', video: media, matrix, errors, cspViolations: violations, ime: 'synthetic-events-only', password: 'masked; native input; autofill manual', contextRecovery: 'passed; editor value retained', fixturesHash: fixture.courseSha256 };
    console.log(`${name}: passed; ${matrix.length} card cases, input, ruby, CSP, native video + blocked texture, context recovery`);
    await page.close();
  } finally { await browser.close(); }
}
await writeFile(new URL(technicalOnly ? 'checks-technical.json' : 'checks.json', output), JSON.stringify(result, null, 2) + '\n');
