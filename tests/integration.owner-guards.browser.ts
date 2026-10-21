import { chromium, expect } from '@playwright/test';
import { createApp } from '../src/server/app';
import { connectDatabase } from '../src/server/db';
import { createLink, consumeLink } from '../src/server/auth';
import { loadCourse } from '../src/server/course';
import type { ReviewQueue, ReviewSubmission } from '../src/shared/types';
import { nextFixtureIp } from './helpers/fixture-ip';
import { output } from './helpers/artifact-output';
const databaseUrl = process.env.JAPANESE_INTEGRATION_DATABASE_URL;
if (!databaseUrl || new URL(databaseUrl).hostname !== '127.0.0.1' || new URL(databaseUrl).pathname !== '/japanese_app_test') throw new Error('Use only disposable localhost japanese_app_test.');
const base = 'http://127.0.0.1:5173'; const database = connectDatabase(databaseUrl); const course = loadCourse();
const app = createApp({ database, course, config: { DATABASE_URL: databaseUrl, BETTER_AUTH_SECRET: 'owner-race-isolated-fixture-secret-over32', APP_URL: base, PORT: 3000, HOST: '127.0.0.1' } }); const server = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: app.fetch }); const api = `http://127.0.0.1:${server.port}`;
const browser = await chromium.launch({ channel: 'chrome', headless: true }); const context = await browser.newContext({ reducedMotion: 'reduce', extraHTTPHeaders: { 'x-forwarded-for': nextFixtureIp() } }); const page = await context.newPage(); const emails: string[] = []; const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
const password = 'Owner-fixture-isolated-password!';
let releaseReview: (() => void) | undefined; const reviewGate = new Promise<void>(resolve => { releaseReview = resolve; }); let heldReview = false;
let releaseSettings: (() => void) | undefined; const settingsGate = new Promise<void>(resolve => { releaseSettings = resolve; }); let holdSettings = false; let heldSettings = false;
let releaseRefresh: (() => void) | undefined; const refreshGate = new Promise<void>(resolve => { releaseRefresh = resolve; }); let holdRefresh = false;
let account = 'none'; const reviewPosts: { owner: string; attemptId: string }[] = [];
async function create(label: string) { const email = `owner-browser-${crypto.randomUUID()}@example.test`; emails.push(email); const link = await createLink(database, 'invite', email, null); await consumeLink(database, 'invite', link.token, password, label); const [actor] = await database.sql`select id from users where email=${email}`; return { email, id: String(actor.id) }; }
async function login(email: string, owner: string) { account = owner; await page.getByLabel('Email', { exact: true }).fill(email); await page.getByLabel('Пароль', { exact: true }).fill(password); await page.getByRole('button', { name: 'Войти', exact: true }).click(); await expect(page.getByTestId('train-lesson').first()).toBeVisible(); }
async function logout() { await page.getByLabel('Настройки и аккаунт', { exact: true }).click(); await page.getByRole('button', { name: 'Выйти', exact: true }).click(); await expect(page.getByRole('heading', { name: 'Войти', exact: true })).toBeVisible(); }
try {
  const a = await create('Ученик A'); const b = await create('Ученик B');
  await context.route('**/api/**', async route => {
    const request = route.request(); const target = new URL(request.url()); target.host = `127.0.0.1:${server.port}`;
    try {
      if (target.pathname === '/api/reviews' && request.method() === 'POST') reviewPosts.push({ owner: account, attemptId: request.postDataJSON().attemptId });
      const response = await route.fetch({ url: target.href });
      if (target.pathname === '/api/reviews' && request.method() === 'POST' && !heldReview) { heldReview = true; await reviewGate; }
      if (target.pathname === '/api/settings' && request.method() === 'PUT' && holdSettings) { heldSettings = true; await settingsGate; }
      if (target.pathname === '/api/settings' && request.method() === 'GET' && holdRefresh && account === 'B') await refreshGate;
      await route.fulfill({ response });
    } catch { throw new Error(`Owner fixture transport failed: ${request.method()} ${target.pathname}`); }
  });
  await page.goto(base); await login(a.email, 'A'); const lesson = course.lessons.find(lesson => lesson.number === 4)!;
  const queueResponse = await context.request.get(`${api}/api/training?lessonId=${lesson.id}`); expect(queueResponse.status()).toBe(200); const queue: ReviewQueue = await queueResponse.json(); const words = queue.items.filter(item => item.mode !== 'grammar').slice(0, 2); expect(words).toHaveLength(2);
  const pending: ReviewSubmission[] = words.map(item => ({ attemptId: crypto.randomUUID(), reviewId: item.id, version: item.version, mode: item.mode, rating: 3 }));
  await page.evaluate(({ userId, pending }) => { localStorage.setItem(`japanese-pending-reviews:${userId}`, JSON.stringify(pending)); window.dispatchEvent(new Event('online')); }, { userId: a.id, pending });
  await expect.poll(() => heldReview).toBe(true); await logout(); await login(b.email, 'B'); releaseReview?.(); await page.waitForTimeout(250);
  const stored = await page.evaluate(({ a, b }) => ({ a: JSON.parse(localStorage.getItem(`japanese-pending-reviews:${a}`) ?? '[]'), b: JSON.parse(localStorage.getItem(`japanese-pending-reviews:${b}`) ?? '[]') }), { a: a.id, b: b.id });
  const replay = { posts: reviewPosts, secondAttemptRetainedForA: stored.a.some((item: ReviewSubmission) => item.attemptId === pending[1]!.attemptId), bOutbox: stored.b.length, crossedOwner: reviewPosts.some(post => post.owner === 'B') };
  // Remove only this disposable learner's remaining fixture outbox before the next independent race.
  await page.evaluate(id => localStorage.removeItem(`japanese-pending-reviews:${id}`), a.id);
  await logout(); await login(a.email, 'A'); holdSettings = true; await page.getByRole('button', { name: 'Звуки сцены', exact: true }).click(); await expect.poll(() => heldSettings).toBe(true);
  await logout(); await login(b.email, 'B'); const toggle = page.getByRole('button', { name: 'Звуки сцены', exact: true }); const enabledAtBLogin = await toggle.isEnabled(); const pressedAtBLogin = await toggle.getAttribute('aria-pressed');
  await page.evaluate(() => { const states: string[] = []; Reflect.set(window, 'qaOwnerSoundStates', states); const toggle = document.querySelector('[aria-label="Звуки сцены"]')!; new MutationObserver(() => states.push(toggle.getAttribute('aria-pressed') ?? '')).observe(toggle, { attributes: true, attributeFilter: ['aria-pressed'] }); });
  holdRefresh = true; releaseSettings?.(); await page.waitForTimeout(250); const transientSoundStates: string[] = await page.evaluate(() => Reflect.get(window, 'qaOwnerSoundStates')); const settings = { enabledAtBLogin, pressedAtBLogin, pressedAfterStaleAResponse: await toggle.getAttribute('aria-pressed'), transientSoundStates };
  releaseRefresh?.(); const green = !replay.crossedOwner && replay.secondAttemptRetainedForA && replay.bOutbox === 0 && settings.enabledAtBLogin && settings.pressedAtBLogin === 'true' && settings.pressedAfterStaleAResponse === 'true' && !transientSoundStates.includes('false');
  const report = { green, replay, settings, errors, isolatedFixtures: true, humanAccountUsed: false }; await Bun.write(`${output}/learning-owner-${green ? 'green' : 'red'}-2026-10-21.json`, JSON.stringify(report, null, 2)); console.info(JSON.stringify(report, null, 2)); expect(errors).toEqual([]); expect(green).toBe(true);
} finally {
  releaseReview?.(); releaseSettings?.(); releaseRefresh?.(); await context.unrouteAll({ behavior: 'ignoreErrors' }); await context.close(); await browser.close(); server.stop(true); for (const email of emails) { await database.sql`delete from access_links where email=${email}`; await database.sql`delete from users where email=${email}`; } await database.sql.close();
}
