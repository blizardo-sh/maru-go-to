import { workspaceNext } from './helpers/workspace-next';
import { chromium, expect, type Page } from '@playwright/test';
import { seedAcceptedHistory } from './helpers/introduced-browser-fixture';
import { createLink, consumeLink } from '../src/server/auth';
import { connectDatabase } from '../src/server/db';
import { loadCourse } from '../src/server/course';
import { defaultSettings } from '../src/server/material';
import { reviewId } from '../src/server/reviews';
import { basicKana, type KanaAudioManifest } from '../src/shared/kana';
import type { LearnerSettings, ReviewSubmission } from '../src/shared/types';
import { nextFixtureIp } from './helpers/fixture-ip';
import { output } from './helpers/artifact-output';

const base = process.env.GUIDED_BROWSER_URL, databaseUrl = process.env.JAPANESE_INTEGRATION_DATABASE_URL;
if (!base || new URL(base).hostname !== 'localhost' || !databaseUrl || new URL(databaseUrl).hostname !== '127.0.0.1' || new URL(databaseUrl).pathname !== '/japanese_app_test') throw new Error('Use the isolated guided launcher and dedicated test database.');
const database = connectDatabase(databaseUrl), course = loadCourse();
const prepared = course.learning!.flatMap(lesson => lesson.goals.flatMap(goal => goal.parts.flatMap(part => part.construction ? [part.construction] : [])))[0]!;
const exercise = course.exercises.find(item => item.id === prepared.exerciseId)!;
const email = `reference-native-${crypto.randomUUID()}@example.test`, password = `Reference-native-${crypto.randomUUID()}!`;
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, reducedMotion: 'reduce', extraHTTPHeaders: { 'x-forwarded-for': nextFixtureIp() } });
if (process.env.GUIDED_BROWSER_SOURCE === 'true') await context.routeWebSocket(url => url.hostname === 'localhost' && url.port === new URL(base).port, socket => socket.close());
const page = await context.newPage(); page.setDefaultTimeout(15000);
const errors: string[] = [], submissions: ReviewSubmission[] = []; let userId = '', loseGradeAck = false, failSettings = false;
const report: Record<string, unknown> = { isolatedContext: true, physicalDevice: false, resetDatabase: false, sourcePreview: process.env.GUIDED_BROWSER_SOURCE === 'true' };
page.on('pageerror', error => errors.push(error.message));
async function settings(): Promise<LearnerSettings> { const response = await context.request.get(base! + '/api/settings'); expect(response.status()).toBe(200); return response.json(); }
const headers = () => ({ origin: base!, 'X-Learning-Learner-Id': userId });
const cards = async () => [...await database.sql`select item_id,mode,version,card,due from review_states where user_id=${userId} order by item_id,mode`];
async function navigate(label: string) { await page.getByRole('navigation', { name: 'Разделы', exact: true }).getByRole('button', { name: label, exact: true }).click(); }
async function reachable(p: Page) { expect(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true); }
try {
  const link = await createLink(database, 'invite', email, null); expect(await consumeLink(database, 'invite', link.token, password, 'Reference native fixture')).toBe(true);
  const response = await context.request.post(base + '/api/auth/sign-in/email', { headers: { origin: base }, data: { email, password } }); expect(response.status()).toBe(200); userId = (await response.json()).user.id;
  expect((await context.request.put(base + '/api/settings', { headers: headers(), data: { ...defaultSettings, animations: false, sceneSoundEnabled: false } })).status()).toBe(200);
  const ids = new Set(exercise.tokens.map(token => course.forms.find(form => form.id === token.formId)!.wordId));
  await seedAcceptedHistory(database, course, email, [...ids].filter(id => course.words.find(word => word.id === id)!.reviewStatus !== 'draft'), [exercise.skillId]);
  await database.sql`update review_states set due=now()-interval '1 day' where user_id=${userId}`;
  await page.addInitScript(() => {
    (window as any).__referencePlayed = [];
    const original = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function () { this.addEventListener('playing', () => (window as any).__referencePlayed.push(this.currentSrc || this.src), { once: true }); return original.call(this); };
  });
  await context.route(url => url.pathname === '/api/settings', async route => { if (route.request().method() === 'PUT' && failSettings) { failSettings = false; await route.abort('failed'); } else await route.continue(); });
  await context.route(url => url.pathname === '/api/reviews', async route => {
    if (route.request().method() !== 'POST') return route.continue();
    submissions.push(route.request().postDataJSON());
    const saved = await route.fetch(); if (loseGradeAck) { loseGradeAck = false; await route.abort('failed'); } else await route.fulfill({ response: saved });
  });
  await page.goto(base); await expect(page.getByTestId('learn-lesson')).toHaveCount(18);
  await navigate('Повторение'); const types = page.getByTestId('repeat-types'); await expect(types.getByRole('checkbox')).toHaveCount(5);
  for (const checkbox of await types.getByRole('checkbox').all()) await expect(checkbox).toBeChecked();
  failSettings = true; await types.getByRole('checkbox', { name: /Счётные суффиксы/ }).uncheck();
  await expect(page.getByRole('button', { name: 'Повторить сохранение выбора', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: /Начать повторение/ })).toBeDisabled(); expect((await settings()).repeatTypes).toContain('counters');
  await page.getByRole('button', { name: 'Повторить сохранение выбора', exact: true }).click(); await expect.poll(async () => (await settings()).repeatTypes.includes('counters')).toBe(false);
  await page.reload(); await navigate('Повторение'); await expect(types.getByRole('checkbox', { name: /Счётные суффиксы/ })).not.toBeChecked();
  for (const label of [/Слова/, /Конструкции/, /Вопросы/, /Время и календарь/]) { await types.getByRole('checkbox', { name: label }).uncheck(); await expect(types.getByRole('checkbox', { name: label })).toBeEnabled(); }
  await expect(page.getByText('Выберите хотя бы один тип материала.', { exact: true })).toBeVisible(); expect((await settings()).repeatTypes).toEqual([]);
  expect((await (await context.request.get(base + '/api/reviews?mode=mixed')).json()).items).toEqual([]); report.repeatSaveFailureAndPersistence = true;

  await navigate('Справочник'); await page.getByRole('button', { name: 'Хирагана', exact: true }).click(); await expect(page.locator('.kana-reference')).toBeVisible(); await expect(page.getByTestId('train-kana')).toHaveCount(0); await navigate('Тренировки'); await page.getByRole('button', { name: 'Тренировать хирагану', exact: true }).click();
  const trainer = page.getByTestId('kana-trainer');
  const beforeKana = await cards(), beforePosts = submissions.length;
  await trainer.getByRole('button', { name: /Учить выбранные/ }).click();
  await expect(trainer.locator('figcaption')).toBeVisible();
  await trainer.getByRole('button', { name: '▶ Прослушать', exact: true }).click();
  await expect.poll(async()=>page.evaluate(()=>(window as any).__referencePlayed.at(-1))).toContain('/audio/');
  for(let i=0;i<4;i++)await trainer.getByRole('button',{name:'Следующий знак',exact:true}).click();
  await trainer.getByRole('button',{name:'Проверить себя',exact:true}).click();
  for(let i=0;i<5;i++){
    await expect(trainer.locator('figcaption')).toHaveCount(0);
    await trainer.getByRole('button',{name:'Раскрыть карточку',exact:true}).click();
    await expect(trainer.locator('figcaption')).toBeVisible();
    await trainer.getByRole('button',{name:/^Хорошо/}).click();
    await expect.poll(async()=>Number((await database.sql`select count(*)::int as count from kana_attempts where user_id=${userId}`)[0].count)).toBe(i+1);
  }
  await expect(trainer.getByRole('heading',{name:'Карточки пройдены'})).toBeVisible();
  expect(submissions.length).toBe(beforePosts);expect(await cards()).toEqual(beforeKana);
  expect(await database.sql`select 1 from kana_states where user_id=${userId}`).toHaveLength(5);
  report.kana={selectedRow:'あ行',solved:5,separateFsrsCards:5,realPlayback:true,introductionAndAnswerCaptions:true};
  await trainer.getByRole('button', { name: 'Закрыть', exact: true }).click();
  await page.getByLabel('Выберите конструкцию', { exact: true }).selectOption(exercise.skillId);
  const skillVersionBefore = Number((await database.sql`select version from review_states where user_id=${userId} and item_id=${exercise.skillId} and mode='grammar'`)[0]!.version);
  const lessonBefore = await database.sql`select * from learning_states where user_id=${userId}`;
  await page.getByTestId('train-construction').click();
  const skip = page.getByRole('button', { name: /Перейти к занятию/ }); if (await skip.isVisible()) await skip.click();
  await expect(page.getByRole('navigation', { name: 'Разделы', exact: true }).getByRole('button', { name: 'Тренировки', exact: true })).toHaveAttribute('aria-current','page');
  const drill = page.getByTestId('construction-drill'); await expect(drill).toHaveAttribute('data-format', 'ja-ru');
  await drill.getByTestId('card-face').click(); await expect(drill.locator('.answer')).toBeVisible();
  loseGradeAck = true; await drill.getByTestId('review-gesture').press('ArrowRight');
  await expect(drill.getByRole('button', { name: 'Повторить сохранение', exact: true })).toBeVisible(); await expect(drill).toHaveAttribute('data-format', 'ja-ru');
  const attemptsBefore = await database.sql`select attempt_id from review_attempts where user_id=${userId}`;
  await drill.getByRole('button', { name: 'Повторить сохранение', exact: true }).click();
  await expect(drill).toHaveAttribute('data-format', 'listening'); expect(submissions.at(-1)).toEqual(submissions.at(-2)); expect(await database.sql`select attempt_id from review_attempts where user_id=${userId}`).toEqual(attemptsBefore);
  await expect.poll(async () => drill.locator('audio').evaluate((audio: HTMLAudioElement) => audio.currentTime)).toBeGreaterThan(.03);
  await drill.getByTestId('card-face').click(); await expect(drill.locator('.answer')).toBeVisible(); await drill.getByTestId('review-gesture').press('ArrowRight');
  await expect(page.locator('.bank')).toBeVisible();
  for (const id of exercise.acceptedOrders[0]!) await page.locator(`.bank [data-token-id="${id}"]`).click();
  await expect(page.locator('[data-outcome="correct"]').first()).toBeVisible();
  await workspaceNext(page).click();
  await expect(page.getByRole('heading', { name: /Порция пройдена|Колода пройдена/ })).toBeVisible();
  expect(await database.sql`select * from learning_states where user_id=${userId}`).toEqual(lessonBefore);
  expect([...await database.sql`select mode,version from review_states where user_id=${userId} and item_id=${exercise.skillId}`]).toEqual([{ mode: 'grammar', version: skillVersionBefore + 1 }]);
  report.construction = { formats: ['ja-ru', 'listening', 'grammar'], ambiguousAckReplay: true, oneSharedSchedule: true, lessonStateUnchanged: true };
  for (const viewport of [{ width: 1280, height: 720 }, { width: 390, height: 844 }, { width: 320, height: 568 }]) { await page.setViewportSize(viewport); await reachable(page); }
  expect(errors).toEqual([]); report.green = true; report.errors = errors;
  await page.screenshot({ path: `${output}/reference-training-final.png`, fullPage: true }); await Bun.write(`${output}/reference-training-green.json`, JSON.stringify(report, null, 2)); console.info(JSON.stringify(report));
} catch (error) { await page.screenshot({ path: `${output}/reference-training-red.png`, fullPage: true }).catch(() => {}); throw error; }
finally { await context.close(); await browser.close(); if (userId) await database.sql`delete from users where id=${userId}`; await database.sql`delete from access_links where email=${email}`; await database.sql.close(); }
