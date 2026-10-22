import { chromium, expect } from '@playwright/test';
import { connectDatabase } from '../src/server/db';
import { createLink, consumeLink } from '../src/server/auth';
import { loadCourse } from '../src/server/course';
import { defaultSettings } from '../src/server/material';
import { learningParts, type LearningState, type LearningStep } from '../src/shared/learning';
import { reviewId, submitReview } from '../src/server/reviews';
import type { ReviewQueue } from '../src/shared/types';
import { output } from './helpers/artifact-output';

const databaseUrl = process.env.JAPANESE_INTEGRATION_DATABASE_URL;
const base = process.env.GUIDED_BROWSER_URL; const api = process.env.GUIDED_BROWSER_API_URL;
if (!databaseUrl || new URL(databaseUrl).hostname !== '127.0.0.1' || new URL(databaseUrl).pathname !== '/japanese_app_test' || !base || !api || new URL(base).hostname !== 'localhost' || new URL(api).hostname !== 'localhost') throw new Error('Use isolated localhost preview/API and disposable japanese_app_test only.');
const database = connectDatabase(databaseUrl); const course = loadCourse();
const email = `study-layout-${crypto.randomUUID()}@example.test`; const password = 'Study-layout-disposable-fixture-only-2026!'; let owner = '';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const context = await browser.newContext({ reducedMotion: 'reduce', hasTouch: true, extraHTTPHeaders: { 'x-forwarded-for': `198.18.${crypto.getRandomValues(new Uint8Array(2)).join('.')}` } });
const page = await context.newPage(); const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
type Rect = { x: number; y: number; width: number; height: number };
const records: { label: string; viewport: { width: number; height: number } | null; board: Rect; cat: Rect }[] = [];
let expected: { board: Rect; cat: Rect } | undefined;
let release: (() => void) | undefined;
const guided = () => page.getByTestId('guided-learning');
const headers = () => ({ 'X-Learning-Learner-Id': owner });
async function capture(label: string) {
  await page.evaluate(() => document.fonts.ready);
  const board = await page.locator('.session-board').boundingBox(); const cat = await page.getByTestId('scene-companion').boundingBox();
  if (!board || !cat) throw new Error('Missing study frame.');
  const viewport = page.viewportSize()!;
  for (const [name, rect] of Object.entries({ board, cat })) {
    expect(rect.x, `${label}: ${name} left outside viewport`).toBeGreaterThanOrEqual(0);
    expect(rect.y, `${label}: ${name} above viewport`).toBeGreaterThanOrEqual(0);
    expect(rect.x + rect.width, `${label}: ${name} right outside viewport`).toBeLessThanOrEqual(viewport.width);
    expect(rect.y + rect.height, `${label}: ${name} below viewport`).toBeLessThanOrEqual(viewport.height);
  }
  const intro = page.getByTestId('learning-intro');
  if (await intro.count()) {
    if (label === 'word-intro') await page.screenshot({ path: `${output}/study-layout-current-${viewport.width}x${viewport.height}.png`, fullPage: true });
    const word = await intro.locator('h2').boundingBox();
    for (const selector of ['.guided-reading', 'h3', ':scope > p:not(.guided-reading):not(.notice)']) {
      const block = intro.locator(selector).first(); if (!await block.count()) continue; const box = await block.boundingBox();
      if (word && box) expect(Math.abs(box.x + box.width / 2 - word.x - word.width / 2), `${label}: ${selector} is off the word centreline`).toBeLessThanOrEqual(2);
    }
  }
  const usefulHeight = await page.locator('.session-scroll').evaluate(element => element.clientHeight);
  expect(usefulHeight, `${label}: study content has too little usable height`).toBeGreaterThanOrEqual(112);
  const hud = await page.locator('.game-hud').boundingBox(); if (hud) expect(cat.y, `${label}: cat overlaps navigation`).toBeGreaterThanOrEqual(hud.y + hud.height - 1);
  const exit = page.locator('.session-header > button'); const exitBox = await exit.boundingBox(); if (exitBox) { expect(exitBox.height).toBeGreaterThanOrEqual(44); expect(exitBox.width).toBeGreaterThanOrEqual(44); }
  const next = { board, cat }; records.push({ label, viewport: page.viewportSize(), ...next });
  if (expected) for (const part of ['board', 'cat'] as const) for (const coordinate of ['x', 'y', 'width', 'height'] as const) expect(Math.abs(next[part][coordinate] - expected[part][coordinate]), `${label}: ${part}.${coordinate} moved`).toBeLessThanOrEqual(1);
  else expected = next;
  const goal = page.locator('.session-goal'); const progress = page.locator('.session-progress progress');
  const goalBox = await goal.boundingBox(); const progressBox = await progress.boundingBox();
  if (goalBox && progressBox) expect(goalBox.y + goalBox.height, `${label}: header goal overlaps progress`).toBeLessThanOrEqual(progressBox.y + 1);
  expect(await goal.evaluate(element => element.scrollHeight <= element.clientHeight), `${label}: header goal clipped`).toBe(true);

  expect(await page.evaluate(() => scrollY), `${label}: outer page scrolled`).toBe(0);
}
async function changed(version: string | null) { await expect(guided()).not.toHaveAttribute('data-state-version', String(version)); await expect(page.getByText('Сохраняем шаг…', { exact: true })).toHaveCount(0); }
async function next() { const version = await guided().getAttribute('data-state-version'); await page.getByRole('button', { name: 'Дальше', exact: true }).click(); await changed(version); }
async function recall() {
  const version = await guided().getAttribute('data-state-version'); const gesture = page.getByTestId('review-gesture');
  if (await gesture.getAttribute('data-mode') === 'listening') await expect.poll(() => gesture.locator('audio').evaluate((audio: HTMLAudioElement) => audio.currentTime), { timeout: 10000 }).toBeGreaterThan(.02);
  await page.getByTestId('card-face').click(); await capture(`${await gesture.getAttribute('data-mode')}-revealed`);
  await gesture.press('ArrowRight'); await changed(version);
  const scroll = page.locator('.session-scroll'); if (await scroll.count()) expect(await scroll.evaluate(element => element.scrollTop)).toBe(0);
}
async function seed(lessonNumber: number, predicate: (step: LearningStep) => boolean) {
  const lessonId = `marugoto.starter-a1.lesson.${String(lessonNumber).padStart(2, '0')}`;
  const route = course.learning!.find(route => route.lessonId === lessonId)!; const parts = learningParts(route);
  const partIndex = parts.findIndex(part => part.some(predicate)); const stepIndex = parts[partIndex]!.findIndex(predicate);
  const state = { partIndex, pendingStepIds: parts[partIndex]!.slice(stepIndex).map(step => step.id), completedStepIds: [...parts.slice(0, partIndex).flat(), ...parts[partIndex]!.slice(0, stepIndex)].map(step => step.id) };
  await database.sql`delete from learning_states where user_id=${owner} and lesson_id=${lessonId}`;
  await database.sql`insert into learning_states(user_id,lesson_id,route_version,version,state) values(${owner},${lessonId},${route.version},0,${state})`;
  await page.goto(base!); await page.locator(`[data-testid="learn-lesson"][data-lesson-id="${lessonId}"]`).click(); await expect(guided()).toHaveAttribute('data-step-kind', /./);
}
async function continuePart() { const version = await guided().getAttribute('data-state-version'); await page.getByRole('button', { name: /^(Продолжить урок|Продолжить|Завершить урок)$/ }).click(); await changed(version); }

