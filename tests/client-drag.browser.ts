import { chromium, expect, type Locator } from '@playwright/test';
import { createApp } from '../src/server/app';
import { connectDatabase } from '../src/server/db';
import { createLink, consumeLink } from '../src/server/auth';
import { loadCourse } from '../src/server/course';
import { defaultSettings } from '../src/server/material';
import { nextFixtureIp } from './helpers/fixture-ip';
import { output } from './helpers/artifact-output';
import { seedAcceptedHistory, openRepeat } from './helpers/introduced-browser-fixture';
import type { ReviewQueue, ReviewItem } from '../src/shared/types';

const databaseUrl = process.env.JAPANESE_INTEGRATION_DATABASE_URL;
if (!databaseUrl || new URL(databaseUrl).hostname !== '127.0.0.1' || new URL(databaseUrl).pathname !== '/japanese_app_test') throw new Error('Use only disposable localhost japanese_app_test.');
const base = 'http://127.0.0.1:5173';
const database = connectDatabase(databaseUrl);
const course = loadCourse();
const app = createApp({ database, course, config: { DATABASE_URL: databaseUrl, BETTER_AUTH_SECRET: 'mouse-reorder-isolated-fixture-secret-over-32-characters', APP_URL: base, PORT: 3000, HOST: '127.0.0.1' } });
const server = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: app.fetch });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const email = `mouse-reorder-${crypto.randomUUID()}@example.test`;
let page: Awaited<ReturnType<typeof browser.newPage>> | undefined;
try {
  const password = 'Isolated-mouse-reorder-password!';
  const link = await createLink(database, 'invite', email, null);
  await consumeLink(database, 'invite', link.token, password, 'Проверка мыши');
  await seedAcceptedHistory(database, course, email, [], ['marugoto.starter-a1.skill.frequency']);
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, reducedMotion: 'reduce', extraHTTPHeaders: { 'x-forwarded-for': nextFixtureIp() } });
  let current: Extract<ReviewItem, { mode: 'grammar' }> | undefined;
  let reviewWrites = 0;
  await context.route('**/api/**', async route => {
    const request = route.request(); const target = new URL(request.url()); target.host = `127.0.0.1:${server.port}`;
    if (target.pathname === '/api/reviews' && request.method() === 'POST') reviewWrites++;
    const response = await route.fetch({ url: target.href });
    if (target.pathname === '/api/reviews' && request.method() === 'GET') {
      const result: ReviewQueue = await response.json();
      const first = result.items[0]; if (first?.mode === 'grammar') current = first;
    }
    await route.fulfill({ response });
  });
  page = await context.newPage();
  await page.goto(base);
  await page.getByLabel('Email', { exact: true }).fill(email);
  await page.getByLabel('Пароль', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Войти', exact: true }).click();
  await expect(page.getByTestId('train-lesson').first()).toBeVisible();
  const saved = await context.request.put(`http://127.0.0.1:${server.port}/api/settings`, { headers: { origin: base }, data: { ...structuredClone(defaultSettings), lessonStatuses: Object.fromEntries(course.lessons.map(lesson => [lesson.id, 'studying'])), focusSkillIds: ['marugoto.starter-a1.skill.frequency'], newWordsPerDay: 0, newSkillsPerDay: 1 } });
  expect(saved.status()).toBe(200);
  await page.reload(); await openRepeat(page);
  const area = page.getByRole('group', { name: 'Ваше предложение', exact: true });
  const bank = page.getByRole('group', { name: 'Доступные элементы', exact: true });
  await expect(area).toBeVisible();
  if (!current) throw new Error('A real mixed grammar queue was not presented.');
  const order = current.exercise.acceptedOrders[0]!;
  expect(order.length).toBeGreaterThan(2);
  for (const id of order) await bank.locator(`[data-token-id="${id}"]`).click();
  const tokens = area.locator('[data-token-id]');
  await expect(tokens).toHaveCount(order.length);
  const readOrder = () => tokens.evaluateAll(elements => elements.map(element => element.getAttribute('data-token-id')));
  expect(await readOrder()).toEqual(order);
  async function mouseDrag(source: Locator, target: Locator, edge: 'left' | 'right') {
    await source.scrollIntoViewIfNeeded();
    const a = await source.boundingBox(); const b = await target.boundingBox();
    if (!a || !b) throw new Error('Real token boxes unavailable.');
    const x = a.x + a.width / 2; const y = a.y + a.height / 2;
    await page!.mouse.move(x, y); await page!.mouse.down();
    await page!.mouse.move(x + 12, y, { steps: 4 });
    await page!.mouse.move(b.x + (edge === 'right' ? b.width - 8 : 8), b.y + b.height / 2, { steps: 12 });
    await page!.mouse.up();
  }
  await mouseDrag(tokens.first(), tokens.nth(1), 'right');
  const adjacent = [order[1], order[0], ...order.slice(2)];
  console.info(JSON.stringify({ phase: 'right-adjacent', initial: order, expected: adjacent, actual: await readOrder(), reviewWrites }));
  await expect.poll(readOrder, { timeout: 1500, message: 'Dragging first token past the adjacent token must move it after that token.' }).toEqual(adjacent);
  await mouseDrag(tokens.nth(1), tokens.first(), 'left');
  await expect.poll(readOrder, { timeout: 1500 }).toEqual(order);
  await mouseDrag(tokens.first(), tokens.last(), 'right');
  await expect.poll(readOrder, { timeout: 1500 }).toEqual([...order.slice(1), order[0]]);
  await mouseDrag(tokens.last(), tokens.first(), 'left');
  await expect.poll(readOrder, { timeout: 1500 }).toEqual(order);
  await expect(page.locator('[data-outcome="correct"]')).toBeVisible();
  expect(reviewWrites).toBe(0);
  expect(await page.getByRole('dialog').count()).toBe(0);
  await tokens.first().click();
  await expect(page.getByRole('dialog', { name: 'Изменить элемент', exact: true })).toBeVisible();
  expect(await readOrder()).toEqual(order);
  console.info(JSON.stringify({ browser: browser.version(), mouseAdjacentBothDirections: true, mouseNonAdjacentBothDirections: true, clickStillEdits: true, reviewWrites }));
} catch (failure) {
  if (page && !page.isClosed()) await page.screenshot({ path: `${output}/qa-mouse-reorder.png`, fullPage: true });
  throw failure;
} finally {
  await browser.close(); server.stop(true);
  await database.sql`delete from access_links where email=${email}`;
  await database.sql`delete from users where email=${email}`;
  await database.sql.close();
}
