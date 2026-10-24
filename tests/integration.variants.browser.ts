import { chromium, expect } from '@playwright/test';
import { createApp } from '../src/server/app';
import { createLink, consumeLink } from '../src/server/auth';
import { connectDatabase } from '../src/server/db';
import { loadCourse } from '../src/server/course';
import { defaultSettings } from '../src/server/material';
import { nextFixtureIp } from './helpers/fixture-ip';
import { output } from './helpers/artifact-output';
import { seedAcceptedHistory, openRepeat } from './helpers/introduced-browser-fixture';
import type { ReviewItem, ReviewQueue, ReviewSubmission } from '../src/shared/types';

const databaseUrl = process.env.JAPANESE_INTEGRATION_DATABASE_URL;
if (!databaseUrl || new URL(databaseUrl).hostname !== '127.0.0.1' || new URL(databaseUrl).pathname !== '/japanese_app_test') throw new Error('Use only disposable localhost japanese_app_test.');
const base = process.env.BROWSER_URL ?? 'http://127.0.0.1:5173';
const database = connectDatabase(databaseUrl);
const course = loadCourse();
// This fixture never reads preview env or configures an external analysis provider.
const app = createApp({ database, course, config: { DATABASE_URL: databaseUrl, BETTER_AUTH_SECRET: 'equivalent-answer-browser-fixture-secret-over32', APP_URL: base, PORT: 3000, HOST: '127.0.0.1' } });
const server = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: app.fetch });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const emails: string[] = [];
const results: object[] = [];
try {
  for (const touch of [false, true]) {
    const viewport = touch ? { width: 390, height: 844 } : { width: 1280, height: 900 };
    const email = `equivalent-browser-${crypto.randomUUID()}@example.test`;
    const password = 'Equivalent-browser-isolated-password!'; emails.push(email);
    const link = await createLink(database, 'invite', email, null);
    await consumeLink(database, 'invite', link.token, password, 'Проверка вариантов');
  await seedAcceptedHistory(database, course, email, [], ['marugoto.starter-a1.skill.ga_ability']);
    const context = await browser.newContext({ viewport, isMobile: touch, hasTouch: touch, reducedMotion: 'reduce', extraHTTPHeaders: { 'x-forwarded-for': nextFixtureIp() } });
    let current: Extract<ReviewItem, { mode: 'grammar' }> | undefined;
    const submissions: ReviewSubmission[] = [];
    let analysisRequests = 0;
    await context.route('**/api/**', async route => {
      const request = route.request(); const target = new URL(request.url()); target.host = `127.0.0.1:${server.port}`;
      if (target.pathname === '/api/reviews' && request.method() === 'POST') submissions.push(request.postDataJSON());
      if (target.pathname === '/api/analyze') analysisRequests++;
      const response = await route.fetch({ url: target.href });
      if (target.pathname === '/api/reviews' && request.method() === 'GET') {
        const queue: ReviewQueue = await response.json(); const item = queue.items[0];
        if (item?.mode === 'grammar') current = item;
      }
      await route.fulfill({ response });
    });
    const page = await context.newPage(); const pageErrors: string[] = [];
    page.on('pageerror', error => pageErrors.push(error.message));
    try {
      await page.goto(base);
      await page.getByLabel('Email', { exact: true }).fill(email);
      await page.getByLabel('Пароль', { exact: true }).fill(password);
      await page.getByRole('button', { name: 'Войти', exact: true }).click();
      await expect(page.getByRole('navigation', { name: 'Разделы' })).toBeVisible();
      expect((await context.request.put(`http://127.0.0.1:${server.port}/api/settings`, { headers: { origin: base }, data: { ...structuredClone(defaultSettings), lessonStatuses: Object.fromEntries(course.lessons.map(lesson => [lesson.id, 'studying'])), focusSkillIds: ['marugoto.starter-a1.skill.ga_ability'], newWordsPerDay: 0, newSkillsPerDay: 1 } })).status()).toBe(200);
      await page.reload(); await openRepeat(page);
      const area = page.getByRole('group', { name: 'Ваше предложение', exact: true });
      const bank = page.getByRole('group', { name: 'Доступные элементы', exact: true });
      const gesture = page.getByTestId('review-gesture');
      await expect(area).toBeVisible();
      if (!current || current.exercise.id !== 'marugoto.starter-a1.example.ga_ability.l03.1') throw new Error('Expected the issued ability exercise.');
      const order = current.exercise.acceptedOrders[0]!;
      for (const id of order) { const button = bank.locator(`[data-token-id="${id}"]`); if (touch) await button.tap(); else await button.click(); }
      await expect(page.locator('[data-outcome="correct"]')).toBeVisible();
      for (const id of ['t1', 't2']) {
        const token = area.locator(`[data-token-id="${id}"]`);
        if (touch) {
          await token.tap();
          const editor = page.getByRole('dialog', { name: 'Изменить элемент', exact: true });
          await editor.getByRole('button', { name: 'Удалить', exact: true }).tap();
          await expect(editor).not.toBeVisible();
        } else { await token.focus(); await page.keyboard.press('Delete'); }
      }
      const tokens = area.locator('[data-token-id]');
      await expect(tokens).toHaveCount(3);
      expect(await tokens.evaluateAll(elements => elements.map(element => element.getAttribute('data-token-id')))).toEqual(['t3', 't4', 't5']);
      await expect(page.locator('[data-outcome="correct"]')).toBeVisible();
      await expect(page.getByRole('region', { name: 'Разбор текущей фразы', exact: true })).toContainText('Я могу говорить по-японски.');
      expect(submissions).toHaveLength(0);
      expect((await (await context.request.get(`http://127.0.0.1:${server.port}/api/progress`)).json()).byMode.grammar.reviewedToday).toBe(0);

      // Return from the trusted short variant to the full answer; automatic exploration must not stay sticky.
      for (const id of ['t1', 't2']) { const button = bank.locator(`[data-token-id="${id}"]`); if (touch) await button.tap(); else await button.click(); }
      for (const [id, steps] of [['t1', 3], ['t2', 3]] as const) {
        const token = area.locator(`[data-token-id="${id}"]`);
        if (touch) {
          await token.tap(); const editor = page.getByRole('dialog', { name: 'Изменить элемент', exact: true });
          for (let step = 0; step < steps; step++) await editor.getByRole('button', { name: 'Левее', exact: true }).tap();
          await editor.getByRole('button', { name: 'Закрыть редактор', exact: true }).tap();
        } else {
          await token.focus(); for (let step = 0; step < steps; step++) await page.keyboard.press('ArrowLeft');
        }
      }
      expect(await tokens.evaluateAll(elements => elements.map(element => element.getAttribute('data-token-id')))).toEqual(order);
      await expect(page.locator('[data-outcome="correct"]')).toBeVisible();
      await expect(page.locator('.analysis-state')).toContainText('Разбор актуален.');
      expect(submissions).toHaveLength(0);
      if (touch) {
        const heading = page.getByRole('heading', { name: current.exercise.promptRu, exact: true, level: 2 });
        await heading.scrollIntoViewIfNeeded(); const box = await heading.boundingBox(); if (!box) throw new Error('No card heading box');
        const cdp = await context.newCDPSession(page); const x = box.x + box.width / 2; const y = box.y + box.height / 2;
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
        for (let step = 1; step <= 5; step++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x + step * 22, y }] });
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await cdp.detach();
      } else { await gesture.focus(); await page.keyboard.press('ArrowRight'); }
      expect(submissions).toHaveLength(0); await page.locator('.workspace-next').click();
      await expect(page.getByRole('heading', { name: 'Повторение завершено', exact: true })).toBeVisible();
      expect(submissions).toHaveLength(1);
      expect(submissions[0]).toMatchObject({ mode: 'grammar', tokenIds: order, revealed: false, exploring: false, rating: 3 });
      const progress = await (await context.request.get(`http://127.0.0.1:${server.port}/api/progress`)).json();
      expect(progress.byMode.grammar.reviewedToday).toBe(1); expect(progress.skillsIntroducedToday).toBe(1);
      expect(pageErrors).toEqual([]);
      results.push({ viewport, touch, shortAnswerCorrect: true, localTranslation: true, restoredFullAnswerGood: true, commits: submissions.length, analysisRequests, externalCalls: 0, pageErrors: pageErrors.length });
    } catch (error) {
      await page.screenshot({ path: `${output}/qa-variants-failure.png`, fullPage: true });
      console.info(await page.locator('#main').ariaSnapshot()); throw error;
    } finally { await context.close(); }
  }
  console.info(JSON.stringify({ browser: browser.version(), results }, null, 2));
} finally {
  await browser.close(); server.stop(true);
  for (const email of emails) { await database.sql`delete from access_links where email=${email}`; await database.sql`delete from users where email=${email}`; }
  await database.sql.close();
}
