// Deterministic UI/transport proof; official source playback has its separate manual probe.
import { chromium, expect, type Page } from '@playwright/test';
import { connectDatabase } from '../src/server/db';
import { createLink, consumeLink } from '../src/server/auth';
import { learningParts, type LearningRouteState } from '../src/shared/learning';
import type { Course, VideoCaption } from '../src/shared/types';
import { output } from './helpers/artifact-output';

const databaseUrl = process.env.JAPANESE_INTEGRATION_DATABASE_URL;
const base = process.env.GUIDED_BROWSER_URL; const apiUrl = process.env.GUIDED_BROWSER_API_URL;
if (!databaseUrl || new URL(databaseUrl).hostname !== '127.0.0.1' || new URL(databaseUrl).pathname !== '/japanese_app_test' || !base || !apiUrl || new URL(base).hostname !== 'localhost' || new URL(apiUrl).hostname !== 'localhost') throw new Error('Use the disposable DB and isolated dynamic localhost launcher only.');
const database = connectDatabase(databaseUrl); const email = `video-library-${crypto.randomUUID()}@example.test`; const password = 'Disposable-video-library-fixture!';
const browser = await chromium.launch({ channel: 'chrome', headless: true }); const context = await browser.newContext({ reducedMotion: 'reduce', viewport: { width: 1280, height: 700 }, extraHTTPHeaders: { 'x-forwarded-for': `198.18.${crypto.getRandomValues(new Uint8Array(2)).join('.')}` } });
const page = await context.newPage(); const errors: string[] = []; let srsPosts = 0; let externalRequests = 0; let failedMedia = '';
const fixtureCaptions: VideoCaption[] = [{ startSeconds: 0, endSeconds: .1, text: null }, { startSeconds: .1, endSeconds: .55, text: 'テスト一。' }, { startSeconds: .55, endSeconds: 1.05, text: 'テスト二。' }, { startSeconds: 1.05, endSeconds: null, text: null }];
page.on('pageerror', error => errors.push(error.message)); page.on('request', request => { if (new URL(request.url()).pathname === '/api/reviews' && request.method() === 'POST') srsPosts++; if (new URL(request.url()).hostname !== 'localhost') externalRequests++; });
async function localClip() {
  // An account-free, in-memory WebM made by the installed browser; no downloaded media fixture.
  const recording = await context.newPage(); await recording.goto('data:text/html,<title>Local media fixture</title>');
  const bytes = await recording.evaluate(async () => {
    const canvas = document.createElement('canvas'); canvas.width = 160; canvas.height = 90;
    document.body.append(canvas);
    const drawing = canvas.getContext('2d')!; const stream = canvas.captureStream(0); const track = stream.getVideoTracks()[0] as CanvasCaptureMediaStreamTrack; const chunks: BlobPart[] = [];
    const recorder = new MediaRecorder(stream, { mimeType: 'video/webm;codecs=vp8' });
    const stopped = new Promise<Blob>(resolve => { recorder.ondataavailable = event => chunks.push(event.data); recorder.onstop = () => resolve(new Blob(chunks, { type: 'video/webm' })); });
    recorder.start(100);
    for (let frame = 0; frame < 20; frame++) { drawing.fillStyle = frame % 2 ? '#eee4ce' : '#e8dec7'; drawing.fillRect(0, 0, 160, 90); track.requestFrame(); await new Promise(resolve => setTimeout(resolve, 90)); }
    recorder.stop(); const blob = await stopped; stream.getTracks().forEach(track => track.stop()); canvas.remove(); return Array.from(new Uint8Array(await blob.arrayBuffer()));
  });
  await recording.close(); await page.bringToFront(); return Buffer.from(bytes);
}
async function openLibrary(number: number) {
  const lessonId = `marugoto.starter-a1.lesson.${String(number).padStart(2, '0')}`; const card = page.locator(`.lesson-card[data-lesson-id="${lessonId}"]`);
  await card.locator('.lesson-material > summary').click(); const library = card.getByTestId('lesson-video-library'); await library.locator(':scope > summary').click(); await expect(library.locator('video')).toHaveCount(1); return library;
}
async function playVideo(media = page.locator('.lesson-video video')) { await media.evaluate(async (video: HTMLVideoElement) => { video.muted = true; await video.play(); }); await expect.poll(() => media.evaluate((video: HTMLVideoElement) => !video.paused && video.currentTime > .03)).toBe(true); }
async function expectCaption(text: string, reading: string, cue: number) {
  // Native ruby contributes rt to textContent; check the caption and its reading independently.
  await expect.poll(() => page.locator('.lesson-video-caption').evaluate(element => {
    const base = element.cloneNode(true) as Element;
    base.querySelectorAll('rt').forEach(node => node.remove());
    return { text: base.textContent, reading: [...element.querySelectorAll('rt')].map(node => node.textContent).join(''), cue: element.getAttribute('data-cue') };
  })).toEqual({ text, reading, cue: String(cue) });
}
const report: Record<string, unknown> = { isolatedFixtures: true, officialMediaDownloaded: false, localFixture: 'in-memory native WebM', externalAiCalls: 0 };
try {
  const link = await createLink(database, 'invite', email, null); await consumeLink(database, 'invite', link.token, password, 'Видео: проверка библиотеки'); const [actor] = await database.sql`select id from users where email=${email}`;
  const signed = await context.request.post(`${apiUrl}/api/auth/sign-in/email`, { headers: { origin: base }, data: { email, password } }); expect(signed.status()).toBe(200);
  const response = await context.request.get(`${apiUrl}/api/course`); const course: Course = await response.json(); const inventory = course.lessons.flatMap(lesson => lesson.videos ?? []); expect(inventory).toHaveLength(80); expect(course.lessons.every(lesson => (lesson.videos?.length ?? 0) > 1)).toBe(true);
  const route = course.learning!.find(route => route.goals.some(goal => goal.videoIds?.some(id => id !== route.lessonId)))!; const parts = learningParts(route); const partIndex = parts.findIndex(part => part.some(step => step.kind === 'video' && step.videoId !== route.lessonId)); const targetIndex = parts[partIndex]!.findIndex(step => step.kind === 'video' && step.videoId !== route.lessonId); const target = parts[partIndex]![targetIndex]!; if (target.kind !== 'video') throw new Error('Missing specific guided video fixture.');
  const seed: LearningRouteState = { partIndex, pendingStepIds: parts[partIndex]!.slice(targetIndex).map(step => step.id), completedStepIds: [...parts.slice(0, partIndex).flat(), ...parts[partIndex]!.slice(0, targetIndex)].map(step => step.id) };
  await database.sql`insert into learning_states(user_id,lesson_id,route_version,version,state) values(${actor.id},${route.lessonId},${route.version},0,${seed})`;
  await context.route('**/api/course', async intercepted => { const upstream = await intercepted.fetch(); const data: Course = await upstream.json(); for (const lesson of data.lessons) for (const material of lesson.videos ?? []) material.captions = fixtureCaptions; await intercepted.fulfill({ response: upstream, json: data }); });
  await page.goto(base); await expect(page.getByTestId('learn-lesson')).toHaveCount(18); const clip = await localClip(); report.clip = { bytes: clip.length, magic: clip.subarray(0, 4).toString('hex'), canPlay: await page.evaluate(() => document.createElement('video').canPlayType('video/webm;codecs=vp8')) };
  await context.route('https://a1.marugotoweb.jp/**', async intercepted => {
    if (intercepted.request().url() === failedMedia) { await intercepted.abort('failed'); return; }
    const range = intercepted.request().headers().range?.match(/^bytes=(\d+)-(\d*)$/); const start = range ? Number(range[1]) : 0; const end = range?.[2] ? Math.min(Number(range[2]), clip.length - 1) : clip.length - 1;
    await intercepted.fulfill({ status: range ? 206 : 200, contentType: 'video/webm', headers: { 'Accept-Ranges': 'bytes', ...(range ? { 'Content-Range': `bytes ${start}-${end}/${clip.length}` } : {}) }, body: clip.subarray(start, end + 1) });
  });
  await expect(page.locator('video')).toHaveCount(0); const firstLesson = course.lessons[0]!; const library = await openLibrary(firstLesson.number); const selector = library.getByRole('combobox', { name: 'Выбрать видеодиалог', exact: true }); const first = firstLesson.videos![0]!; const second = firstLesson.videos!.find(material => material.id !== first.id && material.variant === 'challenge') ?? firstLesson.videos![1]!;
  await expect(selector.locator('option')).toHaveCount(firstLesson.videos!.length); await expect(page.locator('.lesson-video')).toHaveAttribute('data-video-id', first.id); await playVideo(); await expectCaption('テスト一。', 'いち', 1); const oldVideo = await page.locator('.lesson-video video').elementHandle(); expect(await oldVideo!.evaluate((video: HTMLVideoElement) => video.paused)).toBe(false);
  await selector.selectOption(second.id); expect(await oldVideo!.evaluate((video: HTMLVideoElement) => video.paused)).toBe(true); await expect(page.locator('video')).toHaveCount(1); await expect(page.locator('.lesson-video-caption')).toBeEmpty(); await expect(page.getByRole('link', { name: 'Оригинал на Marugoto Plus ↗', exact: true })).toHaveAttribute('href', second.sourceUrl); await expect(page.getByRole('link', { name: 'Источник японского текста ↗', exact: true })).toHaveAttribute('href', second.captionsSourceUrl); if (second.variant === 'challenge') await expect(library).toContainText('не все строки произносятся');
  await playVideo(); await page.locator('video').evaluate((video: HTMLVideoElement) => { video.pause(); video.currentTime = .75; }); await expectCaption('テスト二。', 'に', 2); await page.locator('video').evaluate((video: HTMLVideoElement) => { video.currentTime = .01; }); await expect(page.locator('.lesson-video-caption')).toBeEmpty();
  failedMedia = second.mediaUrl; await page.locator('video').evaluate((video: HTMLVideoElement) => { video.load(); void video.play().catch(() => {}); }); await expect(page.getByText('Не удалось воспроизвести видео.', { exact: false })).toBeVisible(); await selector.selectOption(first.id); await expect(page.getByText('Не удалось воспроизвести видео.', { exact: false })).toHaveCount(0); await expect(page.locator('.lesson-video-caption')).toBeEmpty(); failedMedia = '';
  await playVideo(); const beforeClose = await page.locator('video').elementHandle(); await library.locator(':scope > summary').click(); await expect(page.locator('video')).toHaveCount(0); expect(await beforeClose!.evaluate((video: HTMLVideoElement) => video.paused)).toBe(true);
  await library.locator(':scope > summary').click(); await playVideo(); const beforeExclusive = await page.locator('video').elementHandle(); const otherLibrary = await openLibrary(course.lessons[1]!.number); await expect(library).not.toHaveAttribute('open', ''); await expect(page.locator('video')).toHaveCount(1); expect(await beforeExclusive!.evaluate((video: HTMLVideoElement) => video.paused)).toBe(true);
  for (const width of [320, 390, 1280]) { await page.setViewportSize({ width, height: 700 }); await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true); await otherLibrary.scrollIntoViewIfNeeded(); await page.screenshot({ path: `${output}/video-library-${width}.png`, fullPage: true }); }
  await playVideo(); const beforeNav = await page.locator('video').elementHandle(); await page.getByRole('navigation', { name: 'Разделы', exact: true }).getByRole('button', { name: 'Справочник', exact: true }).click(); expect(await beforeNav!.evaluate((video: HTMLVideoElement) => video.paused)).toBe(true); await expect(page.locator('video')).toHaveCount(0); expect(srsPosts).toBe(0);
  await page.getByRole('navigation', { name: 'Разделы', exact: true }).getByRole('button', { name: 'Учебник', exact: true }).click(); await page.locator(`[data-testid="learn-lesson"][data-lesson-id="${route.lessonId}"]`).click(); await expect(page.getByTestId('guided-learning')).toHaveAttribute('data-step-id', target.id); await expect(page.locator('.guided-video .lesson-video')).toHaveAttribute('data-video-id', target.videoId); await expect(page.locator('.guided-video')).toContainText('Видео необязательно');
  for (const width of [320, 390, 1280]) { await page.setViewportSize({ width, height: 700 }); await page.screenshot({ path: `${output}/video-library-guided-${width}.png`, fullPage: true }); }
  const [before] = await database.sql`select count(*)::int as count from review_attempts where user_id=${actor.id}`; await page.getByRole('button', { name: 'Продолжить урок', exact: true }).click(); await expect(page.getByTestId('guided-learning')).not.toHaveAttribute('data-step-id', target.id); const [after] = await database.sql`select count(*)::int as count from review_attempts where user_id=${actor.id}`; expect(after.count).toBe(before.count); expect(srsPosts).toBe(0); expect(errors).toEqual([]);
  Object.assign(report, { green: true, browser: browser.version(), inventory: inventory.length, lessons: course.lessons.length, lazyPlayers: true, singleExclusivePlayer: true, nativePlaybackCueAndSeek: true, selectionStopsOldMediaAndResetsCaption: true, failureStateReset: true, closeAndNavigationPause: true, originalAndCaptionSourceLinks: true, challengeNoteVisible: true, specificGuidedVideoId: true, optionalSkipNoSrs: true, widths: [320, 390, 1280], errors, interceptedOfficialRequests: externalRequests }); await Bun.write(`${output}/video-library-browser-green.json`, JSON.stringify(report, null, 2)); console.info(JSON.stringify(report));
} catch (error) { let text = error instanceof Error ? error.message : String(error); for (const secret of [email, password]) text = text.replaceAll(secret, '<REDACTED>'); report.green = false; report.failure = text; report.media = await page.locator('video').evaluateAll(nodes => nodes.filter((node): node is HTMLVideoElement => node instanceof HTMLVideoElement).map(video => ({ src: video.currentSrc, ready: video.readyState, network: video.networkState, error: video.error?.message ?? null }))).catch(() => []); report.errors = errors; await Bun.write(`${output}/video-library-browser-red.json`, JSON.stringify(report, null, 2)); console.error(text); process.exitCode = 1; }
finally { await context.close(); await browser.close(); await database.sql`delete from access_links where email=${email}`; await database.sql`delete from users where email=${email}`; await database.sql.close(); }
