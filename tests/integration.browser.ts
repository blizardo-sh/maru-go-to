import { chromium, expect, type BrowserContext, type Locator, type Page } from '@playwright/test';
import { createApp } from '../src/server/app';
import { connectDatabase } from '../src/server/db';
import { createLink, consumeLink } from '../src/server/auth';
import { loadCourse } from '../src/server/course';
import { defaultSettings, validSegments } from '../src/server/material';
import { nextFixtureIp } from './helpers/fixture-ip';
import { output } from './helpers/artifact-output';
import { seedAcceptedHistory, openRepeat } from './helpers/introduced-browser-fixture';
import type { LearnerSettings, Progress, ReviewItem, ReviewQueue, ReviewSubmission } from '../src/shared/types';

const databaseUrl = process.env.JAPANESE_INTEGRATION_DATABASE_URL;
if (!databaseUrl || new URL(databaseUrl).hostname !== '127.0.0.1' || new URL(databaseUrl).pathname !== '/japanese_app_test') throw new Error('Use only disposable localhost japanese_app_test.');
const base = 'http://127.0.0.1:5173';
const outboxOnly = process.env.BROWSER_OUTBOX_ONLY === 'true';
const database = connectDatabase(databaseUrl);
const course = loadCourse();
// Exercise unavailable UI through a local 429 provider; never read preview credentials or spend its quota.
const quotaProvider = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: () => new Response('Fixture provider quota', { status: 429 }) });
const app = createApp({ database, course, config: { DATABASE_URL: databaseUrl, BETTER_AUTH_SECRET: 'mixed-browser-isolated-fixture-secret-more-than-32-characters', APP_URL: base, PORT: 3000, HOST: '127.0.0.1', ANALYSIS_PROVIDER: 'generic', ANALYSIS_URL: `http://127.0.0.1:${quotaProvider.port}/chat/completions`, ANALYSIS_MODEL: 'isolated-quota-fixture', ANALYSIS_FREE_ONLY: 'true' } });
const server = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: app.fetch });
const apiBase = `http://127.0.0.1:${server.port}`;
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const fixtures: string[] = [];
const checks: object[] = [];
let activePage: Page | undefined;
let releaseHeld: (() => void) | undefined;

async function swipe(page: Page, element: Locator, direction: -1 | 1, touch: boolean) {
  await element.scrollIntoViewIfNeeded();
  const box = await element.boundingBox();
  if (!box) throw new Error('Card surface is not visible');
  const x = box.x + box.width / 2;
  const y = box.y + Math.min(box.height / 2, 90);
  const distance = Math.min(140, box.width / 2 - 20) * direction;
  if (touch) {
    const cdp = await page.context().newCDPSession(page);
    try {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
      for (let step = 1; step <= 5; step++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x + distance * step / 5, y }] });
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    } finally { await cdp.detach(); }
  } else {
    await page.mouse.move(x, y); await page.mouse.down();
    await page.mouse.move(x + distance, y, { steps: 8 }); await page.mouse.up();
  }
}

async function getProgress(context: BrowserContext): Promise<Progress> {
  const response = await context.request.get(`${apiBase}/api/progress`);
  expect(response.status()).toBe(200);
  return response.json();
}

