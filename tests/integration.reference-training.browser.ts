import { chromium, expect, type Page } from '@playwright/test';
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
  for (const id of ids) if (course.words.find(word => word.id === id)!.reviewStatus !== 'draft') expect((await context.request.post(base + '/api/reviews', { headers: headers(), data: { attemptId: crypto.randomUUID(), reviewId: reviewId('ja-ru', id), version: 0, mode: 'ja-ru', rating: 3 } })).status()).toBe(200);
  expect((await context.request.post(base + '/api/reviews', { headers: headers(), data: { attemptId: crypto.randomUUID(), reviewId: reviewId('grammar', exercise.skillId, exercise.id), version: 0, mode: 'grammar', tokenIds: exercise.acceptedOrders[0], revealed: false, rating: 3 } })).status()).toBe(200);
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
  await navigate('Повторение'); const types = page.getByTestId('repeat-types'); await expect(types.getByRole('checkbox')).toHaveCount(3);
  for (const checkbox of await types.getByRole('checkbox').all()) await expect(checkbox).toBeChecked();
  failSettings = true; await types.getByRole('checkbox', { name: /Счётные суффиксы/ }).uncheck();
  await expect(page.getByRole('button', { name: 'Повторить сохранение выбора', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: /Начать повторение/ })).toBeDisabled(); expect((await settings()).repeatTypes).toContain('counters');
  await page.getByRole('button', { name: 'Повторить сохранение выбора', exact: true }).click(); await expect.poll(async () => (await settings()).repeatTypes.includes('counters')).toBe(false);
  await page.reload(); await navigate('Повторение'); await expect(types.getByRole('checkbox', { name: /Счётные суффиксы/ })).not.toBeChecked();
  for (const label of [/Слова/, /Конструкции/]) { await types.getByRole('checkbox', { name: label }).uncheck(); await expect(types.getByRole('checkbox', { name: label })).toBeEnabled(); }
  await expect(page.getByText('Выберите хотя бы один тип материала.', { exact: true })).toBeVisible(); expect((await settings()).repeatTypes).toEqual([]);
  expect((await (await context.request.get(base + '/api/reviews?mode=mixed')).json()).items).toEqual([]); report.repeatSaveFailureAndPersistence = true;

  await navigate('Справочник'); await page.getByRole('button', { name: 'Хирагана', exact: true }).click(); await page.getByTestId('train-kana').click();
  const trainer = page.getByTestId('kana-trainer'); await trainer.getByRole('checkbox', { name: 'Вся азбука', exact: true }).uncheck();
  await trainer.locator('.kana-row-picker label').filter({ hasText: 'あ行' }).getByRole('checkbox').check();
  const beforeKana = await cards(), beforePosts = submissions.length;
  const manifest: KanaAudioManifest = await (await context.request.get(base + '/audio/kana-manifest.json')).json();
  await trainer.getByRole('button', { name: /Начать колоду/ }).click();
  const formats = new Set<string>(); let solved = 0;
  while (solved < 10) {
    const question = trainer.getByTestId('kana-question'); await expect(question).toBeVisible(); const format = (await question.getAttribute('data-format'))!; formats.add(format);
    const options = question.getByRole('group', { name: 'Варианты ответа' }).getByRole('button'); let answer;
    if (format === 'reading') {
      const kana = (await question.locator('.kana-glyph').innerText()).trim(), reading = basicKana[0]!.cells.find(cell => cell?.kana === kana)!.reading;
      answer = options.filter({ hasText: new RegExp('^' + reading + '$') });
    } else {
      await expect(options.first()).toBeEnabled();
      const played: string = await page.evaluate(() => (window as any).__referencePlayed.at(-1)); expect(played).toContain('/audio/');
      const candidates = await options.allTextContents(); const correct = candidates.find(kana => { const entry = manifest.entries[kana.trim()]; return entry && 'audioUrl' in entry && new URL(entry.audioUrl, base).pathname === new URL(played).pathname; }); expect(correct).toBeDefined();
      const keys = candidates.map(kana => manifest.entries[kana.trim()]!.soundKey); expect(new Set(keys).size).toBe(keys.length);
      answer = options.filter({ hasText: correct!.trim() });
    }
    await answer.click(); solved++; await expect(trainer.getByRole('progressbar')).toHaveAttribute('value', String(solved));
  }
  await expect(trainer.getByRole('heading', { name: 'Колода пройдена' })).toBeVisible(); expect([...formats].sort()).toEqual(['listening', 'reading']); expect(submissions.length).toBe(beforePosts); expect(await cards()).toEqual(beforeKana);
  report.kana = { formats: [...formats], selectedRow: 'あ行', solved, srsPosts: 0, realPlayback: true };
  await trainer.getByRole('button', { name: 'Закрыть', exact: true }).click();
  await page.getByRole('button', { name: 'Изученные конструкции', exact: true }).click();
  const skill = page.locator(`[data-skill-id="${exercise.skillId}"]`); await skill.locator('summary').click();
  const lessonBefore = await database.sql`select * from learning_states where user_id=${userId}`;
  await skill.getByTestId('train-construction').click();
  const skip = page.getByRole('button', { name: /Перейти к занятию/ }); if (await skip.isVisible()) await skip.click();
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
  await page.getByTestId('review-gesture').press('ArrowRight');
  await expect(page.getByRole('heading', { name: /Порция пройдена|Колода пройдена/ })).toBeVisible();
  expect(await database.sql`select * from learning_states where user_id=${userId}`).toEqual(lessonBefore);
  expect([...await database.sql`select mode,version from review_states where user_id=${userId} and item_id=${exercise.skillId}`]).toEqual([{ mode: 'grammar', version: 2 }]);
  report.construction = { formats: ['ja-ru', 'listening', 'grammar'], ambiguousAckReplay: true, oneSharedSchedule: true, lessonStateUnchanged: true };
  for (const viewport of [{ width: 1280, height: 720 }, { width: 390, height: 844 }, { width: 320, height: 568 }]) { await page.setViewportSize(viewport); await reachable(page); }
  expect(errors).toEqual([]); report.green = true; report.errors = errors;
  await page.screenshot({ path: `${output}/reference-training-final.png`, fullPage: true }); await Bun.write(`${output}/reference-training-green.json`, JSON.stringify(report, null, 2)); console.info(JSON.stringify(report));
} catch (error) { await page.screenshot({ path: `${output}/reference-training-red.png`, fullPage: true }).catch(() => {}); throw error; }
finally { await context.close(); await browser.close(); if (userId) await database.sql`delete from users where id=${userId}`; await database.sql`delete from access_links where email=${email}`; await database.sql.close(); }
