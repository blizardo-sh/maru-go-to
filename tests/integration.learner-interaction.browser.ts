import { createServer } from 'vite';
import react from '@vitejs/plugin-react';
import { chromium, expect, type Page } from '@playwright/test';
import { learningFixture } from './helpers/learning-fixture';
import { defaultSettings } from '../src/server/material';
import { defaultCatalog } from '../src/shared/catalog';
import { counterTarget, makeCounterCard } from '../src/shared/counters';
import { counterAudio } from '../src/server/counter-audio';
import type { ReviewItem, ReviewSubmission } from '../src/shared/types';
import type { LearningAdvance, LearningState } from '../src/shared/learning';

// Actual components, synthetic queues and ACKs; no account, database or running preview is touched.
const course = learningFixture(), words = ['ひと', 'ほん'].map(kana => course.words.find(word => word.kana === kana)!);
const counterItem = (index: number, kind: 'image-counter' | 'recall' = 'image-counter'): ReviewItem => {
  const word = words[index]!, targetId = counterTarget(index ? 'satsu' : 'nin', kind, kind === 'recall' ? 3 : null);
  return { id: `counter:${targetId}:fixture${index}`, targetId, mode: 'counter', version: 0, due: '2026-10-22T00:00:00Z', isNew: true, counter: makeCounterCard(targetId, word.id, words, `fixture-${index}`)! };
};
const items = [counterItem(0), counterItem(1)];
const server = await createServer({ root: new URL('..', import.meta.url).pathname, configFile: false, plugins: [react(), { name: 'isolated-interaction-fixture', configureServer(server) { server.middlewares.use(async (request, response, next) => {
  if (request.url?.startsWith('/__interaction-data')) { response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify({ course, settings: { ...defaultSettings, animations: false, sceneSoundEnabled: false }, lists: [], progress: { counters: [], introducedWordIds: words.map(word => word.id), introducedSkillIds: [], byMode: {} } })); }
  else if (request.url?.split('?')[0] === '/interaction') { response.setHeader('Content-Type', 'text/html'); response.end(await server.transformIndexHtml('/interaction', '<!doctype html><html lang="ru"><div id="root"></div><script type="module" src="/tests/helpers/learner-interaction-fixture.tsx"></script></html>')); }
  else next();
}); } }], logLevel: 'error', server: { host: '127.0.0.1', port: 0, strictPort: true } });
await server.listen(); const address = server.httpServer!.address(); if (!address || typeof address === 'string') throw new Error('Missing fixture port');
const browser = await chromium.launch({ channel: 'chrome', headless: true });
async function visibility(page: Page, hidden: boolean) { await page.evaluate(hidden => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden }); document.dispatchEvent(new Event('visibilitychange')); }, hidden); }
async function swipe(page: Page, direction: -1 | 1) { const box = await page.getByTestId('review-gesture').boundingBox(); if (!box) throw new Error('Missing paper'); const x = box.x + box.width / 2, y = box.y + 25; await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.move(x + direction * 100, y, { steps: 6 }); await page.mouse.up(); }
const checks: string[] = [];
const selected = (name: string) => !process.env.INTERACTION_CASES || process.env.INTERACTION_CASES.split(',').includes(name);
try {
  for (const name of ['correct', 'wrong', 'authoritative-wrong', 'helped', 'slow-ack', 'lost-ack', 'inactive', 'hidden', 'unmount', 'owner', 'recall', 'recall-390', 'recall-320', 'word-recall', 'word-recall-390', 'word-recall-320', 'listening', 'accepted-alternative', 'builder', 'builder-exploration'].filter(selected)) {
    const context = await browser.newContext({ viewport: { width: name.endsWith('-390') ? 390 : name.endsWith('-320') ? 320 : 1280, height: 900 }, reducedMotion: 'reduce' }), page = await context.newPage(), submissions: ReviewSubmission[] = [], errors: string[] = [];
    page.setDefaultTimeout(6000); page.on('pageerror', error => errors.push(error.message));
    let release: (() => void) | undefined;
    const held = ['slow-ack', 'inactive', 'hidden', 'unmount', 'owner'].includes(name);
    let queue = items;
    if (name.startsWith('recall')) queue = [counterItem(0, 'recall'), items[1]!];
    if (name.startsWith('word-recall')) queue = words.map((word, index) => ({ id: `word-${index}`, targetId: word.id, mode: 'ja-ru', version: 0, due: '2026-10-22T00:00:00Z', isNew: false, word }));
    if (name === 'listening') { const first = counterItem(0); if (first.mode !== 'counter') throw new Error('Counter fixture'); const targetId = counterTarget('nin', 'listening-image', 2); queue = [{ ...first, id: `counter:${targetId}:fixture0`, targetId, counter: { ...makeCounterCard(targetId, words[0]!.id, words, 'listening')!, audioUrl: counterAudio(first.counter.definition, 2) } }, items[1]!]; }
    if (name === 'accepted-alternative') { const egg = course.words.find(word => word.kana === 'たまご')!, targetId = counterTarget('ko', 'image-counter', null); queue = [{ id: `counter:${targetId}:fixture0`, targetId, mode: 'counter', version: 0, due: '2026-10-22T00:00:00Z', isNew: true, counter: makeCounterCard(targetId, egg.id, [egg, ...words], 'alternative')! }, items[1]!]; }
    if (name.startsWith('builder')) { const exercise = course.exercises[0]!, skill = course.skills.find(skill => skill.id === exercise.skillId)!; queue = [{ id: 'grammar-fixture', targetId: skill.id, mode: 'grammar', version: 0, due: '2026-10-22T00:00:00Z', isNew: true, exercise, skill }]; }
    const first = queue[0]!;
    await context.route('**/api/training?counters=true', route => route.fulfill({ json: { items: queue, remainingDue: 0, remainingNew: queue.length } }));
    await context.route(url => url.pathname.startsWith('/api/reviews'), async route => {
      if (new URL(route.request().url()).pathname === '/api/reviews/evaluate') { const request = route.request().postDataJSON(); const exercise = course.exercises[0]!; await route.fulfill({ json: { revision: request.revision, outcome: request.tokenIds.length === exercise.tokens.length ? 'correct' : 'incomplete', feedback: 'Synthetic prepared evaluation' } }); return; }
      if (route.request().method() === 'GET') { await route.fulfill({ json: { items: queue, remainingDue: queue.length, remainingNew: 0 } }); return; }
      const submission = route.request().postDataJSON() as ReviewSubmission; submissions.push(submission);
      if (name === 'lost-ack' && submissions.length === 1) { await route.fulfill({ status: 503, json: { error: { message: 'Synthetic lost ACK' } } }); return; }
      if (held && submissions.length === 1) await new Promise<void>(resolve => { release = resolve; });
      await route.fulfill({ json: { attemptId: submission.attemptId, status: 'scheduled', version: 1, nextDue: '2026-10-24T00:00:00Z', correct: name !== 'authoritative-wrong' && submission.rating === 3 } });
    });
    await context.route('**/api/analyze', route => { const request = route.request().postDataJSON(); return route.fulfill({ json: { text: request.text, revision: request.revision, status: 'unavailable', reason: 'Isolated fixture' } }); });
    try {
      await page.goto(`http://127.0.0.1:${address.port}/interaction${name.startsWith('word-recall') ? '?source=review' : ''}`);
      const paper = page.getByTestId('review-gesture'); await expect(paper).toHaveAttribute('data-review-id', first.id);
      if (name.startsWith('builder')) {
        if (first.mode !== 'grammar') throw new Error('Grammar fixture'); await expect(paper).toHaveAttribute('data-card-phase', 'workspace'); await expect(page.locator('.workspace-next')).toBeDisabled();
        if (name === 'builder') { for (const id of first.exercise.acceptedOrders[0]!) await page.locator(`.bank [data-token-id=${JSON.stringify(id)}]`).click(); await expect(page.locator('[data-outcome=correct]').first()).toBeVisible(); }
        else { await page.getByLabel('Действия карточки', { exact: true }).click(); await page.getByRole('button', { name: 'Ввести фразу', exact: true }).click(); await page.getByRole('textbox', { name: 'Ваша фраза', exact: true }).fill('こんにちは。'); await page.getByLabel('Закрыть редактор', { exact: true }).click(); await expect(page.locator('[data-outcome=exploration]').first()).toBeVisible(); }
        await expect(page.locator('.workspace-next')).toBeEnabled(); await paper.press('ArrowRight'); await swipe(page, 1); expect(submissions).toHaveLength(0); await page.locator('.workspace-next').click(); await expect(page.getByTestId('portion-complete')).toBeVisible(); expect(submissions).toHaveLength(name === 'builder' ? 1 : 0); expect(errors).toEqual([]); checks.push(name); continue;
      }
      if (name.startsWith('recall') || name.startsWith('word-recall')) {
        await expect(paper).toHaveAttribute('data-card-phase', 'question');
        await expect(paper.locator('.flip-back')).toBeHidden();
        expect(await paper.locator('.flip-back').evaluate(element => { const previous = document.activeElement, control = element.querySelector<HTMLElement>('button,[tabindex]'); control?.focus(); return element instanceof HTMLElement && element.inert && element.getAttribute('aria-hidden') === 'true' && getComputedStyle(element).visibility === 'hidden' && document.activeElement === previous; })).toBe(true);
        expect(await paper.ariaSnapshot()).not.toContain(first.mode === 'counter' ? first.counter.answer.kana : first.mode === 'ja-ru' ? first.word.meaningRu : 'impossible fixture');
        expect(await paper.evaluate(element => getComputedStyle(element).backgroundImage)).toContain('repeating-linear-gradient');
        await page.evaluate(() => document.fonts.ready); await swipe(page, 1); await paper.press('ArrowRight'); expect(submissions).toHaveLength(0);
        await expect(paper).toHaveAttribute('data-card-phase', 'question'); const board = await page.locator('.session-board').boundingBox(), paperBefore = await paper.boundingBox(), hintBefore = await paper.locator('.gesture-footer').boundingBox(); await page.keyboard.press('Enter');
        await expect(paper).toHaveAttribute('data-card-phase', 'answer'); expect(submissions).toHaveLength(0); expect(await page.locator('.session-board').boundingBox()).toEqual(board); expect(await paper.boundingBox()).toEqual(paperBefore); expect(await paper.locator('.gesture-footer').boundingBox()).toEqual(hintBefore);
        await expect(paper.getByText('Влево — ещё раз, вправо — помню', { exact: false })).toBeVisible();
        expect(await paper.evaluate(element => getComputedStyle(element).backgroundImage)).not.toContain('repeating-linear-gradient');
        await expect(page.getByRole('button', { name: 'Помню ✓', exact: true })).toHaveCount(0);
        if (name.endsWith('-390') || name.endsWith('-320')) {
          const menu = paper.getByLabel('Действия карточки', { exact: true }); await menu.scrollIntoViewIfNeeded();
          expect(await menu.evaluate(element => { const box = element.getBoundingClientRect(), hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2); return box.height >= 44 && !!hit && (element === hit || element.contains(hit)); })).toBe(true);
          await menu.click(); const grade = paper.getByRole('button', { name: 'Вспомнил — дальше', exact: true }); await expect(grade).toBeEnabled(); await grade.click();
        } else await swipe(page, 1);
      } else {
        if (first.mode !== 'counter') throw new Error('Expected counter');
        if (name === 'helped') { await page.getByRole('button', { name: 'Полное правило ↗', exact: true }).click(); await page.getByLabel('Закрыть правило', { exact: true }).click(); }
        if (name === 'listening') await expect(page.locator('[data-choice="2"]')).toBeEnabled();
        const key = name === 'wrong' ? first.counter.options.find(option => !first.counter.acceptedKeys.includes(option.key))!.key : name === 'accepted-alternative' ? first.counter.acceptedKeys.find(key => key !== first.counter.definition.id)! : first.counter.acceptedKeys[0]!;
        await page.locator(`[data-choice=${JSON.stringify(key)}]`).click();
        await expect(paper).toHaveAttribute('data-card-phase', 'choice'); await expect(page.getByRole('button', { name: 'Вспомнил — дальше', exact: true })).toHaveCount(0);
      }
      await expect.poll(() => submissions.length).toBe(1);
      if (held) {
        await expect(paper).toHaveAttribute('data-review-id', first.id); await paper.press('ArrowRight'); expect(submissions).toHaveLength(1);
        await expect(page.getByTestId('counter-answer')).toBeHidden(); expect(await page.locator('.flip-back').evaluate(element => element instanceof HTMLElement && element.inert && element.getAttribute('aria-hidden') === 'true')).toBe(true); await expect(page.locator('.flip-card')).toHaveAttribute('data-revealed', 'false'); await expect(page.locator('[data-choice][aria-pressed=true]')).toHaveCount(1);
        if (name === 'inactive') await page.getByRole('button', { name: 'Toggle active' }).click();
        if (name === 'hidden') await visibility(page, true);
        if (name === 'unmount') await page.getByRole('button', { name: 'Unmount session' }).click();
        if (name === 'owner') await page.getByRole('button', { name: 'Switch owner' }).click();
        release?.();
        if (name === 'unmount' || name === 'owner') { await page.waitForTimeout(1100); await expect(page.getByTestId('saved-count')).toHaveText('0'); expect(errors).toEqual([]); checks.push(name); continue; }
        if (name === 'inactive' || name === 'hidden') { await page.waitForTimeout(1100); await expect(paper).toHaveAttribute('data-review-id', first.id); if (name === 'hidden') await visibility(page, false); else await page.getByRole('button', { name: 'Toggle active' }).click(); }
        await expect(page.getByTestId('counter-confirmed')).toBeVisible(); await page.waitForTimeout(200); await expect(paper).toHaveAttribute('data-review-id', first.id);
      }
      if (name === 'lost-ack') { await expect(page.getByRole('button', { name: 'Повторить сохранение', exact: true })).toBeVisible(); await expect(paper).toHaveAttribute('data-review-id', first.id); await page.getByRole('button', { name: 'Повторить сохранение', exact: true }).click(); await expect.poll(() => submissions.length).toBe(2); expect(submissions[1]).toEqual(submissions[0]); }
      await expect(paper).toHaveAttribute('data-review-id', queue[1]!.id);
      const again = ['wrong', 'helped', 'authoritative-wrong'].includes(name);
      await expect(page.getByTestId('card-deck')).toHaveAttribute('data-remaining', again ? '2' : '1');
      await expect(page.getByRole('progressbar', { name: 'Прогресс занятия' })).toHaveAttribute('value', again ? '0' : '1');
      if (name !== 'authoritative-wrong') expect(submissions[0]!.rating).toBe(again ? 1 : 3);
      expect(errors).toEqual([]); checks.push(name);
    } finally { release?.(); await context.close(); }
    console.info(`PASS ${name}`);
  }
  for (const name of ['guided-invalid-choice', 'guided-hidden-ack', 'guided-recall'].filter(selected)) {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } }), page = await context.newPage(), submissions: LearningAdvance[] = [];
    const route = course.learning[0]!, wordIds = course.words.filter(word => word.lessonIds.includes(route.lessonId)).slice(0, 4).map(word => word.id), goal = route.goals[0]!, part = goal.parts[0]!;
    const initial: LearningState = { lessonId: route.lessonId, routeVersion: route.version, version: 0, completedSteps: 0, totalSteps: 12, partIndex: 0, totalParts: 2, completed: false, step: { kind: 'word-practice', id: 'guided-first', goalId: goal.id, partId: part.id, wordId: wordIds[0]!, mode: 'ja-ru' }, ...(name === 'guided-recall' ? {} : { wordChoices: wordIds }) };
    let state = initial, gets = 0, release: (() => void) | undefined;
    await context.route('**/api/learning/**', async route => {
      if (route.request().method() === 'GET') { gets++; await route.fulfill({ json: state }); return; }
      const submission = route.request().postDataJSON() as LearningAdvance; submissions.push(submission);
      if (name === 'guided-invalid-choice' && submissions.length === 1) { await route.fulfill({ status: 400, json: { error: { code: 'INVALID_CHOICE', message: 'Choices changed' } } }); return; }
      if (name === 'guided-hidden-ack') await new Promise<void>(resolve => { release = resolve; });
      state = { ...initial, version: 1, completedSteps: 1, step: { ...initial.step!, id: 'guided-second' } };
      await route.fulfill({ json: { attemptId: submission.attemptId, state, reviewResult: { attemptId: submission.attemptId, status: 'scheduled', version: 1, nextDue: '2026-10-24T00:00:00Z', correct: true } } });
    });
    try {
      await page.goto(`http://127.0.0.1:${address.port}/interaction?guided`); const session = page.getByTestId('guided-learning'); await expect(session).toHaveAttribute('data-step-id', 'guided-first');
      if (name === 'guided-recall') { const paper = page.getByTestId('review-gesture'); await expect(paper).toHaveAttribute('data-card-phase', 'question'); await paper.press('ArrowRight'); expect(submissions).toHaveLength(0); await paper.press('Enter'); await expect(paper).toHaveAttribute('data-card-phase', 'answer'); expect(submissions).toHaveLength(0); await paper.press('ArrowRight'); }
      else await page.locator(`[data-choice-word-id=${JSON.stringify(wordIds[0])}]`).click();
      if (name === 'guided-invalid-choice') { await expect.poll(() => gets).toBe(2); await expect(page.getByRole('button', { name: 'Повторить сохранение', exact: true })).toHaveCount(0); expect(await page.evaluate(() => JSON.parse(localStorage.getItem('japanese-pending-learning:00000000-0000-4000-8000-000000000001') ?? '[]'))).toEqual([]); await expect(page.getByTestId('saved-count')).toHaveText('0'); await page.locator(`[data-choice-word-id=${JSON.stringify(wordIds[0])}]`).click(); }
      if (name === 'guided-hidden-ack') { await expect.poll(() => submissions.length).toBe(1); await expect(page.getByTestId('learning-word-quiz')).toHaveAttribute('data-feedback', 'neutral'); await visibility(page, true); release?.(); await page.waitForTimeout(1000); await expect(session).toHaveAttribute('data-step-id', 'guided-first'); await visibility(page, false); }
      await expect(session).toHaveAttribute('data-step-id', 'guided-second'); expect(submissions).toHaveLength(name === 'guided-invalid-choice' ? 2 : 1); checks.push(name); console.info(`PASS ${name}`);
    } finally { release?.(); await context.close(); }
  }
  for (const name of ['guided-publication-word', 'guided-publication-counter'].filter(selected)) {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } }), page = await context.newPage();
    const publicationA = 'a'.repeat(64), publicationB = 'b'.repeat(64), lessonRoute = course.learning[0]!, goal = lessonRoute.goals[0]!, part = goal.parts[0]!, wordIds = course.words.filter(word => word.lessonIds.includes(lessonRoute.lessonId)).slice(0, 4).map(word => word.id);
    const first: LearningState = { lessonId: lessonRoute.lessonId, publicationId: publicationA, routeVersion: lessonRoute.version, version: 0, completedSteps: 0, totalSteps: 12, partIndex: 0, totalParts: 2, completed: false, step: name.endsWith('counter') ? { kind: 'counter-practice', id: 'publication-first', goalId: goal.id, partId: part.id, counterId: 'nin', quantity: 1, wordId: words[0]!.id } : { kind: 'word-practice', id: 'publication-first', goalId: goal.id, partId: part.id, wordId: wordIds[0]!, mode: 'ja-ru' }, ...(name.endsWith('counter') ? { reviewItem: { ...items[0]!, publicationId: publicationA } } : { wordChoices: wordIds }) };
    const next: LearningState = { ...first, publicationId: publicationB, routeVersion: 'published-route-b', version: 1, completedSteps: 1, step: { kind: 'word-intro', id: 'publication-next', goalId: goal.id, partId: part.id, wordId: wordIds[0]! } };
    const newer = structuredClone(course); newer.publicationId = publicationB; newer.learning[0]!.version = next.routeVersion; newer.learning[0]!.titleRu = 'Новая публикация'; const target = newer.words.find(word => word.id === wordIds[0])!; target.meaningRu = 'Новое значение публикации';
    let release: (() => void) | undefined, input: LearningAdvance | undefined, postHeader: string | undefined, bootstrapB = 0;
    await context.route('**/api/bootstrap', route => { const publication = route.request().headers()['x-content-publication']; if (publication === publicationB) bootstrapB++; return route.fulfill({ json: { course: publication === publicationB ? newer : { ...course, publicationId: publicationA }, settings: { ...defaultSettings, animations: false }, lists: [], progress: { counters: [], introducedWordIds: [], introducedSkillIds: [], byMode: {} } } }); });
    await context.route('**/api/learning/**', async route => { if (route.request().method() === 'GET') { await route.fulfill({ json: first }); return; } input = route.request().postDataJSON() as LearningAdvance; postHeader = route.request().headers()['x-content-publication']; await new Promise<void>(resolve => { release = resolve; }); await route.fulfill({ json: { attemptId: input.attemptId, state: next, reviewResult: { publicationId: publicationA, attemptId: input.attemptId, status: 'scheduled', version: 1, nextDue: '2026-10-24T00:00:00Z', correct: true } } }); });
    try {
      await page.goto(`http://127.0.0.1:${address.port}/interaction?guided`); const session = page.getByTestId('guided-learning'); await expect(session).toHaveAttribute('data-step-id', first.step!.id);
      if (name.endsWith('counter')) await page.locator('[data-choice="nin"]').click(); else await page.locator(`[data-choice-word-id=${JSON.stringify(wordIds[0])}]`).click();
      await expect.poll(() => !!input).toBe(true); expect(input!.publicationId).toBe(publicationA); expect(postHeader).toBe(publicationA); await expect(session).toHaveAttribute('data-step-id', first.step!.id); expect(bootstrapB).toBe(0);
      if (name.endsWith('counter')) await expect(page.getByTestId('counter-answer')).toBeHidden();
      release?.(); await expect.poll(() => bootstrapB).toBe(1); await expect(session).toHaveAttribute('data-step-id', first.step!.id); await expect(page.getByText('Новая публикация', { exact: true })).toHaveCount(0);
      if (name.endsWith('counter')) await expect(page.getByTestId('counter-confirmed')).toBeVisible(); else await expect(page.getByTestId('learning-word-quiz')).toHaveAttribute('data-feedback', 'good');
      await expect(session).toHaveAttribute('data-step-id', next.step!.id); await expect(page.getByRole('heading', { name: 'Новая публикация', exact: true })).toBeVisible(); await expect(page.locator('.word-meaning').filter({ hasText: 'Новое значение публикации' })).toBeVisible();
      checks.push(name); console.info(`PASS ${name}`);
    } finally { release?.(); await context.close(); }
  }
  if (selected('session-publication')) {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } }), page = await context.newPage(), publicationA = 'a'.repeat(64), publicationB = 'b'.repeat(64);
    const courseA = { ...structuredClone(course), publicationId: publicationA, catalog: structuredClone(defaultCatalog) }, courseB = { ...structuredClone(course), publicationId: publicationB, catalog: structuredClone(defaultCatalog) };
    courseA.catalog.counterAtlas!.src = '/content/a/atlas.webp'; courseB.catalog.counterAtlas!.src = '/content/b/atlas.webp';
    const snapshot = (course: typeof courseA) => ({ course, settings: { ...defaultSettings, animations: false }, lists: [], progress: { counters: [], introducedWordIds: words.map(word => word.id), introducedSkillIds: [], byMode: {} } });
    let active = courseA, release: (() => void) | undefined, submissions: ReviewSubmission[] = [];
    await context.route('**/__interaction-data', route => route.fulfill({ json: snapshot(courseA) }));
    await context.route('**/__next-publication-data', route => route.fulfill({ json: snapshot(courseB) }));
    await context.route('**/api/bootstrap', route => route.fulfill({ json: snapshot(active) }));
    await context.route('**/api/training?counters=true', route => { expect(route.request().headers()['x-content-publication']).toBe(active.publicationId); return route.fulfill({ json: { items: [{ ...items[0]!, publicationId: active.publicationId }], remainingDue: 0, remainingNew: 0 } }); });
    await context.route('**/api/reviews', async route => { const input = route.request().postDataJSON() as ReviewSubmission; submissions.push(input); expect(input.publicationId).toBe(submissions.length === 1 ? publicationA : publicationB); expect(route.request().headers()['x-content-publication']).toBe(input.publicationId); if (submissions.length === 1) await new Promise<void>(resolve => { release = resolve; }); await route.fulfill({ json: { attemptId: input.attemptId, status: 'scheduled', version: 1, correct: true, nextDue: '2026-10-24T00:00:00Z' } }); });
    try {
      page.setDefaultTimeout(6000); await page.goto(`http://127.0.0.1:${address.port}/interaction`);
      await expect(page.locator('.counter-picture image').first()).toHaveAttribute('href', '/content/a/atlas.webp'); await page.locator('[data-choice="nin"]').click(); await expect.poll(() => submissions.length).toBe(1);
      active = courseB; await page.getByRole('button', { name: 'Refresh publication', exact: true }).click(); await expect(page.locator('.counter-picture image').first()).toHaveAttribute('href', '/content/a/atlas.webp'); release?.();
      await expect(page.getByTestId('portion-complete')).toBeVisible(); await page.getByRole('button', { name: 'Продолжить', exact: true }).click(); await expect(page.locator('.counter-picture image').first()).toHaveAttribute('href', '/content/b/atlas.webp');
      await page.locator('[data-choice="nin"]').click(); await expect(page.getByTestId('portion-complete')).toBeVisible(); expect(submissions).toHaveLength(2); checks.push('session-publication'); console.info('PASS session-publication');
    } finally { release?.(); await context.close(); }
  }
  for (const event of ['online', 'focus'].filter(event => selected(`app-replay-${event}`))) {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } }), page = await context.newPage(), submissions: LearningAdvance[] = [], errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    const user = { id: '00000000-0000-4000-8000-000000000001', email: 'fixture@example.test', name: 'Synthetic learner', isAdmin: false }, route = course.learning[0]!;
    const key = `japanese-pending-learning:${user.id}`, otherKey = 'japanese-pending-learning:another-owner';
    const stale = { lessonId: route.lessonId, submission: { attemptId: crypto.randomUUID(), routeVersion: route.version, stateVersion: 0, stepId: 'stale-choice', action: 'choose' as const, choiceWordId: 'old-option' } }, remaining = { lessonId: route.lessonId, submission: { attemptId: crypto.randomUUID(), routeVersion: route.version, stateVersion: 0, stepId: 'legitimate-remaining', action: 'continue' as const } };
    let courseGets = 0;
    await context.route('**/api/**', async request => {
      const path = new URL(request.request().url()).pathname;
      if (path.endsWith('/advance')) { const input = request.request().postDataJSON() as LearningAdvance; submissions.push(input); if (input.attemptId === stale.submission.attemptId) await request.fulfill({ status: 400, json: { error: { code: 'INVALID_CHOICE', message: 'Choices changed' } } }); else await request.fulfill({ json: { attemptId: input.attemptId, state: { lessonId: route.lessonId, routeVersion: route.version, version: 1 } } }); return; }
      if (path === '/api/bootstrap') courseGets++;
      const counts = { due: 0, learned: 0, reviewedToday: 0 };
      const progress = { counters: [], introducedWordIds: [], introducedSkillIds: [], completedLessons: 0, totalLessons: 18, wordsIntroducedToday: 0, skillsIntroducedToday: 0, byMode: { 'ja-ru': counts, 'ru-ja': counts, listening: counts, grammar: counts, counter: counts } };
      await request.fulfill({ json: path === '/api/bootstrap' ? { course, settings: { ...defaultSettings, sceneSoundEnabled: false }, progress, lists: [], learning: [] } : path === '/api/me' ? user : path === '/api/course' ? course : path === '/api/settings' ? { ...defaultSettings, sceneSoundEnabled: false } : path === '/api/progress' ? { counters: [], introducedWordIds: [], introducedSkillIds: [], completedLessons: 0, totalLessons: 18, wordsIntroducedToday: 0, skillsIntroducedToday: 0, byMode: { 'ja-ru': counts, 'ru-ja': counts, listening: counts, grammar: counts, counter: counts } } : path === '/api/lists' ? { lists: [] } : { lessons: [] } });
    });
    try {
      await page.goto(`http://127.0.0.1:${address.port}/interaction?app`); await expect(page.getByRole('heading', { name: 'Учебник', exact: true })).toBeVisible(); const before = courseGets;
      await page.evaluate(({ key, otherKey, pending, event }) => { localStorage.setItem(key, JSON.stringify(pending)); localStorage.setItem(otherKey, JSON.stringify([pending[1]])); window.dispatchEvent(new Event(event)); }, { key, otherKey, pending: [stale, remaining], event });
      await expect.poll(() => submissions.length, { timeout: 3000 }).toBe(2); expect(submissions).toEqual([stale.submission, remaining.submission]); await expect.poll(() => courseGets).toBeGreaterThan(before);
      expect(await page.evaluate(key => JSON.parse(localStorage.getItem(key) ?? '[]'), key)).toEqual([]); expect(await page.evaluate(key => JSON.parse(localStorage.getItem(key) ?? '[]'), otherKey)).toEqual([remaining]); await expect(page.getByText('На этом устройстве ждут сохранения ответы:', { exact: false })).toHaveCount(0); expect(errors).toEqual([]); checks.push(`app-replay-${event}`); console.info(`PASS app-replay-${event}`);
    } finally { await context.close(); }
  }
  console.info(JSON.stringify({ checks, realComponents: true, databaseAccess: false, productionRequests: 0 }));
} finally { await browser.close(); await server.close(); }