try {
  const invitation = await createLink(database, 'invite', email, null); await consumeLink(database, 'invite', invitation.token, password, 'Study layout fixture');
  const [user] = await database.sql`select id from users where email=${email}`; owner = String(user.id);
  expect((await context.request.post(`${api}/api/auth/sign-in/email`, { headers: { origin: base }, data: { email, password } })).status()).toBe(200);
  expect((await context.request.put(`${api}/api/settings`, { headers: { origin: base, ...headers() }, data: { ...defaultSettings, animations: false, sceneSoundEnabled: false } })).status()).toBe(200);
  await context.route('https://a1.marugotoweb.jp/**', route => route.abort());
  for (const viewport of [{ width: 320, height: 568 }, { width: 640, height: 312 }, { width: 768, height: 390 }, { width: 1280, height: 624 }, { width: 1440, height: 700 }, { width: 1920, height: 936 }, { width: 3000, height: 1446 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport); expected = undefined;
    await seed(1, step => step.kind === 'word-intro'); await capture('word-intro'); await expect(page.locator('.guided-reading')).toHaveCount(0);
    await page.screenshot({ path: `${output}/study-layout-intro-${viewport.width}.png`, fullPage: true });
    const scroll = page.locator('.session-scroll');
    const canScroll = await scroll.evaluate(element => element.scrollHeight > element.clientHeight);
    if (canScroll) {
      await scroll.focus(); await scroll.press('End'); await expect.poll(() => scroll.evaluate(element => element.scrollTop)).toBeGreaterThan(0); await capture('intro-keyboard-scroll');
      if (viewport.width === 390) {
        await scroll.evaluate(element => { element.scrollTop = 0; }); const box = await scroll.boundingBox(); if (!box) throw new Error('Missing scroll area.');
        const touch = await context.newCDPSession(page); const x = box.x + 12; const y = box.y + box.height - 70;
        await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
        await touch.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: y - 140 }] });
        await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await touch.detach();
        await expect.poll(() => scroll.evaluate(element => element.scrollTop)).toBeGreaterThan(0); await capture('intro-touch-scroll');
      }
    }

    while (await guided().getAttribute('data-step-kind') === 'word-intro') { await next(); await capture('next-intro-or-practice'); }
    for (let mode = 0; mode < 3; mode++) { await capture('word-practice-hidden'); await recall(); }
    const core2 = new Set(course.learning!.find(route => route.lessonId.endsWith('02'))!.goals.flatMap(goal => goal.parts.flatMap(part => part.words.map(word => word.wordId))));
    const distinct = course.words.find(word => core2.has(word.id) && word.surface !== word.kana)!;
    await seed(2, step => step.kind === 'word-intro' && step.wordId === distinct.id); await expect(page.locator('.guided-reading')).toHaveText(distinct.kana); await capture('distinct-reading-preserved');
    await seed(1, step => step.goalId === 'l01-scripts' && step.kind === 'word-intro'); await capture('goal-with-context'); await page.screenshot({ path: `${output}/study-layout-hiragana-${viewport.width}x${viewport.height}.png`, fullPage: true }); await page.screenshot({ path: `${output}/study-layout-context-${viewport.width}.png`, fullPage: true });
    while (await guided().getAttribute('data-step-kind') === 'word-intro') await next(); await capture('goal-without-context');
    await seed(4, step => step.goalId === 'l04-family-photo' && step.kind === 'word-intro'); await capture('longest-goal'); await page.screenshot({ path: `${output}/study-layout-long-goal-${viewport.width}.png`, fullPage: true });

    await seed(3, step => step.kind === 'construction-intro'); await capture('construction-intro'); await page.screenshot({ path: `${output}/study-layout-construction-${viewport.width}.png`, fullPage: true }); await next();
    await recall(); await recall(); await capture('construction-empty');
    const current = await context.request.get(`${api}/api/learning/marugoto.starter-a1.lesson.03`, { headers: headers() }); const state: LearningState = await current.json();
    if (state.reviewItem?.mode !== 'grammar') throw new Error('Missing construction.');
    for (const id of state.reviewItem.exercise.acceptedOrders[0]!) await page.locator(`.bank [data-token-id="${id}"]`).click();
    await expect(page.locator('[data-outcome="correct"]').first()).toBeVisible(); await capture('construction-analysis');
    await seed(1, step => step.kind === 'video'); await capture('video');
    await page.locator('.guided-video video').evaluate((video: HTMLVideoElement) => video.play().catch(() => {})); await expect(page.getByText('Не удалось воспроизвести видео.', { exact: false })).toBeVisible(); await capture('video-error');
    while (await guided().getAttribute('data-step-kind') === 'video') await continuePart();
    await expect(guided()).toHaveAttribute('data-step-kind', 'part-complete'); await capture('part-summary');
    await seed(1, step => step.kind === 'word-intro');
    let received: () => void = () => {}; const arrived = new Promise<void>(resolve => { received = resolve; }); const held = new Promise<void>(resolve => { release = resolve; });
    await context.route('**/api/learning/**/advance', async route => { received(); await held; await route.abort(); });
    await page.getByRole('button', { name: 'Дальше', exact: true }).click(); await arrived; await capture('saving-status'); release?.();
    await expect(page.getByRole('button', { name: 'Повторить сохранение', exact: true })).toBeVisible(); await capture('save-error');
    await page.evaluate(() => dispatchEvent(new Event('focus'))); await expect(page.locator('.page-notices > .notice').last()).toContainText('На этом устройстве');
    await expect(page.locator('.page-notices > .notice.error')).toBeVisible();
    const notices = await page.locator('.page-notices > .notice').all(); const firstNotice = await notices[0]!.boundingBox(); const secondNotice = await notices[1]!.boundingBox();
    expect(firstNotice!.y + firstNotice!.height).toBeLessThanOrEqual(secondNotice!.y);
    await page.locator('.page-notices').getByRole('button', { name: 'Повторить загрузку', exact: true }).scrollIntoViewIfNeeded(); await capture('global-error-and-pending-notice');
    await page.locator('.page-notices').getByRole('button', { name: 'Повторить сохранение', exact: true }).scrollIntoViewIfNeeded(); await capture('global-pending-action-accessible');
    await context.unroute('**/api/learning/**/advance'); await page.getByRole('button', { name: 'Повторить сохранение', exact: true }).first().click();

    await database.sql`delete from review_attempts where user_id=${owner}`; await database.sql`delete from review_states where user_id=${owner}`;
    const wordId = course.learning![0]!.goals[0]!.parts[0]!.words[0]!.wordId;
    const construction = course.learning!.find(route => route.lessonId.endsWith('03'))!.goals.flatMap(goal => goal.parts).find(part => part.construction)!.construction!;
    const exercise = course.exercises.find(item => item.id === construction.exerciseId)!;
    await submitReview(database, owner, course, { attemptId: crypto.randomUUID(), reviewId: reviewId('ja-ru', wordId), version: 0, mode: 'ja-ru', rating: 1 });
    await submitReview(database, owner, course, { attemptId: crypto.randomUUID(), reviewId: reviewId('grammar', exercise.skillId, exercise.id), version: 0, mode: 'grammar', tokenIds: exercise.acceptedOrders[0]!, revealed: false });
    await database.sql`update review_states set due=now()-interval '1 minute' where user_id=${owner}`;
    const response = await context.request.get(`${api}/api/reviews?mode=mixed`, { headers: headers() }); const queue: ReviewQueue = await response.json();
    await page.goto(base); await page.getByRole('button', { name: 'Повторение', exact: true }).click(); await page.getByRole('button', { name: 'Начать повторение', exact: false }).click();
    for (let index = 0; index < queue.items.length; index++) {
      const gesture = page.getByTestId('review-gesture'); const id = await gesture.getAttribute('data-review-id'); const item = queue.items.find(item => item.id === id)!;
      await capture(`repeat-${item.mode}-hidden`);
      if (item.mode === 'grammar') { for (const tokenId of item.exercise.acceptedOrders[0]!) await page.locator(`.bank [data-token-id="${tokenId}"]`).click(); await expect(page.locator('[data-outcome="correct"]').first()).toBeVisible(); }
      else { if (item.mode === 'listening') await expect(page.getByTestId('card-face')).toContainText('Нажмите, чтобы раскрыть смысл', { timeout: 10000 }); await page.getByTestId('card-face').click(); }
      await capture(`repeat-${item.mode}-answer`); await gesture.press('ArrowRight');
      if (index < queue.items.length - 1) await expect(page.getByTestId('review-gesture')).not.toHaveAttribute('data-review-id', id!); else await expect(page.getByTestId('portion-complete')).toBeVisible();
    }
    await capture('repeat-summary');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(expected!.board.y + expected!.board.height).toBeLessThanOrEqual(viewport.height);
    await page.screenshot({ path: `${output}/study-layout-${viewport.width}.png`, fullPage: true });
  }
  expect(errors).toEqual([]); await Bun.write(`${output}/study-layout-green.json`, JSON.stringify({ green: true, reducedMotion: true, isolatedFixture: true, records }, null, 2)); console.info(`Study layout: ${records.length} stable frame/cat measurements across short, wide and mobile viewports.`);
} catch (error) { await Bun.write(`${output}/study-layout-red.json`, JSON.stringify({ green: false, failure: String(error), records }, null, 2)); throw error; }
finally { release?.(); await context.close(); await browser.close(); await database.sql`delete from access_links where email=${email}`; if (owner) await database.sql`delete from users where id=${owner}`; await database.sql.close(); }
