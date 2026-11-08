import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium, expect, type Page } from '@playwright/test';
import { preview } from 'vite';
import { createApp } from '../src/server/app';
import { createLink, consumeLink } from '../src/server/auth';
import { connectDatabase } from '../src/server/db';
import { loadCourse } from '../src/server/course';
import { defaultSettings } from '../src/server/material';
import { priorTargets } from '../src/shared/prior-learning';
import { wordTarget } from '../src/shared/meanings';
import { nextFixtureIp } from './helpers/fixture-ip';

const url = process.env.JAPANESE_INTEGRATION_DATABASE_URL;
if (!url || new URL(url).hostname !== '127.0.0.1' || new URL(url).pathname !== '/japanese_app_test') throw new Error('Use disposable localhost japanese_app_test only.');
const root = fileURLToPath(new URL('../', import.meta.url)), course = loadCourse(), database = connectDatabase(url);
const output = root + 'test-results/prior-learning'; mkdirSync(output, { recursive: true });
const lesson = course.lessons.find(lesson => lesson.id === 'marugoto.starter-a1.lesson.03')!, targets = priorTargets(course, { lessonId: lesson.id, scope: 'main' }), word = targets.find(target => target.kind === 'word')!;
let app: ReturnType<typeof createApp> | undefined;
const apiServer = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: request => app ? app.fetch(request) : new Response('Starting', { status: 503 }) });
const web = await preview({ root, preview: { host: '127.0.0.1', port: 0, strictPort: true, proxy: { '/api': `http://127.0.0.1:${apiServer.port}` } } });
const address = web.httpServer.address(); if (!address || typeof address === 'string') throw new Error('Missing preview port');
const base = `http://127.0.0.1:${address.port}`;
app = createApp({ database, course, config: { DATABASE_URL: url, BETTER_AUTH_SECRET: crypto.randomUUID() + crypto.randomUUID(), APP_URL: base, PORT: 3000, HOST: '127.0.0.1' } });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const users: { id: string; email: string }[] = [], checks: string[] = [];
const snapshot = (page: Page): Promise<any> => page.evaluate(() => (window as any).__ALBUM__.snapshot());
async function stable(page: Page) {
  await page.waitForFunction(() => {
    const s = (window as any).__ALBUM__?.snapshot();
    return s?.ready && s.authenticated && !s.guided.busy && !s.book.loading &&
      (s.page !== 'book' || s.controls.some((control:any) => ['book-back', 'book-detail-back', 'menu-close'].includes(control.id)));
  });
}
async function press(page: Page, id: string, mobile: boolean) {
  await stable(page);
  await page.waitForFunction(id => (window as any).__ALBUM__.snapshot().controls.some((control:any) => control.id === id && control.enabled), id);
  const before = await snapshot(page), control = before.controls.find((control:any) => control.id === id && control.enabled);
  if (mobile) await page.touchscreen.tap(control.rect.x + control.rect.width / 2, control.rect.y + control.rect.height / 2);
  else await page.mouse.click(control.rect.x + control.rect.width / 2, control.rect.y + control.rect.height / 2);
  await page.waitForFunction(count => (window as any).__ALBUM__.snapshot().renderCount > count, before.renderCount);
  // Pointer hover may repaint before the tap; wait for the action's scheduled frame too.
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await stable(page);
}
async function find(page: Page, id: string, mobile: boolean) {
  await stable(page);
  for (let i = 0; i < 40 && (await snapshot(page)).controls.some((control:any) => control.id === 'book-prev' && control.enabled); i++) await press(page, 'book-prev', mobile);
  for (let i = 0; i < 40; i++) {
    const state = await snapshot(page);
    if (state.controls.some((control:any) => control.id === id && control.enabled)) return;
    if (!state.controls.some((control:any) => control.id === 'book-next' && control.enabled)) throw new Error(`Control unavailable: ${id}; book=${JSON.stringify(state.book)}; controls=${JSON.stringify(state.controls.map((control:any) => control.id))}`);
    await press(page, 'book-next', mobile);
  }
  throw new Error('Book pagination did not finish');
}
async function confirm(page: Page, mobile: boolean) {
  await find(page, 'prior-confirm', mobile); await press(page, 'prior-confirm', mobile);
  await page.waitForFunction(() => { const s = (window as any).__ALBUM__.snapshot(); return !s.book.loading && !s.controls.some((c:any) => c.id === 'prior-confirm') && s.controls.some((c:any) => c.id === 'book-back'); });
  await stable(page);
}
async function capture(page: Page, name: string) {
  await stable(page); const state = await snapshot(page);
  await page.screenshot({ path: `${output}/${name}.png` });
  expect(state.problems).toEqual([]);
}
try {
  for (const mode of ['canvas-desktop', 'canvas-mobile', 'canvas-mobile-320', 'react'] as const) {
    const mobile = mode.startsWith('canvas-mobile');
    const context = await browser.newContext({ viewport: mobile ? { width: mode === 'canvas-mobile-320' ? 320 : 390, height: 844 } : { width: 1280, height: 800 }, isMobile: mobile, hasTouch: mobile, reducedMotion: 'reduce', extraHTTPHeaders: { 'x-forwarded-for': nextFixtureIp() } });
    const email = `prior-browser-${crypto.randomUUID()}@example.test`, password = 'Prior-browser-fixture!';
    const invitation = await createLink(database, 'invite', email, null); expect(await consumeLink(database, 'invite', invitation.token, password, 'Prior learning browser')).toBe(true);
    const signedIn = await context.request.post(base + '/api/auth/sign-in/email', { headers: { origin: base }, data: { email, password } }); expect(signedIn.status()).toBe(200);
    const owner = (await signedIn.json()).user.id; users.push({ id: owner, email });
    const headers = { origin: base, 'X-Learning-Learner-Id': owner };
    expect((await context.request.put(base + '/api/settings', { headers, data: { ...defaultSettings, animations: false, sceneSoundEnabled: false } })).status()).toBe(200);
    const page = await context.newPage(), errors: string[] = []; page.on('pageerror', error => errors.push(error.message)); page.setDefaultTimeout(20000);
    const progress = async () => (await context.request.get(base + '/api/progress')).json();
    if (mode === 'react') {
      await page.goto(base + '/legacy.html');
      const card = page.locator(`article.lesson-card[data-lesson-id="${lesson.id}"]`);
      await card.locator(':scope > .lesson-material > summary').click(); await card.getByText('Дополнительный словарь и конструкции', { exact: true }).click();
      const mark = card.locator('p').filter({ hasText: wordTarget(course, word.id)!.meaningRu }).getByRole('button', { name: 'Уже проходил', exact: true }).first();
      await mark.click();
      const confirmation = page.getByRole('dialog', { name: 'Подтверждение прежнего изучения' });
      expect((await progress()).introducedWordIds).not.toContain(word.id);
      await confirmation.getByRole('button', { name: 'Подтвердить', exact: true }).click();
      await expect(page.getByRole('status')).toContainText('Добавлено карточек: 3'); expect((await progress()).introducedWordIds).toContain(word.id);
      await page.getByRole('button', { name: 'Отменить последнюю отметку', exact: true }).click();
      await expect(page.getByRole('status')).toContainText('Удалено: 3'); expect((await progress()).introducedWordIds).not.toContain(word.id);
      await card.getByRole('button', { name: 'Уже проходил · Основной материал', exact: true }).click();
      await confirmation.getByRole('button', { name: 'Подтвердить', exact: true }).click();
      await expect(card.locator('.lesson-status')).toHaveText('Ранее проходил');
      await card.getByTestId('learn-lesson').click(); await expect(page.getByTestId('learning-complete')).toBeVisible();
      await page.screenshot({ path: `${output}/react-complete.png` });
      checks.push('React: individual mark, undo, bulk core marking and completed route');
    } else {
      await page.goto(base); await stable(page);
      await press(page, 'lesson:' + lesson.id, mobile); await capture(page, mode + '-lesson-before');
      await find(page, 'book-main', mobile); await press(page, 'book-main', mobile);
      await find(page, 'book-word:' + word.id, mobile); await press(page, 'book-word:' + word.id, mobile);
      await capture(page, mode + '-word-before');
      const requests: any[] = []; let loseAck = mode === 'canvas-desktop';
      await context.route('**/api/prior-learning', async route => {
        requests.push(route.request().postDataJSON()); const response = await route.fetch();
        if (loseAck) { loseAck = false; await route.abort(); } else await route.fulfill({ response });
      });
      if (mode === 'canvas-desktop') {
        await page.keyboard.press('Tab');
        await page.getByRole('button', { name: 'Уже проходил', exact: true }).press('Enter');
        await stable(page);
        checks.push('Canvas: marking is keyboard accessible');
      } else await press(page, 'prior-one', mobile);
      expect((await progress()).introducedWordIds).not.toContain(word.id);
      await confirm(page, mobile);
      await press(page, 'book-back', mobile);
      if (mode === 'canvas-desktop') { await find(page, 'prior-retry', mobile); await press(page, 'prior-retry', mobile); expect(requests[1]).toEqual(requests[0]); checks.push('Canvas: lost ACK retries the identical operation without duplicates'); }
      expect((await progress()).introducedWordIds).toContain(word.id); await capture(page, mode + '-word-after');
      await find(page, 'prior-undo', mobile); await press(page, 'prior-undo', mobile); expect((await progress()).introducedWordIds).not.toContain(word.id);
      await find(page, 'book-main', mobile); await press(page, 'book-main', mobile);
      await find(page, 'book-word:' + word.id, mobile); await press(page, 'book-word:' + word.id, mobile);
      await press(page, 'prior-one', mobile); await confirm(page, mobile);
      if (mobile) await press(page, 'nav-menu', true); await press(page, 'reviews', mobile); await press(page, 'review-start', mobile);
      const existing = (await snapshot(page)).review; expect(existing.remaining).toBe(3);
      if (mobile) { await press(page, 'nav-menu', true); await press(page, 'home', true); } else await press(page, 'album-lessons', false);
      await press(page, 'lesson:' + lesson.id, mobile); await find(page, 'prior-main', mobile); await press(page, 'prior-main', mobile);
      await confirm(page, mobile);
      const learned = await progress(); expect(learned.introducedWordIds.length).toBe(targets.filter(target => target.kind === 'word').length);
      expect(learned.introducedSkillIds.length).toBe(targets.filter(target => target.kind === 'grammar').length);
      expect((await snapshot(page)).review.remaining).toBe(existing.remaining); await capture(page, mode + '-lesson-after');
      await find(page, 'book-learn', mobile); await press(page, 'book-learn', mobile); expect((await snapshot(page)).guided.step).toBeNull(); expect((await snapshot(page)).texts.some((value:any)=>value.text==='Урок пройден')).toBe(true);
      checks.push(`${mode}: touch/pointer mark, undo, core lesson completion and unchanged active review queue`);
    }
    expect(errors).toEqual([]); await context.close();
  }
  writeFileSync(output + '/checks.json', JSON.stringify({ checks, physicalDevice: false, isolatedPostgres: true, production: false }, null, 2) + '\n');
  console.log(JSON.stringify({ checks, screenshots: output }));
} finally {
  await browser.close(); await web.close(); apiServer.stop(true);
  for (const owner of users) { await database.sql`delete from access_links where email=${owner.email}`; await database.sql`delete from users where id=${owner.id}`; }
  await database.sql.close();
}
