import { chromium, expect, type BrowserContext, type Page } from '@playwright/test';
import { resolve } from 'node:path';
import { createApp } from '../src/server/app';
import { connectDatabase } from '../src/server/db';
import { createLink, consumeLink } from '../src/server/auth';
import { loadCourse } from '../src/server/course';
import { reviewId } from '../src/server/reviews';
import { counterAudio } from '../src/server/counter-audio';
import { defaultSettings } from '../src/server/material';
import { counterTarget, makeCounterCard } from '../src/shared/counters';
import type { ReviewItem, ReviewQueue } from '../src/shared/types';
import { nextFixtureIp } from './helpers/fixture-ip';
import { output } from './helpers/artifact-output';

const databaseUrl = process.env.JAPANESE_INTEGRATION_DATABASE_URL;
if (!databaseUrl || new URL(databaseUrl).hostname !== '127.0.0.1' || new URL(databaseUrl).pathname !== '/japanese_app_test') throw new Error('Use disposable localhost japanese_app_test.');
const database = connectDatabase(databaseUrl), course = loadCourse(), dist = resolve(import.meta.dir, '../dist');
let app: ReturnType<typeof createApp>;
const server = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: async request => {
  const path = new URL(request.url).pathname;
  if (path.startsWith('/api/')) return app.fetch(request);
  const file = resolve(dist, '.' + decodeURIComponent(path === '/' ? '/index.html' : path));
  if (!file.startsWith(dist + '/') || !['GET', 'HEAD'].includes(request.method)) return new Response('Not found', { status: 404 });
  const asset = Bun.file(file); return await asset.exists() ? new Response(asset) : new Response('Not found', { status: 404 });
} });
const base = server.url.origin;
app = createApp({ database, course, config: { DATABASE_URL: databaseUrl, BETTER_AUTH_SECRET: 'counter-browser-fixture-secret-more-than-32-characters', APP_URL: base, HOST: '127.0.0.1', PORT: server.port! } });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const contexts: BrowserContext[] = [], learners: { id: string; email: string }[] = [], errors: string[] = [], results: object[] = [];
async function fixture(width: number, reducedMotion: 'reduce' | 'no-preference') {
  const email = `counter-browser-${crypto.randomUUID()}@example.test`, password = 'Counter-browser-fixture-only!';
  const link = await createLink(database, 'invite', email, null); await consumeLink(database, 'invite', link.token, password, 'Counter browser');
  const [actor] = await database.sql`select id from users where email=${email}`; learners.push({ id: actor.id, email });
  const context = await browser.newContext({ viewport: { width, height: 900 }, hasTouch: width < 600, reducedMotion, extraHTTPHeaders: { 'x-forwarded-for': nextFixtureIp() } }); contexts.push(context);
  const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    const state = { playing: 0 }; (window as any).__counterAudio = state;
    const play = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function () { this.addEventListener('playing', () => state.playing++, { once: true }); return play.call(this); };
  });
  await page.goto(base); await page.getByLabel('Email', { exact: true }).fill(email); await page.getByLabel('Пароль', { exact: true }).fill(password); await page.getByRole('button', { name: 'Войти', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Учебник', exact: true })).toBeVisible();
  const words = ['ほん', 'かさ', 'たまご', 'シャツ', 'ひと', 'いす'].map(kana => course.words.find(word => word.kana === kana && !/суффикс/.test(word.meaningRu))!);
  for (const word of words) { const response = await context.request.post(base + '/api/reviews', { headers: { origin: base }, data: { attemptId: crypto.randomUUID(), reviewId: reviewId('ja-ru', word.id), version: 0, mode: 'ja-ru', rating: 3 } }); expect(response.status()).toBe(200); }
  const settings = await context.request.put(base + '/api/settings', { headers: { origin: base }, data: { ...defaultSettings, sceneSoundEnabled: false } }); expect(settings.status()).toBe(200);
  await page.reload(); await expect(page.getByRole('heading', { name: 'Учебник', exact: true })).toBeVisible();
  return { page, context, actor, words };
}
async function closeIntroduction(page: Page) { const intro = page.getByTestId('counter-introduction'); if (await intro.isVisible()) await intro.getByRole('button', { name: 'К карточке', exact: true }).click(); }
async function reveal(page: Page, item: Extract<ReviewItem, { mode: 'counter' }>, wrong = false) {
  await closeIntroduction(page);
  if (item.counter.kind === 'recall') await page.locator('[data-testid=counter-front][data-card-face]').click();
  else {
    const key = wrong ? item.counter.options.find(option => !item.counter.acceptedKeys.includes(option.key))!.key : item.counter.acceptedKeys[0]!;
    await page.locator(`[data-choice=${JSON.stringify(key)}]`).click();
  }
  await expect(page.getByTestId('counter-answer')).toBeVisible();
}
async function menuGrade(page: Page, rating: 1 | 3) { const actions=page.locator('.card-actions'); if (!await actions.evaluate(element=>element.hasAttribute('open'))) await page.getByLabel('Действия карточки',{exact:true}).click(); await page.getByRole('button',{name:rating===3?'Вспомнил — дальше':'Повторить — дальше',exact:true}).click(); }
async function noOverflow(page: Page) { expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true); }

