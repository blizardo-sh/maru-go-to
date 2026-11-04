import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium, expect, type Page } from '@playwright/test';
import { preview } from 'vite';
import { createApp } from '../src/server/app';
import { createLink, consumeLink } from '../src/server/auth';
import { connectDatabase } from '../src/server/db';
import { loadCourse } from '../src/server/course';
import { defaultSettings } from '../src/server/material';
import { mainLessonMaterial } from '../src/shared/priorLearning';
import { nextFixtureIp } from './helpers/fixture-ip';

const url = process.env.JAPANESE_INTEGRATION_DATABASE_URL;
if (!url || new URL(url).hostname !== '127.0.0.1' || new URL(url).pathname !== '/japanese_app_test') throw new Error('Use disposable localhost japanese_app_test only.');
const root = fileURLToPath(new URL('../', import.meta.url)), course = loadCourse(), database = connectDatabase(url);
const output = root + 'test-results/prior-learning'; mkdirSync(output, { recursive: true });
const lesson = course.lessons.find(lesson => lesson.number === 3)!, targets = mainLessonMaterial(course, lesson.id), word = targets.find(target => target.kind === 'word')!;
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
  await page.waitForFunction(() => { const s = (window as any).__ALBUM__?.snapshot(); return s?.ready && s.authenticated && !s.guided.busy && !s.book.loading; });
}
async function press(page: Page, id: string, mobile: boolean) {
  await stable(page);
  await page.waitForFunction(id => (window as any).__ALBUM__.snapshot().controls.some((control:any) => control.id === id && control.enabled), id);
  const before = await snapshot(page), control = before.controls.find((control:any) => control.id === id && control.enabled);
  if (mobile) await page.touchscreen.tap(control.rect.x + control.rect.width / 2, control.rect.y + control.rect.height / 2);
  else await page.mouse.click(control.rect.x + control.rect.width / 2, control.rect.y + control.rect.height / 2);
  await page.waitForFunction(count => (window as any).__ALBUM__.snapshot().renderCount > count, before.renderCount); await stable(page);
}
async function find(page: Page, id: string, mobile: boolean) {
  for (let i = 0; i < 40; i++) {
    const state = await snapshot(page);
    if (state.controls.some((control:any) => control.id === id && control.enabled)) return;
    if (!state.controls.some((control:any) => control.id === 'book-next' && control.enabled)) throw new Error(`Control unavailable: ${id}`);
    await press(page, 'book-next', mobile);
  }
  throw new Error('Book pagination did not finish');
}
async function capture(page: Page, name: string) {
  await stable(page); const state = await snapshot(page);
  expect(state.problems).toEqual([]);
  await page.screenshot({ path: `${output}/${name}.png` });
}
try {
  for (const mode of ['canvas-desktop', 'canvas-mobile', 'react'] as const) {
    const mobile = mode === 'canvas-mobile';
    const context = await browser.newContext({ viewport: mobile ? { width: 390, height: 844 } : { width: 1280, height: 800 }, isMobile: mobile, hasTouch: mobile, reducedMotion: 'reduce', extraHTTPHeaders: { 'x-forwarded-for': nextFixtureIp() } });
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
      await card.locator(':scope > .lesson-material > summary').click(); await card.getByText('Все слова и конструкции', { exact: true }).click();
      const mark = card.locator(`[data-testid=prior-material][data-kind=word][data-item-id="${word.itemId}"]`);
      await mark.click(); await expect(mark).toHaveText('Отменить отметку'); expect((await progress()).introducedWordIds).toContain(word.itemId);
      await mark.click(); await expect(mark).toHaveText('Уже проходил'); expect((await progress()).introducedWordIds).not.toContain(word.itemId);
      await card.getByTestId('prior-lesson').click(); await expect(card.locator('.lesson-status')).toHaveText('Урок пройден');
      await card.getByTestId('learn-lesson').click(); await expect(page.getByTestId('learning-complete')).toBeVisible();
      await page.screenshot({ path: `${output}/react-complete.png` });
      checks.push('React: individual mark, undo, bulk core marking and completed route');
    } else {
      await page.goto(base); await stable(page);
      await press(page, 'lesson:' + lesson.id, mobile); await capture(page, mode + '-lesson-before');
      await find(page, 'book-main', mobile); await press(page, 'book-main', mobile);
      await find(page, 'book-word:' + word.itemId, mobile); await press(page, 'book-word:' + word.itemId, mobile);
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
      } else await press(page, 'book-mark:word:' + word.itemId, mobile);
      if (mode === 'canvas-desktop') { await press(page, 'book-mark-retry', mobile); expect(requests[1]).toEqual(requests[0]); checks.push('Canvas: lost ACK retries the identical operation without duplicates'); }
      await page.waitForFunction(id => (window as any).__ALBUM__.snapshot().controls.some((control:any) => control.id === id && control.text === 'Отменить отметку'), 'book-mark:word:' + word.itemId);
      expect((await progress()).introducedWordIds).toContain(word.itemId); await capture(page, mode + '-word-after');
      await press(page, 'book-mark:word:' + word.itemId, mobile); expect((await progress()).introducedWordIds).not.toContain(word.itemId);
      await press(page, 'book-mark:word:' + word.itemId, mobile);
      if (mobile) await press(page, 'nav-menu', true); await press(page, 'reviews', mobile); await press(page, 'review-start', mobile);
      const existing = (await snapshot(page)).review; expect(existing.remaining).toBe(3);
      if (mobile) { await press(page, 'nav-menu', true); await press(page, 'home', true); } else await press(page, 'album-lessons', false);
      await press(page, 'lesson:' + lesson.id, mobile); await find(page, 'book-mark-lesson', mobile); await press(page, 'book-mark-lesson', mobile);
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