try {
  for (const touch of outboxOnly ? [false] : process.env.BROWSER_TOUCH_ONLY === 'true' ? [true] : [false, true]) {
    const viewport = touch ? { width: 390, height: 844 } : { width: 1280, height: 900 };
    const email = `mixed-browser-${crypto.randomUUID()}@example.test`;
    fixtures.push(email);
    const password = 'Isolated-mixed-browser-password!';
    const link = await createLink(database, 'invite', email, null);
    await consumeLink(database, 'invite', link.token, password, 'Проверка занятия');
  await seedAcceptedHistory(database, course, email, course.words.filter(word => word.reviewStatus !== 'draft' && validSegments(word) && !!word.audioUrl).map(word => word.id), ['marugoto.starter-a1.skill.ga_ability', 'marugoto.starter-a1.skill.frequency', 'marugoto.starter-a1.skill.sorekara_sequence']);
    const context = await browser.newContext({ viewport, hasTouch: touch, isMobile: touch, reducedMotion: 'reduce', extraHTTPHeaders: { 'x-forwarded-for': nextFixtureIp() } });
    const presented = new Map<string, ReviewItem>();
    const submissions: ReviewSubmission[] = [];
    let loseFirstAck = true;
    let courseGets = 0;
    const emptyBootCourseFetches: number[] = [];
    let heldText: string | undefined;
    let held = false;
    const heldGate = new Promise<void>(resolve => { releaseHeld = resolve; });
    await context.route('**/api/**', async route => {
      const request = route.request();
      const target = new URL(request.url()); target.host = `127.0.0.1:${server.port}`;
      const path = target.pathname;
      if (path === '/api/course' && request.method() === 'GET') courseGets++;
      if (path === '/api/reviews' && request.method() === 'POST') submissions.push(request.postDataJSON());
      const response = await route.fetch({ url: target.href });
      if (path === '/api/reviews' && request.method() === 'GET' && target.searchParams.get('mode') === 'mixed') {
        const queue: ReviewQueue = await response.json();
        for (const item of queue.items) presented.set(item.id, item);
      }
      if (path === '/api/reviews' && request.method() === 'POST' && loseFirstAck) {
        loseFirstAck = false;
        expect(response.status()).toBe(200);
        await route.abort('failed'); return;
      }
      if (path === '/api/analyze' && heldText && !held && request.postDataJSON().text === heldText) {
        held = true; await heldGate;
      }
      try { await route.fulfill({ response }); } catch { if (!held) throw new Error('Unexpected intercepted transport failure'); }
    });
    await context.addInitScript(() => {
      Reflect.set(window, 'qaMicrophoneRequests', 0);
      Reflect.set(window, 'qaAudioPlaying', 0);
      const OriginalAudio = Audio;
      Reflect.set(window, 'Audio', new Proxy(OriginalAudio, { construct(Target, args) {
        const audio = Reflect.construct(Target, args);
        audio.addEventListener('playing', () => Reflect.set(window, 'qaAudioPlaying', Reflect.get(window, 'qaAudioPlaying') + 1));
        return audio;
      } }));
      if (navigator.mediaDevices) Object.defineProperty(navigator.mediaDevices, 'getUserMedia', { value: () => {
        Reflect.set(window, 'qaMicrophoneRequests', Reflect.get(window, 'qaMicrophoneRequests') + 1);
        return Promise.reject(new Error('No microphone in study-session QA'));
      } });
    });
    const page = await context.newPage(); activePage = page;
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(base);
    await page.getByLabel('Email', { exact: true }).fill(email);
    await page.getByLabel('Пароль', { exact: true }).fill(password);
    await page.getByRole('button', { name: 'Войти', exact: true }).click();
    await expect(page.getByRole('navigation', { name: 'Разделы' }).getByRole('button', { name: 'Повторение', exact: true })).toBeVisible();
    if (outboxOnly) {
      await expect(page.getByTestId('train-lesson').first()).toBeVisible();
      expect(courseGets, 'An empty outbox must not duplicate the login course fetch.').toBe(1);
      emptyBootCourseFetches.push(courseGets);
    }
    const settings: LearnerSettings = {
      ...structuredClone(defaultSettings),
      lessonStatuses: Object.fromEntries(course.lessons.map(lesson => [lesson.id, 'studying'])),
      focusSkillIds: ['marugoto.starter-a1.skill.frequency', 'marugoto.starter-a1.skill.sorekara_sequence'],
      newWordsPerDay: 3, newSkillsPerDay: 2,
    };
    const saved = await context.request.put(`${apiBase}/api/settings`, { headers: { origin: base }, data: settings });
    expect(saved.status()).toBe(200);
    courseGets = 0;
    await page.reload();
    await expect(page.getByTestId('train-lesson')).toHaveCount(18);
    if (outboxOnly) {
      expect(courseGets, 'An empty outbox must not duplicate the reload course fetch.').toBe(1);
      emptyBootCourseFetches.push(courseGets);
    }
    expect(await page.getByRole('button', { name: 'Свободный разбор', exact: true }).count()).toBe(0);
    await openRepeat(page);
    const gesture = page.getByTestId('review-gesture');
    const seen = new Set<string>();
    let words = 0; let grammars = 0;
    for (let step = 0; step < 16 && (seen.size < 4 || grammars < 2); step++) {
      await expect(gesture).toBeVisible();
      const id = await gesture.getAttribute('data-review-id');
      const item = presented.get(id!);
      if (!item) throw new Error('Displayed task was not issued by mixed API');
      seen.add(item.mode);
      const commitsBefore = submissions.length;
      if (item.mode !== 'grammar') {
        const face = page.getByTestId('card-face');
        expect(await face.evaluate(element => element instanceof HTMLButtonElement)).toBe(true);
        expect(await face.locator('.answer').count()).toBe(0);
        await gesture.focus(); await page.keyboard.press('ArrowRight');
        expect(submissions).toHaveLength(commitsBefore);
        if (item.mode === 'listening') {
          const hidden = await gesture.ariaSnapshot();
          expect(hidden).not.toContain(item.word.surface);
          expect(hidden).not.toContain(item.word.meaningRu);
          expect(await gesture.locator('[lang="ja"]').count()).toBe(0);
          await expect.poll(async () => page.evaluate(() => Reflect.get(window, 'qaAudioPlaying'))).toBeGreaterThan(0);
          const previousPlays = await page.evaluate(() => Reflect.get(window, 'qaAudioPlaying'));
          await expect(page.getByRole('button', { name: 'Прослушать ещё раз', exact: true })).toBeEnabled();
          await page.getByRole('button', { name: 'Прослушать ещё раз', exact: true }).click();
          await expect.poll(async () => page.evaluate(() => Reflect.get(window, 'qaAudioPlaying'))).toBeGreaterThan(previousPlays);
          await face.click();
          await expect(face.locator('.answer')).toContainText(item.word.meaningRu);
          await expect(face.locator('.answer [lang="ja"]')).toBeVisible();
          await page.screenshot({ path: `${output}/qa-session-${viewport.width}-listening.png`, fullPage: true });
        } else {
          if (item.mode === 'ru-ja') expect(await face.locator('[lang="ja"]').count()).toBe(0);
          if (touch) await face.tap(); else { await (words === 0 ? gesture : face).focus(); await page.keyboard.press('Enter'); }
          await expect(face.locator('.answer')).toBeVisible();
        }
        for (const oldName of ['Снова', 'Трудно', 'Хорошо', 'Легко']) expect(await page.getByRole('button', { name: oldName, exact: true }).count()).toBe(0);
        const direction: -1 | 1 = words === 1 ? -1 : 1;
        if (touch || words === 1) await swipe(page, face, direction, touch);
        else { await gesture.focus(); await page.keyboard.press(direction > 0 ? 'ArrowRight' : 'ArrowLeft'); }
        if (commitsBefore === 0) {
          await expect(page.getByRole('button', { name: 'Повторить сохранение', exact: true })).toBeVisible();
          expect(await gesture.getAttribute('data-review-id')).toBe(id);
          expect(submissions).toHaveLength(1);
          await gesture.focus(); await page.keyboard.press('ArrowRight');
          expect(submissions).toHaveLength(1);
          await page.getByRole('button', { name: 'Повторить сохранение', exact: true }).click();
          await expect.poll(() => submissions.length).toBe(2);
          expect(submissions[1]).toEqual(submissions[0]);
        }
        await expect(gesture).not.toHaveAttribute('data-review-id', id!);
        expect(submissions.at(-1)?.mode).toBe(item.mode);
        expect(submissions.at(-1)).toMatchObject({ rating: direction > 0 ? 3 : 1 });
        words++;
        if (outboxOnly) {
          expect((await getProgress(context)).byMode['ja-ru'].reviewedToday).toBe(1);
          break;
        }
        continue;
      }

      grammars++;
      const grammarBefore = (await getProgress(context)).byMode.grammar.reviewedToday;
      const order = item.exercise.acceptedOrders[0]!;
      const tokenArea = page.getByRole('group', { name: 'Ваше предложение', exact: true });
      const bank = page.getByRole('group', { name: 'Доступные элементы', exact: true });
      if (grammars === 2) {
        const tokens = new Map(item.exercise.tokens.map(token => [token.id, token]));
        const forms = new Map(course.forms.map(form => [form.id, form]));
        heldText = order.map(tokenId => forms.get(tokens.get(tokenId)!.formId)!.surface).join('') + item.exercise.sentenceEnd;
      }
      const buildOrder = grammars === 1 ? [...order].reverse() : order;
      await bank.locator(`[data-token-id="${buildOrder[0]}"]`).click();
      await expect(page.locator('[data-outcome="incomplete"]')).toBeVisible();
      expect(submissions).toHaveLength(commitsBefore);
      for (const tokenId of buildOrder.slice(1)) {
        const button = bank.locator(`[data-token-id="${tokenId}"]`);
        await button.focus(); await page.keyboard.press('Enter');
      }
      const selected = tokenArea.locator('[data-token-id]');
      await expect(selected).toHaveCount(order.length);
      if (grammars === 1) {
        await expect(page.locator('[data-outcome="incorrect"]')).toBeVisible();
        if (!touch && order.length > 2) {
          const beforeDrag = await selected.evaluateAll(elements => elements.map(element => element.getAttribute('data-token-id')));
          await selected.first().dragTo(selected.last());
          expect(await selected.evaluateAll(elements => elements.map(element => element.getAttribute('data-token-id')))).not.toEqual(beforeDrag);
          expect(submissions).toHaveLength(commitsBefore);
        }
        for (let position = 0; position < order.length; position++) {
          const token = tokenArea.locator(`[data-token-id="${order[position]}"]`);
          let current = (await selected.evaluateAll(elements => elements.map(element => element.getAttribute('data-token-id')))).indexOf(order[position]!);
          while (current > position) { await token.focus(); await page.keyboard.press('ArrowLeft'); current--; }
        }
        await expect(page.locator('[data-outcome="correct"]')).toBeVisible();
        expect(submissions).toHaveLength(commitsBefore);
        expect((await getProgress(context)).byMode.grammar.reviewedToday).toBe(grammarBefore);
        const tokenIds = await selected.evaluateAll(elements => elements.map(element => element.getAttribute('data-token-id')));
        await page.getByLabel('Действия карточки', { exact: true }).click();
        await page.getByRole('combobox', { name: 'Японское написание', exact: true }).selectOption('kana');
        await expect(selected).toHaveCount(order.length);
        expect(await selected.evaluateAll(elements => elements.map(element => element.getAttribute('data-token-id')))).toEqual(tokenIds);
        await page.getByLabel('Действия карточки', { exact: true }).click();
        await page.screenshot({ path: `${output}/qa-session-${viewport.width}-construction.png`, fullPage: true });
        await gesture.focus(); await page.keyboard.press('ArrowRight');
        await expect(gesture).not.toHaveAttribute('data-review-id', id!);
        expect(submissions).toHaveLength(commitsBefore + 1);
        expect(submissions.at(-1)).toMatchObject({ mode: 'grammar', revealed: false, rating: 3 });
        expect((await getProgress(context)).byMode.grammar.reviewedToday).toBe(grammarBefore + 1);
      } else {
        await expect.poll(() => held).toBe(true);
        const formToken = item.exercise.tokens.find(token => {
          const originalForm = course.forms.find(form => form.id === token.formId)!;
          return course.forms.some(form => form.wordId === originalForm.wordId && form.id !== originalForm.id);
        })!;
        expect(formToken).toBeDefined();
        const originalForm = course.forms.find(form => form.id === formToken.formId)!;
        const alternate = course.forms.find(form => form.wordId === originalForm.wordId && form.id !== originalForm.id)!;
        await tokenArea.locator(`[data-token-id="${formToken.id}"]`).click();
        const dialog = page.getByRole('dialog', { name: 'Изменить элемент', exact: true });
        await dialog.getByRole('combobox', { name: 'Форма элемента', exact: true }).selectOption(alternate.id);
        const search = dialog.getByRole('textbox', { name: 'Заменить словом или частицей', exact: true });
        await search.fill('は'); await search.press('ArrowLeft'); await search.press('ArrowRight'); await search.press('Enter');
        expect(submissions).toHaveLength(commitsBefore);
        expect(await gesture.getAttribute('data-review-id')).toBe(id);
        const particle = course.words.find(word => word.pos === 'particle' && word.surface === 'を')!;
        await search.fill(particle.kana);
        await dialog.locator(`[data-word-id="${particle.id}"]`).click();
        await expect(page.locator('[data-outcome="exploration"]')).toBeVisible();
        await page.getByRole('button', { name: 'Добавить элемент', exact: true }).click();
        const add = page.getByRole('dialog', { name: 'Добавить элемент', exact: true });
        const word = course.words.find(candidate => candidate.kana === 'がっこう')!;
        expect(word).toBeDefined();
        await add.getByRole('textbox', { name: 'Найти слово или частицу', exact: true }).fill(word.kana);
        await add.locator(`[data-word-id="${word.id}"]`).click();
        await expect(page.getByRole('heading', { name: 'Свободный разбор недоступен', exact: true })).toBeVisible();
        await expect(page.getByText('Бесплатный сервис временно ограничил запросы. Попробуйте позже.', { exact: true })).toBeVisible();
        releaseHeld?.();
        await expect(page.getByRole('heading', { name: 'Свободный разбор недоступен', exact: true })).toBeVisible();
        expect(await page.locator('.analysis').count()).toBe(0);
        await selected.last().focus(); await page.keyboard.press('Delete');
        await expect(selected).toHaveCount(order.length);
        await expect(page.locator('[data-outcome="exploration"]')).toBeVisible();
        await expect(page.locator('.analysis-state')).toContainText('Исследование:');
        await page.screenshot({ path: `${output}/qa-session-${viewport.width}-inline.png`, fullPage: true });
        expect(submissions).toHaveLength(commitsBefore);
        expect((await getProgress(context)).byMode.grammar.reviewedToday).toBe(grammarBefore);
        await gesture.focus(); await page.keyboard.press('ArrowRight');
        await expect(gesture).not.toHaveAttribute('data-review-id', id!);
        expect(submissions).toHaveLength(commitsBefore);
        expect((await getProgress(context)).byMode.grammar.reviewedToday).toBe(grammarBefore);
      }
    }
    if (!outboxOnly) {
      expect(seen).toEqual(new Set(['ja-ru', 'ru-ja', 'listening', 'grammar']));
      expect(grammars).toBe(2);
    }
    expect(await page.evaluate(() => Reflect.get(window, 'qaMicrophoneRequests'))).toBe(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
    expect(errors).toEqual([]);
    checks.push(outboxOnly
      ? { viewport, emptyBootCourseFetches, lostAckSameAttemptRetry: true, scheduledReviews: 1, pageErrors: errors.length }
      : { viewport, touch, modes: [...seen], keyboardAndPointer: true, audioPlayed: true, noMicrophone: true, lostAckSameAttemptRetry: true, finalCommitOnlyAtAdvance: true, explorationUngraded: true, staleAnalysisIgnored: true, pageErrors: errors.length });
    releaseHeld?.(); await context.close();
  }
  console.info(JSON.stringify({ browser: browser.version(), checks }, null, 2));
} catch (error) {
  releaseHeld?.();
  if (activePage && !activePage.isClosed()) {
    await activePage.screenshot({ path: `${output}/qa-session-failure.png`, fullPage: true });
    console.info(await activePage.locator('#main').ariaSnapshot());
  }
  throw error;
} finally {
  await browser.close(); server.stop(true); quotaProvider.stop(true);
  for (const email of fixtures) {
    await database.sql`delete from access_links where email=${email}`;
    await database.sql`delete from users where email=${email}`;
  }
  await database.sql.close();
}