try {
  const desktop = await fixture(1280, 'no-preference'), { page, context } = desktop;
  let queue: ReviewQueue | undefined, repeatQueue: ReviewQueue | undefined, loseAck = false; const submissions: any[] = [];
  await context.route('**/api/training?counters=true', async route => { const response = await route.fetch(); queue = await response.json(); await route.fulfill({ response }); });
  await context.route(url => url.pathname === '/api/reviews', async route => {
    if (route.request().method() !== 'POST') { const response = await route.fetch(); repeatQueue = await response.json(); await route.fulfill({ response }); return; }
    submissions.push(route.request().postDataJSON()); const response = await route.fetch();
    if (loseAck) { loseAck = false; await route.abort('failed'); } else await route.fulfill({ response });
  });
  await page.getByRole('button', { name: 'Тренировать счёт', exact: true }).click();
  await expect(page.getByTestId('card-deck')).toHaveAttribute('data-remaining', '20'); expect(queue!.items).toHaveLength(20);
  const first = queue!.items[0]!; if (first.mode !== 'counter') throw new Error('Expected counter');
  await expect(page.getByTestId('counter-introduction')).toBeVisible();
  await page.screenshot({ path: `${output}/counters-introduction-1280.png`, fullPage: true });
  await reveal(page, first, true); await page.waitForTimeout(450); await expect(page.locator('.deck-summary')).toBeInViewport();
  await page.screenshot({ path: `${output}/counters-flip-1280.png`, fullPage: true });
  await page.getByRole('navigation', { name: 'Разделы', exact: true }).getByRole('button', { name: 'Учебник', exact: true }).click();
  await page.keyboard.press('ArrowRight'); expect(submissions).toHaveLength(0);
  await page.getByRole('button', { name: 'Тренировать счёт', exact: true }).click();
  await expect(page.getByTestId('review-gesture')).toHaveAttribute('data-review-id', first.id);
  await expect(page.getByTestId('counter-answer')).toBeVisible(); await expect(page.getByTestId('card-deck')).toHaveAttribute('data-remaining', '20');
  loseAck = true; await menuGrade(page, 1);
  await expect(page.getByRole('button', { name: 'Повторить сохранение', exact: true })).toBeVisible();
  await expect(page.getByTestId('card-deck')).toHaveAttribute('data-remaining', '20'); expect(submissions).toHaveLength(1);
  await page.getByRole('button', { name: 'Повторить сохранение', exact: true }).click();
  await expect(page.getByTestId('review-gesture')).not.toHaveAttribute('data-review-id', first.id);
  expect(submissions[0].attemptId).toBe(submissions[1].attemptId); await expect(page.getByTestId('card-deck')).toHaveAttribute('data-remaining', '20');
  let completed = 0, turns = 0; const formats = new Set<string>(); let corrected = false;
  while (completed < 20) {
    const id = await page.getByTestId('review-gesture').getAttribute('data-review-id');
    const item = queue!.items.find(item => item.id === id); if (!item || item.mode !== 'counter') throw new Error('Unknown counter card');
    formats.add(item.counter.kind); await reveal(page, item);
    if (turns === 2) { await page.getByTestId('review-gesture').focus(); await page.keyboard.press('ArrowRight'); }
    else await menuGrade(page, 3); completed++; turns++;
    if (id === first.id) corrected = true;
    if (completed < 20) { await expect(page.getByTestId('card-deck')).toHaveAttribute('data-remaining', String(20 - completed)); await expect(page.getByTestId('review-gesture')).not.toHaveAttribute('data-review-id', id!); }
  }
  await expect(page.getByTestId('portion-complete')).toBeVisible(); expect(corrected).toBe(true); expect(formats.size).toBe(5); expect(turns).toBe(20);
  expect(await page.evaluate(() => (window as any).__counterAudio.playing)).toBeGreaterThan(0);
  await page.getByRole('button', { name: 'К учебнику', exact: true }).click(); await page.locator('[data-lesson-id="marugoto.starter-a1.lesson.04"] > .lesson-material > summary').click(); await page.locator('article[data-lesson-id="marugoto.starter-a1.lesson.04"]').getByText('Дополнительный словарь и конструкции', { exact: true }).click(); await page.locator('[data-testid="train-lesson"][data-lesson-id="marugoto.starter-a1.lesson.04"]').click();
  const gesture = page.getByTestId('review-gesture'); await expect(page.getByTestId('card-face')).toBeVisible();
  const oldId = await gesture.getAttribute('data-review-id'); await page.getByTestId('card-face').click();
  if (await page.locator('.flip-card').getAttribute('data-revealed') !== 'true') { await page.waitForTimeout(500); await page.getByTestId('card-face').click(); }
  await expect(page.locator('.flip-card')).toHaveAttribute('data-revealed', 'true'); await page.waitForTimeout(450);
  await page.screenshot({ path: `${output}/word-flip-1280.png`, fullPage: true });
  const face = await page.getByTestId('card-face').boundingBox(); if (!face) throw new Error('Missing card bounds');
  await page.mouse.move(face.x + face.width / 2, face.y + face.height / 2); await page.mouse.down(); await page.mouse.move(face.x + face.width / 2 - 85, face.y + face.height / 2, { steps: 5 }); await page.mouse.up();
  await expect(gesture).not.toHaveAttribute('data-review-id', oldId!);
  await expect(page.getByRole('progressbar', { name: 'Прогресс занятия' })).toHaveAttribute('value', '0');
  await page.getByRole('button', { name: 'Завершить', exact: true }).click();
  await page.getByRole('navigation', { name: 'Разделы', exact: true }).getByRole('button', { name: 'Повторение', exact: true }).click();
  await page.getByRole('button', { name: 'Начать повторение', exact: false }).click(); await expect(gesture).toBeVisible();
  for (let index = 0; index < 12 && await gesture.getAttribute('data-mode') !== 'listening'; index++) {
    const id = await gesture.getAttribute('data-review-id'), current = repeatQueue!.items.find(item => item.id === id)!;
    if (current.mode === 'counter') await reveal(page, current);
    else { if (current.mode === 'grammar') throw new Error('Unexpected grammar fixture'); await page.getByTestId('card-face').click(); }
    await menuGrade(page, 3); await expect(gesture).not.toHaveAttribute('data-review-id', id!);
  }
  await expect(gesture).toHaveAttribute('data-mode', 'listening'); await expect(page.getByTestId('card-face').locator('.jp')).toHaveCount(0);
  const audioId = await gesture.getAttribute('data-review-id'); await page.getByTestId('card-face').click();
  if (await page.locator('.flip-card').getAttribute('data-revealed') !== 'true') { await page.waitForTimeout(500); await page.getByTestId('card-face').click(); }
  await expect(page.locator('.flip-card')).toHaveAttribute('data-revealed', 'true'); await expect(page.getByTestId('card-face').locator('.jp')).toBeVisible();
  await gesture.focus(); await page.keyboard.press('ArrowRight'); await expect(gesture).not.toHaveAttribute('data-review-id', audioId!);
  await noOverflow(page); results.push({ viewport: 1280, realTwentyCardDeck: true, fiveFormats: true, lostAckRetriedSameAttempt: true, failedCardReturned: true, navigationPreservesRevealedCard: true, keyboardGrade: true, ordinaryWordSwipeAgainDoesNotComplete: true, ordinaryAudioFlipHidesAnswer: true, realSpeechPlaying: await page.evaluate(() => (window as any).__counterAudio.playing) });

  const mobile = await fixture(390, 'reduce');
  const book = mobile.words.find(word => word.kana === 'ほん')!, person = mobile.words.find(word => word.kana === 'ひと')!;
  for (const [counter, level] of [['satsu', 6], ['sai', 2]] as const) await database.sql`insert into counter_progress(user_id,counter_id,level) values(${mobile.actor.id},${counter},${level})`;
  const makeItem = (counter: 'satsu' | 'sai', amount: number, kind: 'reading-choice' | 'recall', wordId: string): ReviewItem => {
    const seed = crypto.randomUUID(), targetId = counterTarget(counter, kind, amount), card = makeCounterCard(targetId, wordId, mobile.words, seed)!;
    card.audioUrl = counterAudio(card.definition, amount); card.examples.forEach((example, index) => example.audioUrl = counterAudio(card.definition, [1, 3, 8][index]!));
    return { id: reviewId('counter', targetId, `${wordId}|${seed}`), targetId, mode: 'counter', counter: card, version: 0, due: new Date().toISOString(), isNew: true };
  };
  const edgeItems = [makeItem('satsu', 1, 'reading-choice', book.id), makeItem('satsu', 8, 'reading-choice', book.id), makeItem('satsu', 9_999_999, 'reading-choice', book.id), makeItem('sai', 120, 'recall', person.id)];
  await mobile.context.route('**/api/training?counters=true', route => route.fulfill({ json: { items: edgeItems, remainingNew: 4, remainingDue: 0 } }));
  await mobile.page.getByRole('button', { name: 'Тренировать счёт', exact: true }).click(); await expect(mobile.page.getByTestId('card-deck')).toBeVisible();
  const one=mobile.page.locator('.counter-picture[data-count="1"]');await expect(one.locator('.counter-quantity')).toContainText('1');const oneSize=await one.locator('svg').boundingBox();
  if(edgeItems[0]!.mode!=='counter')throw new Error('Expected counter');await reveal(mobile.page,edgeItems[0]!);await menuGrade(mobile.page,3);await expect(mobile.page.getByTestId('card-deck')).toHaveAttribute('data-remaining','3');
  const eight=mobile.page.locator('.counter-picture[data-count="8"]'); await expect(eight).toHaveCount(1); await expect(eight.locator('svg')).toHaveCount(1); await expect(eight.locator('.counter-quantity')).toContainText('8');const eightSize=await eight.locator('svg').boundingBox();expect(oneSize).toBeTruthy();expect(eightSize).toBeTruthy();expect(Math.abs(oneSize!.width-eightSize!.width)).toBeLessThan(1);expect(Math.abs(oneSize!.height-eightSize!.height)).toBeLessThan(1);
  await mobile.page.screenshot({path:`${output}/counters-eight-390.png`,fullPage:true});
  if(edgeItems[1]!.mode!=='counter')throw new Error('Expected counter'); await reveal(mobile.page,edgeItems[1]!);await menuGrade(mobile.page,3);await expect(mobile.page.getByTestId('card-deck')).toHaveAttribute('data-remaining','2');
  await noOverflow(mobile.page); await mobile.page.screenshot({ path: `${output}/counters-million-390.png`, fullPage: true });
  if (edgeItems[2]!.mode !== 'counter') throw new Error('Expected counter'); await reveal(mobile.page, edgeItems[2]!);
  expect(await mobile.page.locator('.flip-inner').evaluate(element => getComputedStyle(element).transitionDuration)).toBe('0s');
  await noOverflow(mobile.page); await mobile.page.screenshot({ path: `${output}/counters-million-answer-390.png`, fullPage: true });
  expect(await mobile.page.getByTestId('counter-answer').evaluate(element => { const box = element.getBoundingClientRect(); return box.left >= 0 && box.right <= innerWidth; })).toBe(true);
  expect(await mobile.page.getByTestId('counter-answer').locator('rt').evaluateAll(elements => elements.every(element => { const box = element.getBoundingClientRect(); return box.left >= 0 && box.right <= innerWidth; }))).toBe(true);
  await menuGrade(mobile.page, 3);
  await expect(mobile.page.getByTestId('card-deck')).toHaveAttribute('data-remaining', '1');
  await expect(mobile.page.locator('[data-age="true"]')).toHaveCount(1); await expect(mobile.page.locator('[data-age="true"] svg')).toHaveCount(1);
  await mobile.page.setViewportSize({ width: 320, height: 844 }); await noOverflow(mobile.page); await mobile.page.screenshot({ path: `${output}/counters-age-320.png`, fullPage: true });
  if (edgeItems[3]!.mode !== 'counter') throw new Error('Expected counter'); await reveal(mobile.page, edgeItems[3]!); await menuGrade(mobile.page, 3);
  await expect(mobile.page.getByTestId('portion-complete')).toBeVisible(); results.push({ viewport: [390, 320], controlledEdgeFixture: true, maximum: 9999999, age: 120, ageUsesOnePerson: true, overflow: false, reducedMotion: true });
  expect(errors).toEqual([]); await Bun.write(`${output}/counters-browser.json`, JSON.stringify({ results, pageErrors: errors, acousticReview: 'not-performed' }, null, 2));
  console.log(JSON.stringify({ results, pageErrors: errors }, null, 2));
} finally {
  for (const context of contexts) await context.close(); await browser.close(); server.stop(true);
  for (const learner of learners) { await database.sql`delete from access_links where email=${learner.email}`; await database.sql`delete from users where id=${learner.id}`; }
  await database.sql.close();
}
