import { chromium, expect, type BrowserContext, type Page } from '@playwright/test';
import { createApp } from '../src/server/app';
import { connectDatabase } from '../src/server/db';
import { createLink, consumeLink } from '../src/server/auth';
import { loadCourse } from '../src/server/course';
import { defaultSettings, validSegments } from '../src/server/material';
import { nextCard } from '../src/server/reviews';
import { nextFixtureIp } from './helpers/fixture-ip';
import { output } from './helpers/artifact-output';
import type { Progress, ReviewItem, ReviewQueue, ReviewSubmission, WordList } from '../src/shared/types';

const databaseUrl = process.env.JAPANESE_INTEGRATION_DATABASE_URL;
if (!databaseUrl || new URL(databaseUrl).hostname !== '127.0.0.1' || new URL(databaseUrl).pathname !== '/japanese_app_test') throw new Error('Use only disposable localhost japanese_app_test.');
const referenceNoteOnly = process.env.BROWSER_REFERENCE_NOTE_ONLY === 'true';
const functionalOnly = process.env.BROWSER_LEARNING_FUNCTIONAL_ONLY === 'true'; const geometryOnly = process.env.BROWSER_LEARNING_GEOMETRY_ONLY === 'true';
const base = process.env.BROWSER_URL ?? 'http://127.0.0.1:5173';
const database = connectDatabase(databaseUrl); const course = loadCourse();
const provider = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: () => new Response('Fixture quota', { status: 429 }) });
const app = createApp({ database, course, config: { DATABASE_URL: databaseUrl, BETTER_AUTH_SECRET: 'learning-browser-isolated-fixture-secret-over32', APP_URL: base, PORT: 3000, HOST: '127.0.0.1', ANALYSIS_PROVIDER: 'generic', ANALYSIS_URL: `http://127.0.0.1:${provider.port}/chat/completions`, ANALYSIS_MODEL: 'isolated-learning-fixture', ANALYSIS_FREE_ONLY: 'true' } });
const server = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: app.fetch }); const api = `http://127.0.0.1:${server.port}`;
const browser = await chromium.launch({ channel: 'chrome', headless: true }); const emails: string[] = []; const contexts: BrowserContext[] = []; const results: object[] = [];
async function json<T>(context: BrowserContext, path: string): Promise<T> { const response = await context.request.get(`${api}${path}`); expect(response.status()).toBe(200); return response.json(); }
async function progress(context: BrowserContext) { return json<Progress>(context, '/api/progress'); }
async function fixture(name: string) {
  const email = `learning-browser-${crypto.randomUUID()}@example.test`; emails.push(email); const password = 'Isolated-learning-browser-password!';
  const link = await createLink(database, 'invite', email, null); await consumeLink(database, 'invite', link.token, password, name);
  const [actor] = await database.sql`select id from users where email=${email}`;
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, reducedMotion: 'reduce', extraHTTPHeaders: { 'x-forwarded-for': nextFixtureIp() } }); contexts.push(context);
  const page = await context.newPage(); const errors: string[] = []; const queues: ReviewQueue[] = []; const reviews: ReviewQueue[] = []; const submissions: ReviewSubmission[] = []; const languageCalls: string[] = []; let loseAck = false;
  page.on('pageerror', error => errors.push(error.message));
  await context.route('**/api/**', async route => {
    const request = route.request(); const target = new URL(request.url()); target.host = `127.0.0.1:${server.port}`;
    if (request.method() === 'POST' && ['/api/reviews', '/api/reviews/evaluate', '/api/analyze'].includes(target.pathname)) languageCalls.push(target.pathname);
    if (target.pathname === '/api/reviews' && request.method() === 'POST') submissions.push(request.postDataJSON());
    try {
      const response = await route.fetch({ url: target.href });
      if (target.pathname === '/api/training') { expect(response.status()).toBe(200); queues.push(await response.json()); }
      if (target.pathname === '/api/reviews' && request.method() === 'GET') { expect(response.status()).toBe(200); reviews.push(await response.json()); }
      if (target.pathname === '/api/reviews' && request.method() === 'POST' && loseAck) { loseAck = false; expect(response.status()).toBe(200); await route.abort('failed'); return; }
      await route.fulfill({ response });
    } catch { throw new Error(`Isolated fixture transport failed: ${request.method()} ${target.pathname}`); }
  });
  await page.goto(base); await page.getByLabel('Email', { exact: true }).fill(email); await page.getByLabel('Пароль', { exact: true }).fill(password); await page.getByRole('button', { name: 'Войти', exact: true }).click();
  const nav = page.getByRole('navigation', { name: 'Разделы' }); await expect(nav).toBeVisible();
  return { email, actor, context, page, nav, errors, queues, reviews, submissions, languageCalls, loseAck: () => { loseAck = true; } };
}
async function legacySettings(context: BrowserContext, closed = false) {
  const response = await context.request.put(`${api}/api/settings`, { headers: { origin: base }, data: { ...structuredClone(defaultSettings), lessonStatuses: Object.fromEntries(course.lessons.map(lesson => [lesson.id, closed ? 'closed' : 'studying'])), focusLessonIds: [course.lessons[0]!.id], focusSkillIds: ['marugoto.starter-a1.skill.frequency'], focusCanDoIds: [1], newWordsPerDay: 0, newSkillsPerDay: 0 } }); expect(response.status()).toBe(200);
}
async function next(page: Page, previous: string, action = 'ArrowRight') {
  const gesture = page.getByTestId('review-gesture'); if (await gesture.getAttribute('data-mode') === 'grammar') await page.locator('.workspace-next').click(); else { await gesture.focus(); await page.keyboard.press(action); }
  await expect.poll(async () => await page.getByRole('heading', { name: 'Порция пройдена', exact: true }).isVisible() || (await gesture.getAttribute('data-review-id')) !== previous).toBe(true);
}
async function reference(f: Awaited<ReturnType<typeof fixture>>, known: Progress) {
  const calls = f.languageCalls.length; await f.nav.getByRole('button', { name: 'Справочник', exact: true }).click();
  const sections = f.page.getByRole('navigation', { name: 'Разделы справочника' }); await expect(sections).toBeVisible();
  const words = f.page.locator('[data-reference-section="words"]'); await expect(words).toBeVisible(); expect(new Set(await words.locator('[data-word-id]').evaluateAll(elements => elements.map(element => element.getAttribute('data-word-id'))))).toEqual(new Set(known.introducedWordIds)); if (known.introducedWordIds.length) { const first = course.words.find(word => word.id === known.introducedWordIds[0])!; const search = f.page.getByRole('searchbox', { name: 'Найти изученное слово', exact: true }); await search.fill(first.surface); await expect(words.locator(`[data-word-id="${first.id}"]`)).toBeVisible(); await search.clear(); }
  await sections.getByRole('button', { name: 'Изученные конструкции', exact: true }).click(); const skills = f.page.locator('[data-reference-section="skills"]'); expect(new Set(await skills.locator('[data-skill-id]').evaluateAll(elements => elements.map(element => element.getAttribute('data-skill-id'))))).toEqual(new Set(known.introducedSkillIds));
  if (known.introducedSkillIds.length) await skills.locator('[data-skill-id] > summary').first().press('Enter');
  await sections.getByRole('button', { name: 'Частицы', exact: true }).click(); const particles = f.page.locator('[data-reference-section="particles"]'); await expect(particles).toBeVisible(); for (const particle of ['は', 'が', 'を']) await expect(particles.getByText(particle, { exact: true }).first()).toBeVisible();
  const kana: object[] = [];
  for (const [label, key, basic, voiced, stems, small] of [
    ['Хирагана', 'hiragana', 'あいうえおかきくけこさしすせそたちつてとなにぬねのはひふへほまみむめもやゆよらりるれろわをん', 'がぎぐげござじずぜぞだぢづでどばびぶべぼぱぴぷぺぽ', 'きしちにひみりぎじびぴ', ['っ', 'ゃ', 'ゅ', 'ょ']],
    ['Катакана', 'katakana', 'アイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマミムメモヤユヨラリルレロワヲン', 'ガギグゲゴザジズゼゾダヂヅデドバビブベボパピプペポ', 'キシチニヒミリギジビピ', ['ッ', 'ャ', 'ュ', 'ョ']],
  ] as const) {
    await sections.getByRole('button', { name: label, exact: true }).click(); const panel = f.page.locator(`[data-reference-section="${key}"]`); await expect(panel).toBeVisible();
    const read = (group: string) => panel.locator(`[data-kana-group="${group}"] [data-kana]`).evaluateAll(elements => elements.map(element => element.getAttribute('data-kana')));
    expect(new Set(await read('basic'))).toEqual(new Set([...basic])); expect(new Set(await read('voiced'))).toEqual(new Set([...voiced])); const endings = key === 'hiragana' ? ['ゃ', 'ゅ', 'ょ'] : ['ャ', 'ュ', 'ョ']; expect(new Set(await read('yoon'))).toEqual(new Set([...stems].flatMap(stem => endings.map(ending => stem + ending)))); for (const glyph of small) expect(await read('small')).toContain(glyph); if (key === 'katakana') await expect(panel.locator('[data-kana="ヴ"]')).toBeVisible();
    kana.push({ section: key, basic: (await read('basic')).length, voiced: (await read('voiced')).length, yoon: (await read('yoon')).length, small: (await read('small')).length });
  }
  expect(f.languageCalls).toHaveLength(calls); const after = await progress(f.context); expect(after.introducedWordIds).toEqual(known.introducedWordIds); expect(after.introducedSkillIds).toEqual(known.introducedSkillIds); return { learnedWords: known.introducedWordIds.length, learnedSkills: known.introducedSkillIds.length, kana, lookupLanguagePosts: 0 };
}
async function geometry(page: Page) {
  const checks: object[] = []; await page.evaluate(() => document.fonts.ready);
  const fonts = await page.evaluate(() => ({ cyrillic: document.fonts.check('18px Neucha', 'Справочник'), loaded: [...document.fonts].filter(font => font.family.includes('Neucha') && font.status === 'loaded').map(font => ({ family: font.family, unicodeRange: font.unicodeRange })), resources: performance.getEntriesByType('resource').map(entry => entry.name).filter(name => /\.woff2(?:$|\?)/.test(name)) })); expect(fonts.cyrillic).toBe(true); expect(fonts.loaded.length).toBeGreaterThan(0); expect(fonts.resources.length).toBeGreaterThan(0); expect(fonts.resources.every(url => url.startsWith(`${base}/`))).toBe(true);
  for (const [width, height] of [[2663, 1468], [1920, 1080], [1280, 900], [1024, 900], [768, 900], [390, 844], [320, 844]]) {
    await page.setViewportSize({ width: width!, height: height! }); const metrics = await page.getByTestId('review-gesture').evaluate(element => {
      const box = element.getBoundingClientRect(); const cat = document.querySelector('.scene-companion')?.getBoundingClientRect(); const targets = [...element.querySelectorAll('button,input,select,summary,[lang="ja"]')].filter(target => target.getBoundingClientRect().height > 0); const props = [...document.querySelectorAll('.desk-prop')].filter(prop => prop.getBoundingClientRect().height > 0 && getComputedStyle(prop).visibility !== 'hidden' && Number(getComputedStyle(prop).opacity) > 0);
      const textOverlaps: string[] = [];
      for (const region of element.querySelectorAll('.analysis,.analysis-state,.session-feedback')) {
        const walker = document.createTreeWalker(region, NodeFilter.SHOW_TEXT);
        let text: Node | null;
        while ((text = walker.nextNode())) {
          if (!text.textContent?.trim()) continue;
          const range = document.createRange(); range.selectNodeContents(text);
          for (const rect of range.getClientRects()) {
            const clip = text.parentElement?.closest('.analysis')?.getBoundingClientRect();
            const left = Math.max(rect.left, clip?.left ?? 0, 0); const right = Math.min(rect.right, clip?.right ?? innerWidth, innerWidth);
            const top = Math.max(rect.top, clip?.top ?? 0, 0); const bottom = Math.min(rect.bottom, clip?.bottom ?? innerHeight, innerHeight);
            if (cat && right > left && bottom > top && cat.left < right && cat.right > left && cat.top < bottom && cat.bottom > top) textOverlaps.push(text.textContent.trim().slice(0, 80));
          }
        }
      }

      return { viewport: innerWidth, overflow: document.documentElement.scrollWidth - innerWidth, boardCenterOffset: Math.abs(box.x + box.width / 2 - document.documentElement.clientWidth / 2), boardRatio: box.width / innerWidth, catTextOverlaps: [...new Set(textOverlaps)], props: props.length, inventory: document.querySelectorAll('.desk-prop').length, catOverlaps: !!cat && targets.some(target => { const b = target.getBoundingClientRect(); return cat.left < b.right && cat.right > b.left && cat.top < b.bottom && cat.bottom > b.top; }), minJapanese: Math.min(...targets.filter(target => target.matches('[lang="ja"]')).map(target => parseFloat(getComputedStyle(target).fontSize))), minControl: Math.min(...targets.filter(target => target.matches('button,input,select,summary')).map(target => target.getBoundingClientRect().height)) };
    });
    expect(metrics.overflow).toBeLessThanOrEqual(1); expect(metrics.boardCenterOffset).toBeLessThanOrEqual(16); expect(metrics.catOverlaps).toBe(false); expect(metrics.catTextOverlaps).toEqual([]); expect(metrics.inventory).toBe(4); expect(metrics.props).toBeGreaterThan(0); if (width! >= 1600) expect(metrics.props).toBe(4); else if (width! >= 1200) expect(metrics.props).toBe(3); else expect(metrics.props).toBeLessThanOrEqual(2); if (width! <= 390) { expect(metrics.boardRatio).toBeGreaterThanOrEqual(.975); expect(metrics.minJapanese).toBeGreaterThanOrEqual(22); expect(metrics.minControl).toBeGreaterThanOrEqual(44); } checks.push(metrics);
  }
  await page.setViewportSize({ width: 1280, height: 900 }); return { fonts, checks };
}
async function kanaGeometry(f: Awaited<ReturnType<typeof fixture>>) {
  const calls = f.languageCalls.length; await f.nav.getByRole('button', { name: 'Справочник', exact: true }).click(); const checks: object[] = [];
  for (const label of ['Хирагана', 'Катакана']) {
    await f.page.getByRole('navigation', { name: 'Разделы справочника' }).getByRole('button', { name: label, exact: true }).click();
    for (const width of [320, 390]) {
      await f.page.setViewportSize({ width, height: 844 }); await f.page.evaluate(() => document.fonts.ready);
      const metrics = await f.page.locator('.kana-table td[data-kana] .kana-pair').evaluateAll(elements => elements.map(element => {
        const cell = element.closest('td')!.getBoundingClientRect(); const range = document.createRange(); range.selectNodeContents(element); const rects = [...range.getClientRects()];
        return { glyph: element.textContent, group: element.closest('table')!.getAttribute('data-kana-group'), lines: rects.length, size: parseFloat(getComputedStyle(element).fontSize), fits: rects.every(rect => rect.left >= cell.left - 1 && rect.right <= cell.right + 1 && rect.top >= cell.top - 1 && rect.bottom <= cell.bottom + 1) };
      }));
      expect(metrics).toHaveLength(114); expect(metrics.every(metric => metric.fits && metric.lines === 1 && metric.size >= 22)).toBe(true); expect(await f.page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1); checks.push({ script: label, width, glyphs: metrics.length, allGlyphsFitCellsOnOneLine: true, minimumSize: Math.min(...metrics.map(metric => metric.size)) });
      if (label === 'Катакана' && width === 390) { await f.page.locator('[data-kana-group="small"]').scrollIntoViewIfNeeded(); await f.page.waitForTimeout(300); await f.page.screenshot({ path: `${output}/learning-reference-kana-390.png` }); }
    }
  }
  expect(f.languageCalls).toHaveLength(calls); return checks;
}
async function fillGrammar(page: Page, item: Extract<ReviewItem, { mode: 'grammar' }>) {
  const bank = page.getByRole('group', { name: 'Доступные элементы', exact: true }); for (const id of item.exercise.acceptedOrders[0]!) await bank.locator(`[data-token-id="${id}"]`).click();
  await expect(page.locator('[data-outcome="correct"]')).toBeVisible();
}
try {
  if (referenceNoteOnly) {
    const f = await fixture('Примечание к катакане'); await f.page.setViewportSize({ width: 390, height: 844 }); await f.nav.getByRole('button', { name: 'Справочник', exact: true }).click(); await f.page.getByRole('navigation', { name: 'Разделы справочника' }).getByRole('button', { name: 'Катакана', exact: true }).click(); await f.page.locator('[data-kana-group="small"]').scrollIntoViewIfNeeded(); await f.page.evaluate(() => document.fonts.ready); await f.page.waitForTimeout(300); await f.page.screenshot({ path: `${output}/learning-reference-kana-note-390.png` }); expect(f.errors).toEqual([]); results.push({ noteScreenshotOnly: true, errors: f.errors });
  } else if (geometryOnly) {
    const f = await fixture('Композиция и шрифт'); const { page } = f; const layouts: object[] = [];
    await page.evaluate(() => document.fonts.ready);
    for (const width of [390, 320]) {
      await page.setViewportSize({ width, height: 844 }); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
      const boxes = await page.getByTestId('train-lesson').evaluateAll(elements => elements.map(element => element.getBoundingClientRect().toJSON())); expect(boxes).toHaveLength(18); expect(boxes.every(box => box.width >= 44 && box.height >= 44)).toBe(true); layouts.push({ width, firstButton: boxes[0] });
      if (width === 390) { await page.waitForTimeout(300); await page.screenshot({ path: `${output}/learning-textbook-390.png` }); }
    }
    await page.setViewportSize({ width: 1024, height: 900 }); await f.nav.getByRole('button', { name: 'Повторение', exact: true }).click();
    const emptyRepeat = await page.locator('.today').evaluate(element => {
      const cat = element.querySelector('.cat-frame')!.getBoundingClientRect(); const overlaps: string[] = []; const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT); let text: Node | null;
      while ((text = walker.nextNode())) { if (!text.textContent?.trim() || text.parentElement?.closest('.companion,.sr-only,[aria-hidden="true"]')) continue; const range = document.createRange(); range.selectNodeContents(text); for (const box of range.getClientRects()) if (box.width > 0 && box.height > 0 && box.top < innerHeight && box.bottom > 0 && cat.left < box.right && cat.right > box.left && cat.top < box.bottom && cat.bottom > box.top) overlaps.push(text.textContent.trim().slice(0, 80)); }
      const buttons = [...element.querySelectorAll('button')].map(button => { const box = button.getBoundingClientRect(); return { height: box.height, overlaps: cat.left < box.right && cat.right > box.left && cat.top < box.bottom && cat.bottom > box.top }; });
      return { width: innerWidth, textOverlaps: overlaps, buttons };
    });
    expect(emptyRepeat.textOverlaps).toEqual([]); expect(emptyRepeat.buttons.every(button => button.height >= 44 && !button.overlaps)).toBe(true); await page.getByRole('button', { name: 'К учебнику', exact: true }).click();
    await page.setViewportSize({ width: 1280, height: 900 }); await page.getByRole('button', { name: 'Тренировать урок 4', exact: true }).click(); const gesture = page.getByTestId('review-gesture'); await expect(gesture).toBeVisible();
    for (const item of f.queues[0]!.items) {
      await expect(gesture).toHaveAttribute('data-review-id', item.id);
      if (item.mode === 'grammar') { await fillGrammar(page, item); await expect(gesture.locator('.card-actions button').first()).toBeEnabled(); break; }
      await page.getByTestId('card-face').click(); await next(page, item.id);
    }
    const wide = await geometry(page); await page.screenshot({ path: `${output}/learning-train-1280.png` }); const kana = await kanaGeometry(f); expect(f.errors).toEqual([]); results.push({ layouts, emptyRepeat, wide, kana, errors: f.errors });
  } else {
  // Fresh account: legacy manual flags are not evidence of a completed introduction.
  const f = await fixture('Первичное изучение'); const { page, context, nav } = f; await legacySettings(context); await page.reload(); await expect(nav.getByRole('button', { name: 'Учебник', exact: true })).toHaveAttribute('aria-current', 'page');
  expect((await json<ReviewQueue>(context, '/api/reviews?mode=mixed')).items).toHaveLength(0); expect((await progress(context)).introducedWordIds).toHaveLength(0);
  const tiles = page.locator('.lesson-card'); await expect(tiles).toHaveCount(18); await expect(page.getByTestId('train-lesson')).toHaveCount(18);
  const layouts: object[] = [];
  for (const width of functionalOnly ? [1280] : [1280, 390, 320]) {
    await page.setViewportSize({ width, height: 844 }); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    const buttons = await page.getByTestId('train-lesson').evaluateAll(elements => elements.map(element => element.getBoundingClientRect().toJSON())); expect(buttons.every(box => box.height >= 44 && box.width >= 44)).toBe(true);
    layouts.push({ width, firstButton: buttons[0] }); if (width === 390) { await page.waitForTimeout(300); await page.screenshot({ path: `${output}/learning-textbook-390.png` }); }
  }
  await page.setViewportSize({ width: 1280, height: 900 });
  await expect(page.locator('.textbook-filters')).toHaveCount(0); await expect(page.locator('.lesson-card select,.lesson-card input[type="checkbox"]')).toHaveCount(0);
  const lesson = course.lessons.find(lesson => lesson.number === 4)!; const train = page.getByRole('button', { name: 'Тренировать урок 4', exact: true }); await train.click();
  const session = page.getByTestId('study-session'); const gesture = page.getByTestId('review-gesture'); await expect(session).toHaveAttribute('data-session-kind', 'lesson'); await expect(session).toHaveAttribute('data-source-id', lesson.id); await expect(gesture).toBeVisible();
  await expect(nav.getByRole('button', { name: 'Учебник', exact: true })).toHaveAttribute('aria-current', 'page'); const scene = await session.getAttribute('data-scene-id'); const initial = f.queues[0]!;
  const words = initial.items.filter(item => item.mode !== 'grammar'); const grammar = initial.items.filter(item => item.mode === 'grammar'); expect(words.length).toBeGreaterThan(0); expect(words.length).toBeLessThanOrEqual(10); expect(grammar.length).toBeGreaterThan(0); expect(grammar.length).toBeLessThanOrEqual(2); expect(new Set(words.map(item => item.targetId)).size).toBe(words.length);
  let wide: Awaited<ReturnType<typeof geometry>> | undefined; let firstWord: ReviewItem | undefined; let learnedSkill: string | undefined; let exploredSkill: string | undefined;
  for (const item of initial.items) {
    await expect(gesture).toHaveAttribute('data-review-id', item.id);
    if (item.mode !== 'grammar') {
      await page.getByTestId('card-face').click();
      if (!firstWord) {
        firstWord = item; f.loseAck(); await gesture.focus(); await page.keyboard.press('ArrowLeft'); const retry = page.getByRole('button', { name: 'Повторить сохранение', exact: true }); await expect(retry).toBeVisible(); await expect(gesture).toHaveAttribute('data-review-id', item.id);
        await nav.getByRole('button', { name: 'Повторение', exact: true }).click(); await expect(gesture).not.toBeVisible(); await expect(page.getByRole('heading', { name: 'Повторение', exact: true })).toBeVisible(); await nav.getByRole('button', { name: 'Учебник', exact: true }).click(); await train.click(); await expect(gesture).toHaveAttribute('data-review-id', item.id); expect(await session.getAttribute('data-scene-id')).toBe(scene);
        await retry.click(); await expect.poll(() => gesture.getAttribute('data-review-id')).not.toBe(item.id); expect(f.submissions[1]).toEqual(f.submissions[0]); expect((await progress(context)).introducedWordIds).toEqual([item.targetId]);
        const review = await json<ReviewQueue>(context, '/api/reviews?mode=mixed'); expect(review.items.every(candidate => candidate.targetId === item.targetId)).toBe(true); expect(new Set(review.items.map(candidate => candidate.mode))).toEqual(new Set(['ja-ru', 'ru-ja', 'listening'].filter(mode => mode !== item.mode)));
      } else await next(page, item.id);
    } else if (!learnedSkill) {
      const before = await progress(context); expect(item.exercise.tokens.some(token => { const form = course.forms.find(form => form.id === token.formId)!; return !before.introducedWordIds.includes(form.wordId); })).toBe(true);
      await fillGrammar(page, item);
      const area = page.getByRole('group', { name: 'Ваше предложение', exact: true }); const tokenIds = await area.locator('[data-token-id]').evaluateAll(elements => elements.map(element => element.getAttribute('data-token-id')));
      await area.locator('[data-token-id]').first().click(); const editor = page.getByRole('dialog', { name: 'Изменить элемент', exact: true }); await expect(editor).toBeVisible(); expect(f.submissions.length).toBe(2); await editor.getByRole('button', { name: 'Закрыть редактор', exact: true }).click(); expect(await area.locator('[data-token-id]').evaluateAll(elements => elements.map(element => element.getAttribute('data-token-id')))).toEqual(tokenIds);
      await expect(gesture.locator('.card-actions button').first()).toBeEnabled(); if (!functionalOnly) wide = await geometry(page); await page.screenshot({ path: `${output}/learning-train-1280.png` }); await next(page, item.id); learnedSkill = item.targetId; expect((await progress(context)).introducedSkillIds).toContain(learnedSkill);
      await database.sql`update review_states set due=${new Date('2024-01-01T00:00:00Z')} where user_id=${f.actor.id} and item_id=${learnedSkill} and mode='grammar'`;
      const repeated = (await json<ReviewQueue>(context, '/api/reviews?mode=grammar')).items.find(candidate => candidate.targetId === learnedSkill); if (!repeated || repeated.mode !== 'grammar') throw new Error('Accepted training skill missing from due repeat.');
      const evaluated = await context.request.post(`${api}/api/reviews/evaluate`, { headers: { origin: base }, data: { reviewId: repeated.id, version: repeated.version, revision: 1, tokenIds: repeated.exercise.acceptedOrders[0] } }); expect(evaluated.status()).toBe(200); expect((await evaluated.json()).outcome).toBe('correct');
    } else {
      await page.getByLabel('Действия карточки', { exact: true }).click(); await page.getByRole('button', { name: 'Ввести фразу', exact: true }).click(); const editor = page.getByRole('dialog', { name: 'Ввести фразу', exact: true }); await editor.getByRole('textbox', { name: 'Ваша фраза', exact: true }).fill('わたしはがっこうをです。'); await editor.getByRole('button', { name: 'Закрыть редактор', exact: true }).click(); await expect(page.locator('[data-outcome="exploration"]')).toBeVisible(); await next(page, item.id); exploredSkill = item.targetId; expect((await progress(context)).introducedSkillIds).not.toContain(exploredSkill);
    }
  }
  await expect(page.getByRole('heading', { name: 'Порция пройдена', exact: true })).toBeVisible(); const learned = await progress(context); expect(learned.introducedWordIds).toHaveLength(words.length); expect(learned.introducedSkillIds).toHaveLength(1);
  await page.getByRole('button', { name: 'Продолжить', exact: true }).click(); await expect(gesture).toBeVisible(); await expect(page.getByRole('region', { name: 'Начало занятия', exact: true })).toHaveCount(0); expect(await session.getAttribute('data-scene-id')).toBe(scene); const second = f.queues[1]!; expect(second.items.some(item => item.mode === 'grammar')).toBe(true); expect(second.items.filter(item => item.mode !== 'grammar').every(item => !learned.introducedWordIds.includes(item.targetId))).toBe(true);
  const remaining = await gesture.getAttribute('data-review-id'); await nav.getByRole('button', { name: 'Учебник', exact: true }).click(); await expect(page.locator(`.lesson-progress[data-lesson-id="${lesson.id}"]`)).toBeVisible(); await train.click(); await expect(gesture).toHaveAttribute('data-review-id', remaining!); expect(f.queues).toHaveLength(2);
  await page.getByRole('button', { name: 'Завершить', exact: true }).click(); await page.reload(); expect((await progress(context)).introducedWordIds).toEqual(learned.introducedWordIds); expect(f.errors).toEqual([]);
  const referenceChecks = await reference(f, learned);
  results.push({ reference: referenceChecks, wide, freshLegacyFlagsRepeatEmpty: true, layouts, portionWords: words.length, portionSkills: grammar.length, againEnrolsAndAllModesAvailable: true, sameAttemptRetryAndNavigation: true, grammarOriginalWordsNotImplicitlyLearned: true, freeExperimentNotEnrolled: exploredSkill, continueSameSceneNoIntro: true, confirmedProgressSurvivesExit: true, errors: f.errors });

  // Sparse historical state ignores closed flags; personal study stays personal.
  const old = await fixture('Старая история'); await legacySettings(old.context, true); const historicalWord = course.words.find(word => !!word.audioUrl && word.reviewStatus !== 'draft')!; const historicalSkill = course.skills.find(skill => course.exercises.some(exercise => exercise.skillId === skill.id))!; const oldCard = nextCard(null, 3, new Date('2024-01-01T00:00:00Z'));
  await database.sql`insert into review_states(user_id,item_id,mode,version,card,due,introduced_at) values(${old.actor.id},${historicalWord.id},'ja-ru',1,${oldCard},${oldCard.due},${new Date('2024-01-01T00:00:00Z')})`;
  await database.sql`insert into review_states(user_id,item_id,mode,version,card,due,introduced_at) values(${old.actor.id},${historicalSkill.id},'grammar',1,${oldCard},${oldCard.due},${new Date('2024-01-01T00:00:00Z')})`;
  const legacyQueue = await json<ReviewQueue>(old.context, '/api/reviews?mode=mixed'); expect(legacyQueue.items.every(item => item.targetId === historicalWord.id || item.targetId === historicalSkill.id)).toBe(true); expect(legacyQueue.items.some(item => item.mode === 'grammar')).toBe(true); expect(legacyQueue.items.filter(item => item.mode !== 'grammar')).toHaveLength(3);
  await old.page.reload(); await old.nav.getByRole('button', { name: 'Повторение', exact: true }).click(); await old.page.getByRole('button', { name: 'Начать повторение', exact: true }).click(); const oldGesture = old.page.getByTestId('review-gesture'); await expect(oldGesture).toBeVisible(); await expect(old.page.getByTestId('study-session')).toHaveAttribute('data-session-kind', 'review');
  for (const item of old.reviews.at(-1)!.items) {
    await expect(oldGesture).toHaveAttribute('data-review-id', item.id);
    if (item.mode === 'grammar') { await fillGrammar(old.page, item); expect((await progress(old.context)).introducedWordIds).toEqual([historicalWord.id]); break; }
    await old.page.getByTestId('card-face').click(); await next(old.page, item.id);
  }
  await old.nav.getByRole('button', { name: 'Справочник', exact: true }).click(); await old.page.getByRole('navigation', { name: 'Разделы справочника' }).getByRole('button', { name: 'Личные списки', exact: true }).click(); await old.page.getByLabel('Название', { exact: true }).fill('Личный словарь QA'); await old.page.getByLabel('Слова, по одному в строке', { exact: true }).fill('かせいねこ; かせいねこ; марсианский кот'); await old.page.getByRole('button', { name: 'Разобрать и сохранить', exact: true }).click(); await expect(old.page.getByRole('button', { name: 'Тренировать список Личный словарь QA', exact: true })).toBeVisible(); await old.page.getByRole('combobox', { name: 'Часть речи', exact: true }).selectOption('noun'); await old.page.getByRole('button', { name: 'Сохранить слово', exact: true }).click(); await expect(old.page.getByRole('button', { name: 'Тренировать список Личный словарь QA', exact: true })).toBeEnabled(); const lists = await json<{ lists: WordList[] }>(old.context, '/api/lists'); const personal = lists.lists.find(list => list.name === 'Личный словарь QA')!;
  await old.page.getByRole('button', { name: 'Тренировать список Личный словарь QA', exact: true }).click(); await expect(old.page.getByTestId('study-session')).toHaveAttribute('data-session-kind', 'list'); await expect(old.nav.getByRole('button', { name: 'Справочник', exact: true })).toHaveAttribute('aria-current', 'page'); await old.page.getByTestId('card-face').click(); const personalId = await oldGesture.getAttribute('data-review-id'); await next(old.page, personalId!); expect((await progress(old.context)).introducedWordIds).toContain(personal.words[0]!.id);
  const other = await fixture('Другой ученик'); expect((await progress(other.context)).introducedWordIds).toHaveLength(0); expect((await json<ReviewQueue>(other.context, '/api/reviews?mode=mixed')).items).toHaveLength(0); expect((await json<{ lists: WordList[] }>(other.context, '/api/lists')).lists).toHaveLength(0); await reference(other, await progress(other.context)); const forbidden = await other.context.request.get(`${api}/api/training?listId=${personal.id}`); expect(forbidden.status()).toBe(404); expect(old.errors).toEqual([]); expect(other.errors).toEqual([]);
  const smallLesson = course.lessons[0]!; const available = course.words.filter(word => word.lessonIds.includes(smallLesson.id) && word.reviewStatus !== 'draft' && validSegments(word));
  for (const word of available) await database.sql`insert into review_states(user_id,item_id,mode,version,card,due,introduced_at) values(${other.actor.id},${word.id},'ja-ru',1,${oldCard},${oldCard.due},${new Date('2024-01-01T00:00:00Z')})`;
  await other.page.reload(); const smallProgress = other.page.locator(`.lesson-progress[data-lesson-id="${smallLesson.id}"]`); await expect(smallProgress).toBeVisible(); const smallProgressText = await smallProgress.textContent(); await expect(smallProgress).toHaveAttribute('data-introduced', String(available.length)); await expect(smallProgress).toHaveAttribute('data-total', String(available.length));
  results.push({ historicalSparseStateSurvivesClosedFilters: true, grammarRepeatOriginalTokensAvailable: true, personalNativeTrain: true, personalWordAudioOptional: !personal.words[0]!.audioUrl, fullyIntroducedLesson: { available: available.length, raw: course.words.filter(word => word.lessonIds.includes(smallLesson.id)).length, progressText: smallProgressText }, isolatedLearnerAndListAuthorization: true, errors: [...old.errors, ...other.errors] });
  }
  const scope = referenceNoteOnly ? 'reference-note' : geometryOnly ? 'geometry' : functionalOnly ? 'functional' : 'browser'; const report = { complete: true, scope, browser: browser.version(), results, externalAIRequests: 0, humanAccountUsed: false }; await Bun.write(`${output}/learning-${scope}-2026-10-21.json`, JSON.stringify(report, null, 2)); console.info(JSON.stringify(report, null, 2));
} catch (error) { const page = contexts.at(-1)?.pages()[0]; if (page && !page.isClosed()) await page.screenshot({ path: `${output}/qa-learning-failure.png`, fullPage: true }); throw error; } finally {
  for (const context of contexts) { await context.unrouteAll({ behavior: 'ignoreErrors' }); await context.close(); }
  await browser.close(); server.stop(true); provider.stop(true); for (const email of emails) { await database.sql`delete from access_links where email=${email}`; await database.sql`delete from users where email=${email}`; } await database.sql.close();
}
