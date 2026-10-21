import { chromium, expect, type BrowserContext, type Locator, type Page } from '@playwright/test';
import { createApp } from '../src/server/app';
import { createLink, consumeLink } from '../src/server/auth';
import { connectDatabase } from '../src/server/db';
import { loadCourse } from '../src/server/course';
import { defaultSettings, validSegments } from '../src/server/material';
import { nextFixtureIp } from './helpers/fixture-ip';
import { output } from './helpers/artifact-output';
import { seedAcceptedHistory, openRepeat } from './helpers/introduced-browser-fixture';
import type { Progress, ReviewItem, ReviewQueue, ReviewSubmission } from '../src/shared/types';

const databaseUrl = process.env.JAPANESE_INTEGRATION_DATABASE_URL;
if (!databaseUrl || new URL(databaseUrl).hostname !== '127.0.0.1' || new URL(databaseUrl).pathname !== '/japanese_app_test') throw new Error('Use only disposable localhost japanese_app_test.');
const base = 'http://127.0.0.1:5173';
const database = connectDatabase(databaseUrl);
const course = loadCourse();
// No preview env or external inference: unavailable analysis uses a local HTTP429 fixture.
const unavailableText = 'わたしはがっこうをです。';
const provider = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: async request => {
  const body = await request.json(); const input = JSON.parse(body.messages.at(-1).content);
  if (input.text === unavailableText) return new Response('Fixture provider limit', { status: 429 });
  return Response.json({ choices: [{ message: { content: JSON.stringify({ translationRu: 'Локальная тестовая фраза.', grammar: 'incorrect', naturalness: 'awkward', explanationRu: 'Локальный структурированный mock: проверяется отображение обратной связи, а не качество языка.', warnings: [] }) } }] });
} });
const app = createApp({ database, course, config: { DATABASE_URL: databaseUrl, BETTER_AUTH_SECRET: 'progress-feedback-isolated-fixture-secret-more-than32', APP_URL: base, PORT: 3000, HOST: '127.0.0.1', ANALYSIS_PROVIDER: 'generic', ANALYSIS_URL: `http://127.0.0.1:${provider.port}/chat/completions`, ANALYSIS_MODEL: 'isolated-feedback-fixture', ANALYSIS_FREE_ONLY: 'true' } });
const server = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: app.fetch });
const apiBase = `http://127.0.0.1:${server.port}`;
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const emails: string[] = [];
const results: object[] = [];
let releaseRetry: (() => void) | undefined;
let releaseEvaluation: (() => void) | undefined;
let expectedScene = '';
const sceneIds = ['room', 'garden', 'mountains', 'river', 'tokyo'];

async function progressState(context: BrowserContext): Promise<Progress> {
  const response = await context.request.get(`${apiBase}/api/progress`);
  expect(response.status()).toBe(200); return response.json();
}
async function checkProgress(page: Page, count: number) {
  const progress = page.getByRole('progressbar', { name: 'Прогресс занятия', exact: true });
  await expect(progress).toBeVisible();
  expect(await progress.evaluate(element => element instanceof HTMLProgressElement ? { value: element.value, max: element.max } : null)).toEqual({ value: count, max: 5 });
  await expect(progress).toHaveAttribute('aria-valuetext', `Пройдено ${count} из 5 заданий (${count * 20}%)`);
  if (expectedScene) {
    await expect(page.getByTestId('study-session')).toHaveAttribute('data-scene-id', expectedScene);
    await expect(page.locator('.game-shell')).toHaveAttribute('data-scene', expectedScene);
  }
}
async function catActivity(page: Page, activity: string, pose?: string) {
  const companion = page.getByTestId('scene-companion');
  await expect(companion).toHaveAttribute('data-activity', activity);
  if (pose) await expect(companion.locator('[data-pose]')).toHaveAttribute('data-pose', pose);
}
async function settingsMenu(page: Page) {
  const summary = page.getByLabel('Настройки и аккаунт', { exact: true });
  if (!(await summary.evaluate(element => !!element.closest('details')?.open))) await summary.click();
}
async function feedbackMotion(marker: Locator, touch: boolean, outcome: 'good' | 'again' | 'neutral') {
  const animation = await marker.evaluate(element => ({ name: getComputedStyle(element).animationName, duration: getComputedStyle(element).animationDuration }));
  expect(animation.name).toBe(touch || outcome === 'neutral' ? 'none' : `feedback-${outcome}`);
  if (!touch && outcome !== 'neutral') expect(animation.duration).toBe('0.22s');
}
async function cardAdvance(page: Page, touch: boolean, direction: -1 | 1) {
  if (!touch) { await page.getByTestId('review-gesture').focus(); await page.keyboard.press(direction > 0 ? 'ArrowRight' : 'ArrowLeft'); return; }
  const card = page.getByTestId('card-face');
  await card.scrollIntoViewIfNeeded(); const box = await card.boundingBox();
  if (!box) throw new Error('No visible card');
  const x = box.x + box.width / 2; const y = box.y + Math.min(box.height / 2, 80);
  const cdp = await page.context().newCDPSession(page);
  try {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
    for (let step = 1; step <= 5; step++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x + direction * step * 22, y }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  } finally { await cdp.detach(); }
}
try {
  for (const touch of process.env.BROWSER_TOUCH_ONLY === 'true' ? [true] : [false, true]) {
    const viewport = touch ? { width: 390, height: 844 } : { width: 1280, height: 900 };
    const email = `progress-feedback-${crypto.randomUUID()}@example.test`;
    const password = 'Progress-feedback-isolated-password!'; emails.push(email);
    const link = await createLink(database, 'invite', email, null);
    await consumeLink(database, 'invite', link.token, password, 'Проверка прогресса');
  await seedAcceptedHistory(database, course, email, course.words.filter(word => word.reviewStatus !== 'draft' && validSegments(word) && !!word.audioUrl).map(word => word.id), ['marugoto.starter-a1.skill.ga_ability', 'marugoto.starter-a1.skill.frequency', 'marugoto.starter-a1.skill.sorekara_sequence']);
    const context = await browser.newContext({ viewport, isMobile: touch, hasTouch: touch, reducedMotion: touch ? 'reduce' : 'no-preference', extraHTTPHeaders: { 'x-forwarded-for': nextFixtureIp() } });
    await context.addInitScript(() => {
      Reflect.set(window, 'qaAudioPlays', 0); Reflect.set(window, 'qaMicrophoneRequests', 0);
      const OriginalAudio = Audio;
      Reflect.set(window, 'Audio', new Proxy(OriginalAudio, { construct(Target, args) {
        const audio = Reflect.construct(Target, args);
        // Slow a real file only in this fixture, allowing event-based navigation/pause checks.
        audio.playbackRate = 0.25; Reflect.set(window, 'qaAudio', audio);
        audio.addEventListener('playing', () => Reflect.set(window, 'qaAudioPlays', Reflect.get(window, 'qaAudioPlays') + 1));
        return audio;
      } }));
      if (navigator.mediaDevices) Object.defineProperty(navigator.mediaDevices, 'getUserMedia', { value: () => {
        Reflect.set(window, 'qaMicrophoneRequests', Reflect.get(window, 'qaMicrophoneRequests') + 1);
        return Promise.reject(new Error('No microphone in game QA'));
      } });
    });
    const submissions: ReviewSubmission[] = []; let issued: ReviewItem[] = []; let queueGets = 0;
    let evaluationHeld = false; let holdSingleEvaluation = true;
    const evaluationGate = new Promise<void>(resolve => { releaseEvaluation = resolve; });
    let loseFirstAck = true; let retryHeld = false;
    const retryGate = new Promise<void>(resolve => { releaseRetry = resolve; });
    await context.route('**/api/**', async route => {
      const request = route.request(); const url = new URL(request.url()); url.host = `127.0.0.1:${server.port}`;
      if (url.pathname === '/api/reviews' && request.method() === 'POST') submissions.push(request.postDataJSON());
      const response = await route.fetch({ url: url.href });
      if (url.pathname === '/api/reviews' && request.method() === 'GET') {
        const queue: ReviewQueue = await response.json();
        queueGets++;
        if (queueGets > 1) { await route.fulfill({ response }); return; }
        const first = queue.items.find(item => item.mode === 'listening'); const second = queue.items.find(item => item.mode === 'ja-ru');
        const grammar = queue.items.filter(item => item.mode === 'grammar');
        if (!first || !second || grammar.length < 3) throw new Error('Fixture requires two issued word directions and three grammar skills.');
        // Reorder/filter actual server-issued tasks; no fake versions, IDs, or answers.
        issued = [first, second, ...grammar.slice(0, 3)];
        await route.fulfill({ response, body: JSON.stringify({ ...queue, items: issued }) }); return;
      }
      if (url.pathname === '/api/reviews/evaluate' && holdSingleEvaluation && request.postDataJSON().tokenIds.length === 1) {
        holdSingleEvaluation = false; evaluationHeld = true; await evaluationGate;
      }
      if (url.pathname === '/api/reviews' && request.method() === 'POST') {
        expect(response.status()).toBe(200);
        if (loseFirstAck) { loseFirstAck = false; await route.abort('failed'); return; }
        if (submissions.length === 2) { retryHeld = true; await retryGate; }
      }
      await route.fulfill({ response });
    });
    const page = await context.newPage(); const pageErrors: string[] = []; const sceneRequests: string[] = [];
    page.on('request', request => { const url = new URL(request.url()); if (url.pathname.startsWith('/scenes/') && url.pathname.endsWith('.webp')) sceneRequests.push(url.pathname); });
    page.on('pageerror', error => pageErrors.push(error.message));
    try {
      await page.goto(base); await page.getByLabel('Email', { exact: true }).fill(email); await page.getByLabel('Пароль', { exact: true }).fill(password);
      await page.getByRole('button', { name: 'Войти', exact: true }).click();
      await expect(page.getByRole('navigation', { name: 'Разделы' })).toBeVisible();
      expect((await context.request.put(`${apiBase}/api/settings`, { headers: { origin: base }, data: { ...structuredClone(defaultSettings), lessonStatuses: Object.fromEntries(course.lessons.map(lesson => [lesson.id, 'studying'])), focusSkillIds: ['marugoto.starter-a1.skill.ga_ability', 'marugoto.starter-a1.skill.frequency', 'marugoto.starter-a1.skill.sorekara_sequence'], newWordsPerDay: 1, newSkillsPerDay: 3 } })).status()).toBe(200);
      await page.reload(); await openRepeat(page);
      const gesture = page.getByTestId('review-gesture'); await expect(gesture).toBeVisible();
      const session = page.getByTestId('study-session'); expectedScene = await session.getAttribute('data-scene-id') ?? '';
      expect(sceneIds).toContain(expectedScene); await checkProgress(page, 0);
      await expect.poll(() => sceneRequests.some(path => path.includes(`/${expectedScene}-`))).toBe(true);
      const initiallyRequestedScenes = new Set(sceneRequests.map(path => path.replace('/scenes/', '').split('-')[0]));
      expect(initiallyRequestedScenes.size).toBeLessThanOrEqual(2); // Default view plus selected scene; QA decodes the rest later.
      await expect.poll(() => page.evaluate(() => Reflect.get(window, 'qaAudioPlays'))).toBeGreaterThan(0);
      await catActivity(page, 'listening', 'thinking');
      const listening = issued[0]; if (listening?.mode !== 'listening') throw new Error('Expected actual listening card');
      expect(await session.ariaSnapshot()).not.toContain(listening.word.surface);
      expect(await session.ariaSnapshot()).not.toContain(listening.word.meaningRu);
      expect(await session.locator('[lang="ja"]').count()).toBe(0);
      const nav = page.getByRole('navigation', { name: 'Разделы' });
      expect(await nav.getByRole('button', { name: 'Учебник', exact: true }).evaluate(element => element instanceof HTMLButtonElement)).toBe(true);
      await nav.getByRole('button', { name: 'Учебник', exact: true }).click();
      await expect(session).toHaveAttribute('data-active', 'false'); await expect(session).not.toBeVisible();
      await expect.poll(() => page.evaluate(() => { const audio = Reflect.get(window, 'qaAudio'); return audio instanceof HTMLMediaElement && audio.paused; })).toBe(true);
      const decoded = await page.evaluate(async () => {
        const manifest: { scenes: { id: string; desktop: { src: string }; mobile: { src: string } }[] } = await (await fetch('/scenes/manifest.json')).json();
        return Promise.all(manifest.scenes.map(async (scene: { id: string; desktop: { src: string }; mobile: { src: string } }) => {
          const sizes = await Promise.all([scene.desktop.src, scene.mobile.src].map(async src => { const image = new Image(); image.src = src; await image.decode(); return [image.naturalWidth, image.naturalHeight]; }));
          return { id: scene.id, sizes };
        }));
      });
      expect(decoded.map(item => item.id).sort()).toEqual([...sceneIds].sort());
      expect(decoded.every(item => item.sizes[0]?.[0] === 1600 && item.sizes[0]?.[1] === 900 && item.sizes[1]?.[0] === 540 && item.sizes[1]?.[1] === 960)).toBe(true);
      await page.keyboard.press('ArrowRight'); expect(submissions).toHaveLength(0); expect(queueGets).toBe(1);
      await nav.getByRole('button', { name: 'Повторение', exact: true }).click();
      await expect(session).toHaveAttribute('data-active', 'true'); await expect(gesture).toHaveAttribute('data-review-id', listening.id);
      await checkProgress(page, 0); expect(queueGets).toBe(1);
      await expect(page.getByRole('button', { name: 'Прослушать ещё раз', exact: true })).toBeEnabled();
      const plays = await page.evaluate(() => Reflect.get(window, 'qaAudioPlays'));
      await page.getByRole('button', { name: 'Прослушать ещё раз', exact: true }).click();
      await expect.poll(() => page.evaluate(() => Reflect.get(window, 'qaAudioPlays'))).toBeGreaterThan(plays);
      await catActivity(page, 'listening', 'thinking');
      await expect(page.getByRole('button', { name: 'Прослушать ещё раз', exact: true })).toBeEnabled();
      expect(issued).toHaveLength(5);
      if (!touch) {
        await page.setViewportSize({ width: 320, height: 844 });
        expect(await page.locator('.session-progress').evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
        expect(await gesture.evaluate(element => element.getBoundingClientRect().width / innerWidth)).toBeGreaterThanOrEqual(0.88);
        await page.setViewportSize(viewport);
      }
      const initialLayout = await page.locator('.session-progress').evaluate(element => ({ height: element.getBoundingClientRect().height, cardTop: document.querySelector('[data-testid="review-gesture"]')!.getBoundingClientRect().top + scrollY }));
      await gesture.focus(); await page.keyboard.press('Enter');
      await expect(page.getByTestId('card-face').locator('.answer')).toBeVisible();
      await catActivity(page, 'revealed', 'explain'); await checkProgress(page, 0); expect(submissions).toHaveLength(0);
      if (!touch) await page.setViewportSize({ width: 320, height: 844 });
      const compactLayout = await gesture.evaluate(element => {
        const box = element.getBoundingClientRect();
        const japanese = [...element.querySelectorAll('[lang="ja"]')].filter(node => node.getBoundingClientRect().height > 0);
        return { width: innerWidth, cardTop: box.top + scrollY, boardWidthRatio: box.width / innerWidth, remainingFirstViewport: Math.max(0, innerHeight - box.top - scrollY) / innerHeight, japaneseMinFont: Math.min(...japanese.map(node => parseFloat(getComputedStyle(node).fontSize))) };
      });
      expect(compactLayout.boardWidthRatio).toBeGreaterThanOrEqual(0.88); expect(compactLayout.japaneseMinFont).toBeGreaterThanOrEqual(20);
      if (!touch) await page.setViewportSize(viewport);
      await cardAdvance(page, touch, 1);
      const retry = page.getByRole('button', { name: 'Повторить сохранение', exact: true });
      await expect(retry).toBeVisible(); await checkProgress(page, 0);
      expect(await gesture.getAttribute('data-review-id')).toBe(issued[0]!.id); expect(submissions).toHaveLength(1);
      expect(await page.getByTestId('scene-companion').getAttribute('data-activity')).not.toMatch(/^saved-/);
      expect(await page.getByTestId('scene-companion').locator('[data-pose]').getAttribute('data-pose')).not.toBe('encourage');
      await expect(page.getByTestId('session-feedback')).toHaveAttribute('data-feedback', 'neutral');
      expect(await page.getByTestId('session-feedback').locator('.answer-feedback-marker').count()).toBe(0);
      await gesture.focus(); await page.keyboard.press('ArrowRight'); await checkProgress(page, 0); expect(submissions).toHaveLength(1);
      await retry.click(); await expect.poll(() => retryHeld).toBe(true); await checkProgress(page, 0);
      expect(submissions).toHaveLength(2); expect(submissions[1]).toEqual(submissions[0]); releaseRetry?.();
      await expect(gesture).toHaveAttribute('data-review-id', issued[1]!.id); await checkProgress(page, 1);
      const acknowledgedLayout = await page.locator('.session-progress').evaluate(element => ({ height: element.getBoundingClientRect().height, cardTop: document.querySelector('[data-testid="review-gesture"]')!.getBoundingClientRect().top + scrollY }));
      expect(acknowledgedLayout.height).toBeCloseTo(initialLayout.height, 1);
      expect(acknowledgedLayout.cardTop).toBeCloseTo(initialLayout.cardTop, 1);
      const feedback = page.getByTestId('session-feedback');
      await expect(feedback).toHaveAttribute('data-feedback', 'good'); await expect(feedback).toContainText('Вспомнил');
      await catActivity(page, 'saved-good', 'success');
      await expect(page.getByTestId('scene-companion')).toHaveAttribute('data-event-key', new RegExp(submissions[0]!.attemptId));
      await feedbackMotion(feedback.locator('.answer-feedback-marker'), touch, 'good');
      expect((await progressState(context)).byMode.listening.reviewedToday).toBe(1);
      const face = page.getByTestId('card-face'); if (touch) await face.tap(); else { await face.focus(); await page.keyboard.press('Space'); }
      await expect(face.locator('.answer')).toBeVisible(); await expect(feedback).toHaveAttribute('data-feedback', 'neutral'); await expect(feedback).toHaveText('');
      await checkProgress(page, 1); await cardAdvance(page, touch, -1);
      await expect(gesture).toHaveAttribute('data-review-id', issued[2]!.id); await checkProgress(page, 2);
      await expect(feedback).toHaveAttribute('data-feedback', 'again'); await expect(feedback).toContainText('Повторим');
      await catActivity(page, 'saved-again', 'encourage');
      await feedbackMotion(feedback.locator('.answer-feedback-marker'), touch, 'again');
      const grammar = issued[2]; if (grammar?.mode !== 'grammar') throw new Error('Expected grammar task');
      const order = grammar.exercise.acceptedOrders[0]!;
      const area = page.getByRole('group', { name: 'Ваше предложение', exact: true }); const bank = page.getByRole('group', { name: 'Доступные элементы', exact: true });
      const tokens = area.locator('[data-token-id]'); const draft = page.locator('.analysis-state');
      const reversed = [...order].reverse();
      await bank.locator(`[data-token-id="${reversed[0]}"]`).click();
      await expect(feedback).toHaveAttribute('data-feedback', 'neutral'); await expect(feedback).toHaveText(''); await checkProgress(page, 2);
      await expect.poll(() => evaluationHeld).toBe(true); await catActivity(page, 'checking', 'thinking');
      expect((await progressState(context)).byMode.grammar.reviewedToday).toBe(0); releaseEvaluation?.();
      for (const id of reversed.slice(1)) await bank.locator(`[data-token-id="${id}"]`).click();
      await expect(page.locator('[data-outcome="incorrect"]')).toBeVisible(); await expect(draft).toHaveAttribute('data-feedback', 'again');
      await expect(page.locator('[data-outcome="incorrect"]:visible, .analysis-state[data-feedback="again"]:visible')).toHaveCount(1);
      await feedbackMotion(draft.locator('.answer-feedback-marker'), touch, 'again'); await checkProgress(page, 2);
      expect((await progressState(context)).byMode.grammar.reviewedToday).toBe(0);
      if (!touch) {
        const from = await tokens.first().boundingBox(); const to = await tokens.last().boundingBox(); if (!from || !to) throw new Error('No drag geometry');
        await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2); await page.mouse.down();
        await page.mouse.move(to.x + to.width - 3, to.y + to.height / 2, { steps: 16 }); await page.mouse.up();
        await checkProgress(page, 2); expect(submissions).toHaveLength(3);
      }
      for (let position = 0; position < order.length; position++) {
        const token = area.locator(`[data-token-id="${order[position]}"]`);
        let current = (await tokens.evaluateAll(elements => elements.map(element => element.getAttribute('data-token-id')))).indexOf(order[position]!);
        if (touch && current > position) {
          await token.tap(); const editor = page.getByRole('dialog', { name: 'Изменить элемент', exact: true });
          while (current > position) { await editor.getByRole('button', { name: 'Левее', exact: true }).tap(); current--; }
          await editor.getByRole('button', { name: 'Закрыть редактор', exact: true }).tap();
        } else while (current > position) { await token.focus(); await page.keyboard.press('ArrowLeft'); current--; }
      }
      await expect(page.locator('[data-outcome="correct"]')).toBeVisible(); await expect(draft).toHaveAttribute('data-feedback', 'good');
      await expect(page.locator('[data-outcome="correct"]:visible, .analysis-state[data-feedback="good"]:visible')).toHaveCount(1);
      await feedbackMotion(draft.locator('.answer-feedback-marker'), touch, 'good'); await checkProgress(page, 2);
      await catActivity(page, 'draft-correct', 'explain');
      const drawer = page.locator('details.analysis-drawer');
      const analysisRegion = page.getByRole('region', { name: 'Разбор текущей фразы', exact: true });
      await analysisRegion.focus(); await page.keyboard.press('ArrowRight');
      await checkProgress(page, 2); expect(submissions).toHaveLength(3);
      const analysisViewport = await analysisRegion.evaluate(element => ({ height: element.clientHeight, scrollHeight: element.scrollHeight, maxHeight: getComputedStyle(element).maxHeight, overflow: getComputedStyle(element).overflowY, viewport: innerHeight }));
      expect(['auto', 'scroll']).toContain(analysisViewport.overflow); expect(analysisViewport.maxHeight).not.toBe('none');
      expect(analysisViewport.height).toBeLessThanOrEqual(analysisViewport.viewport * 0.6);
      if (analysisViewport.scrollHeight > analysisViewport.height + 1) {
        await page.keyboard.press('End');
        await expect.poll(() => analysisRegion.evaluate(element => element.scrollTop)).toBeGreaterThan(0);
        await page.keyboard.press('Home');
      }
      await expect.poll(() => drawer.evaluate(element => element instanceof HTMLDetailsElement && element.open)).toBe(true);
      await drawer.locator('summary').click();
      await expect.poll(() => drawer.evaluate(element => element instanceof HTMLDetailsElement && element.open)).toBe(false);
      await page.getByLabel('Действия карточки', { exact: true }).click();
      await page.getByRole('combobox', { name: 'Японское написание', exact: true }).selectOption('kana');
      await page.getByLabel('Действия карточки', { exact: true }).click();
      await expect.poll(() => drawer.evaluate(element => element instanceof HTMLDetailsElement && element.open)).toBe(false);
      await tokens.first().focus(); await page.keyboard.press('ArrowRight'); await page.keyboard.press('ArrowLeft');
      await expect(draft).toHaveAttribute('data-feedback', 'good');
      await expect.poll(() => drawer.evaluate(element => element instanceof HTMLDetailsElement && element.open)).toBe(true);
      await checkProgress(page, 2); expect(submissions).toHaveLength(3);
      const stableTokens = await tokens.evaluateAll(elements => elements.map(element => element.getAttribute('data-token-id')));
      await page.getByLabel('Действия карточки', { exact: true }).click();
      await expect(page.getByRole('button', { name: 'Доступный материал', exact: true })).toHaveCount(0);
      await page.getByLabel('Действия карточки', { exact: true }).click();
      await tokens.first().click(); const contextEditor = page.getByRole('dialog', { name: 'Изменить элемент', exact: true });
      await catActivity(page, 'editing', 'thinking'); await contextEditor.getByRole('button', { name: 'Закрыть редактор', exact: true }).click();
      await expect(draft).toHaveAttribute('data-feedback', 'good'); await checkProgress(page, 2);
      await nav.getByRole('button', { name: 'Учебник', exact: true }).click();
      await expect(session).toHaveAttribute('data-active', 'false'); await expect(session).not.toBeVisible();
      await page.keyboard.press('ArrowRight'); expect(submissions).toHaveLength(3);
      expect(await page.evaluate(() => !!document.activeElement?.closest('[data-testid="study-session"]'))).toBe(false);
      await settingsMenu(page); await page.getByRole('button', { name: 'Настройки', exact: true }).click();
      await page.getByRole('combobox', { name: 'Японское написание', exact: true }).selectOption('furigana');
      await expect(page.locator('.game-shell')).toHaveAttribute('data-scene', expectedScene);
      await nav.getByRole('button', { name: 'Повторение', exact: true }).click();
      await expect(session).toHaveAttribute('data-active', 'true'); await expect(gesture).toHaveAttribute('data-review-id', grammar.id);
      expect(await tokens.evaluateAll(elements => elements.map(element => element.getAttribute('data-token-id')))).toEqual(stableTokens);
      await checkProgress(page, 2); expect(queueGets).toBe(1);
      await expect(draft).toHaveAttribute('data-feedback', 'good'); await catActivity(page, 'draft-correct', 'explain');
      const geometry = await gesture.evaluate(element => {
        const box = element.getBoundingClientRect(); const companion = document.querySelector('.scene-companion img')?.getBoundingClientRect();
        const overlaps = (a: DOMRect, b: DOMRect) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
        const controls = [...element.querySelectorAll('button,input,select,summary')].filter(control => control.getBoundingClientRect().height > 0);
        return { widthRatio: box.width / innerWidth, controlsMinHeight: Math.min(...controls.map(control => control.getBoundingClientRect().height)), japaneseMinFont: Math.min(...[...element.querySelectorAll('[lang="ja"]')].filter(text => text.getBoundingClientRect().height > 0).map(text => parseFloat(getComputedStyle(text).fontSize))), catOverlaps: companion ? [...element.querySelectorAll('[lang="ja"],button')].some(target => overlaps(companion, target.getBoundingClientRect())) : true };
      });
      expect(geometry.widthRatio).toBeGreaterThanOrEqual(touch ? 0.88 : 0.7);
      expect(geometry.controlsMinHeight).toBeGreaterThanOrEqual(44); expect(geometry.japaneseMinFont).toBeGreaterThanOrEqual(20); expect(geometry.catOverlaps).toBe(false);
      expect(submissions).toHaveLength(3); expect((await progressState(context)).byMode.grammar.reviewedToday).toBe(0);
      await page.screenshot({ path: `${output}/qa-game-${viewport.width}.png`, fullPage: true });
      await gesture.focus(); await page.keyboard.press('ArrowRight');
      await expect(gesture).toHaveAttribute('data-review-id', issued[3]!.id); await checkProgress(page, 3);
      await expect(feedback).toHaveAttribute('data-feedback', 'neutral'); await expect(feedback).toHaveText('');
      expect(submissions).toHaveLength(4); expect(submissions[3]).toMatchObject({ mode: 'grammar', rating: 3, revealed: false });
      expect((await progressState(context)).byMode.grammar.reviewedToday).toBe(1);
      await catActivity(page, 'saved-good', 'success');
      await expect(page.getByTestId('scene-companion')).toHaveAttribute('data-event-key', new RegExp(submissions[3]!.attemptId));
      await page.getByLabel('Действия карточки', { exact: true }).click(); await page.getByRole('button', { name: 'Ввести фразу', exact: true }).click();
      const manual = page.getByRole('dialog', { name: 'Ввести фразу', exact: true });
      await manual.getByRole('textbox', { name: 'Ваша фраза', exact: true }).fill(unavailableText);
      await manual.getByRole('button', { name: 'Закрыть редактор', exact: true }).click();
      await expect(page.locator('[data-outcome="exploration"]')).toBeVisible(); await expect(draft).toHaveAttribute('data-feedback', 'neutral');
      await expect(page.getByRole('heading', { name: 'Свободный разбор недоступен', exact: true })).toBeVisible();
      await expect(page.getByText('Бесплатный сервис временно ограничил запросы. Попробуйте позже.', { exact: true })).toBeVisible();
      await catActivity(page, 'neutral', 'neutral');
      await feedbackMotion(draft.locator('.answer-feedback-marker'), touch, 'neutral'); await checkProgress(page, 3); expect(submissions).toHaveLength(4);
      await gesture.focus(); await page.keyboard.press('ArrowRight');
      await expect(gesture).toHaveAttribute('data-review-id', issued[4]!.id); await checkProgress(page, 4);
      expect(submissions).toHaveLength(4); expect((await progressState(context)).byMode.grammar.reviewedToday).toBe(1);
      await expect(feedback).toHaveAttribute('data-feedback', 'neutral');
      expect(await feedback.locator('.answer-feedback-marker').count()).toBe(0);
      await bank.locator('[data-token-id]').first().click();
      await expect(page.locator('[data-outcome="incomplete"]')).toBeVisible(); await expect(draft).toHaveAttribute('data-feedback', 'neutral');
      await catActivity(page, 'neutral', 'neutral');
      await feedbackMotion(draft.locator('.answer-feedback-marker'), touch, 'neutral'); await checkProgress(page, 4); expect(submissions).toHaveLength(4);
      await gesture.focus(); await page.keyboard.press('ArrowRight');
      await expect(page.getByRole('heading', { name: 'Повторение завершено', exact: true })).toBeVisible(); await checkProgress(page, 5);
      expect(submissions).toHaveLength(4); const final = await progressState(context);
      expect(final.byMode.listening.reviewedToday).toBe(1); expect(final.byMode['ja-ru'].reviewedToday).toBe(1); expect(final.byMode.grammar.reviewedToday).toBe(1);
      await catActivity(page, 'complete', 'rest');
      expect(await page.evaluate(() => Reflect.get(window, 'qaMicrophoneRequests'))).toBe(0);
      await page.getByRole('button', { name: 'Завершить', exact: true }).click();
      await expect(session).toHaveCount(0);
      await openRepeat(page);
      await expect(session).toBeVisible(); await expect.poll(() => queueGets).toBe(2);
      await expect(session.getByTestId('review-gesture')).toBeVisible();
      expect(sceneIds).toContain(await session.getAttribute('data-scene-id'));
      await settingsMenu(page); await page.getByRole('button', { name: 'Выйти', exact: true }).click();
      await expect(page.getByRole('heading', { name: 'Войти', exact: true })).toBeVisible(); await expect(session).toHaveCount(0);
      const otherEmail = `progress-other-${crypto.randomUUID()}@example.test`; emails.push(otherEmail);
      const otherLink = await createLink(database, 'invite', otherEmail, null);
      await consumeLink(database, 'invite', otherLink.token, password, 'Другой ученик');
      await page.getByLabel('Email', { exact: true }).fill(otherEmail); await page.getByLabel('Пароль', { exact: true }).fill(password);
      await page.getByRole('button', { name: 'Войти', exact: true }).click(); await expect(nav).toBeVisible(); await expect(session).toHaveCount(0);
      const otherProgress = await progressState(context);
      expect(Object.values(otherProgress.byMode).every(mode => mode.reviewedToday === 0)).toBe(true);
      expect(otherProgress.wordsIntroducedToday).toBe(0); expect(otherProgress.skillsIntroducedToday).toBe(0);
      expect(pageErrors).toEqual([]); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
      results.push({ viewport, touch, reducedMotion: touch, stableTotal: 5, finalPercent: 100, noProgressOnRevealDraftDragFailedAck: true, retrySameAttempt: true, gradedAdvances: 3, ungradedSkips: 2, scene: expectedScene, compactLayout, boardGeometry: geometry, analysisViewport, scenesDecoded: 10, appNavigationResumesPlan: true, hiddenAudioPaused: true, keyboardHiddenNoWrite: true, noCrossLearnerSession: true, sessionFeedback: ['good', 'again'], draftFeedback: ['good', 'again', 'neutral'], externalCalls: 0, pageErrors: pageErrors.length });
    } catch (error) {
      releaseRetry?.(); releaseEvaluation?.(); await page.screenshot({ path: `${output}/qa-progress-failure.png`, fullPage: true }); console.info(await page.locator('#main').ariaSnapshot()); throw error;
    } finally { releaseRetry?.(); releaseEvaluation?.(); await context.close(); }
  }
  console.info(JSON.stringify({ browser: browser.version(), results }, null, 2));
} finally {
  releaseRetry?.(); releaseEvaluation?.(); await browser.close(); server.stop(true); provider.stop(true);
  for (const email of emails) { await database.sql`delete from access_links where email=${email}`; await database.sql`delete from users where email=${email}`; }
  await database.sql.close();
}
