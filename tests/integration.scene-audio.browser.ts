import { chromium, expect, type BrowserContext, type Page } from '@playwright/test';
import { createApp } from '../src/server/app';
import { createLink, consumeLink } from '../src/server/auth';
import { connectDatabase } from '../src/server/db';
import { loadCourse } from '../src/server/course';
import { defaultSettings, validSegments } from '../src/server/material';
import { nextFixtureIp } from './helpers/fixture-ip';
import { output } from './helpers/artifact-output';
import { seedAcceptedHistory, openRepeat } from './helpers/introduced-browser-fixture';
import type { LearnerSettings, Progress, ReviewItem, ReviewQueue, ReviewSubmission } from '../src/shared/types';

const databaseUrl = process.env.JAPANESE_INTEGRATION_DATABASE_URL;
if (!databaseUrl || new URL(databaseUrl).hostname !== '127.0.0.1' || new URL(databaseUrl).pathname !== '/japanese_app_test') throw new Error('Use only disposable localhost japanese_app_test.');
const base = 'http://127.0.0.1:5173';
const database = connectDatabase(databaseUrl);
const course = loadCourse();
// All language requests stay on this local mock; no preview env or external inference.
const provider = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: () => new Response('Fixture provider limit', { status: 429 }) });
const app = createApp({ database, course, config: { DATABASE_URL: databaseUrl, BETTER_AUTH_SECRET: 'scene-audio-isolated-fixture-secret-more-than32', APP_URL: base, PORT: 3000, HOST: '127.0.0.1', ANALYSIS_PROVIDER: 'generic', ANALYSIS_URL: `http://127.0.0.1:${provider.port}/chat/completions`, ANALYSIS_MODEL: 'isolated-scene-fixture', ANALYSIS_FREE_ONLY: 'true' } });
const server = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: app.fetch });
const apiBase = `http://127.0.0.1:${server.port}`;
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const emails: string[] = [];
const results: object[] = [];
const password = 'Scene-audio-isolated-password!';
let releaseRetry: (() => void) | undefined;
async function checkpoint() { await Bun.write(`${output}/learning-scene-audio-partial-2026-10-21.json`, JSON.stringify({ complete: false, browser: browser.version(), results }, null, 2)); }

type SoundSource = { url: string; loop: boolean; started: number; startedAt: number | null; stopped: number; gain: number[] };
async function sound(page: Page): Promise<{ sources: SoundSource[]; states: string[]; mediaPaused: boolean; jpPlaying: number; jpPaused: boolean; targets: number[] }> {
  return page.evaluate(() => {
    const probe = Reflect.get(window, 'qaSceneAudio');
    return { sources: probe.sources.map((entry: { node: AudioBufferSourceNode; started: number; startedAt: number | null; stopped: number }) => {
      const gains: number[] = []; let node = probe.links.get(entry.node);
      for (let depth = 0; node && depth < 8; depth++, node = probe.links.get(node)) if (node instanceof GainNode) gains.push(node.gain.value);
      return { url: probe.buffers.get(entry.node.buffer) ?? '', loop: entry.node.loop, started: entry.started, startedAt: entry.startedAt, stopped: entry.stopped, gain: gains };
    }).concat(probe.media.map((entry: { audio: HTMLAudioElement; started: number; startedAt: number | null; stopped: number }) => {
      const gains: number[] = []; let node = probe.links.get(probe.mediaNodes.get(entry.audio));
      for (let depth = 0; node && depth < 8; depth++, node = probe.links.get(node)) if (node instanceof GainNode) gains.push(node.gain.value);
      return { url: entry.audio.src, loop: entry.audio.loop, started: entry.started, startedAt: entry.startedAt, stopped: entry.stopped, gain: gains };
    })), states: probe.contexts.map((context: AudioContext) => context.state), mediaPaused: probe.media.every((entry: { audio: HTMLAudioElement }) => entry.audio.paused), jpPlaying: probe.jpPlaying, jpPaused: !probe.jp || probe.jp.paused, targets: [...probe.targets] };
  });
}
async function starts(page: Page, url: string) { return (await sound(page)).sources.filter(source => source.url.endsWith(url)).reduce((sum, source) => sum + source.started, 0); }
async function scenePaused(page: Page) { await expect.poll(async () => { const snapshot = await sound(page); return snapshot.mediaPaused && snapshot.states.every(state => state !== 'running'); }).toBe(true); }
async function startSession(page: Page) {
  await page.getByRole('navigation', { name: 'Разделы' }).getByRole('button', { name: 'Повторение', exact: true }).click();
  await page.evaluate(() => document.addEventListener('click', () => Reflect.set(window, 'qaStartAt', Date.now()), { once: true, capture: true }));
  await page.getByRole('button', { name: 'Начать повторение', exact: true }).click(); return page.evaluate(() => Reflect.get(window, 'qaStartAt') as number);
}
async function entryStartedAt(page: Page) { return page.locator('.scene-camera').evaluate(element => { const animation = element.getAnimations()[0]; return performance.timeOrigin + (animation?.startTime === null || animation?.startTime === undefined ? performance.now() : Number(animation.startTime)); }); }
async function decoration(page: Page) { return page.locator('.scene-desk-props').evaluate(element => ({ period: element.getAttribute('data-period'), props: [...element.querySelectorAll('[data-prop]')].map(prop => prop.getAttribute('data-prop')) })); }
async function checkRig(page: Page, reduced: boolean) {
  const rig = page.getByTestId('scene-companion').locator('.cat-rig'); await expect(rig).toBeVisible(); await expect(rig.locator('img')).toHaveCount(3);
  const layers = await rig.locator('img').evaluateAll(images => images.map(image => ({ loaded: image instanceof HTMLImageElement && image.complete && image.naturalWidth > 0, name: getComputedStyle(image).animationName, time: Number(image.getAnimations()[0]?.currentTime ?? 0) })));
  expect(layers.every(layer => layer.loaded)).toBe(true); expect(layers.every(layer => reduced ? layer.name === 'none' : layer.name !== 'none')).toBe(true); const frame = await rig.boundingBox(); await page.waitForTimeout(150); expect(await rig.boundingBox()).toEqual(frame);
  if (!reduced) { const times = await rig.locator('img').evaluateAll(images => images.map(image => Number(image.getAnimations()[0]?.currentTime ?? 0))); expect(times.every((time, index) => time > layers[index]!.time)).toBe(true); }
  return { reduced, layers, frame };
}
async function progress(context: BrowserContext): Promise<Progress> { const response = await context.request.get(`${apiBase}/api/progress`); expect(response.status()).toBe(200); return response.json(); }
async function settingsMenu(page: Page) { const menu = page.getByLabel('Настройки и аккаунт', { exact: true }); if (!(await menu.evaluate(element => !!element.closest('details')?.open))) await menu.click(); }
async function openSettings(page: Page) { await settingsMenu(page); await page.getByRole('button', { name: 'Настройки', exact: true }).click(); }
async function savedSettings(context: BrowserContext): Promise<LearnerSettings> { const response = await context.request.get(`${apiBase}/api/settings`); expect(response.status()).toBe(200); return response.json(); }
async function installProbe(context: BrowserContext, blocked = false, captureCamera = true) {
  await context.addInitScript(({ blocked, captureCamera }) => {
    const probe = { contexts: [] as AudioContext[], sources: [] as { node: AudioBufferSourceNode; started: number; startedAt: number | null; stopped: number }[], media: [] as { audio: HTMLAudioElement; started: number; startedAt: number | null; stopped: number }[], mediaNodes: new WeakMap<HTMLMediaElement, MediaElementAudioSourceNode>(), links: new WeakMap<AudioNode, AudioNode>(), bytes: new WeakMap<ArrayBuffer, string>(), buffers: new WeakMap<AudioBuffer, string>(), targets: [] as number[], entryPhases: [] as { phase: string; at: number; jpPlaying: number; cameraFrames: string[] }[], jpPlaying: 0, jp: null as HTMLAudioElement | null };
    Reflect.set(window, 'qaSceneAudio', probe); Reflect.set(window, 'qaSceneRandom', 0.1);
    const entryObserver = new MutationObserver(() => {
      const phase = document.querySelector('.game-shell')?.getAttribute('data-entry-phase');
      if (!phase || probe.entryPhases.at(-1)?.phase === phase) return;
      const entry = { phase, at: Date.now(), jpPlaying: probe.jpPlaying, cameraFrames: [] as string[] }; probe.entryPhases.push(entry);
      if (phase === 'entering' && captureCamera) requestAnimationFrame(() => { entry.cameraFrames = document.querySelector('.scene-camera')?.getAnimations().flatMap(animation => animation.effect instanceof KeyframeEffect ? animation.effect.getKeyframes().map(frame => String(frame.transform ?? '')) : []) ?? []; });
    });
    entryObserver.observe(document, { subtree: true, childList: true, attributes: true, attributeFilter: ['data-entry-phase'] });

    // Deterministic scene choice is fixture-only; IDs and auth still use native crypto.
    Math.random = () => Reflect.get(window, 'qaSceneRandom');
    const localHours = Date.prototype.getHours; Date.prototype.getHours = function(this: Date) { const hour = Reflect.get(window, 'qaLocalHour'); return typeof hour === 'number' ? hour : localHours.call(this); };
    const fetchOriginal = window.fetch;
    window.fetch = Object.assign(async (...args: Parameters<typeof fetch>) => { const response = await fetchOriginal(...args); const url = typeof args[0] === 'string' ? args[0] : args[0] instanceof URL ? args[0].href : args[0].url;
      if (url.includes('/audio/game/')) { const arrayBuffer = response.arrayBuffer.bind(response); response.arrayBuffer = async () => { const bytes = await arrayBuffer(); probe.bytes.set(bytes, url); return bytes; }; }
      return response;
    }, fetchOriginal);
    const OriginalContext = window.AudioContext;
    Reflect.set(window, 'AudioContext', new Proxy(OriginalContext, { construct(Target, args) {
      const context: AudioContext = Reflect.construct(Target, args); probe.contexts.push(context);
      const decode = context.decodeAudioData.bind(context); context.decodeAudioData = async bytes => { const buffer = await decode(bytes); probe.buffers.set(buffer, probe.bytes.get(bytes) ?? ''); return buffer; };
      const createSource = context.createBufferSource.bind(context); context.createBufferSource = () => { const node = createSource(); const entry = { node, started: 0, startedAt: null as number | null, stopped: 0 }; probe.sources.push(entry);
        const start = node.start.bind(node); node.start = (...values) => { entry.started++; entry.startedAt ??= Date.now(); start(...values); };
        const stop = node.stop.bind(node); node.stop = (...values) => { entry.stopped++; stop(...values); };
        return node;
      };
      const createGain = context.createGain.bind(context); context.createGain = () => { const node = createGain(); const set = node.gain.setTargetAtTime.bind(node.gain); node.gain.setTargetAtTime = (value, ...args) => { probe.targets.push(value); return set(value, ...args); }; return node; };
      const createMedia = context.createMediaElementSource.bind(context); context.createMediaElementSource = audio => { const node = createMedia(audio); probe.mediaNodes.set(audio, node); return node; };
      return context;
    } }));
    const connect = AudioNode.prototype.connect;
    AudioNode.prototype.connect = function(this: AudioNode, destination: AudioNode | AudioParam, output?: number, input?: number) {
      if (destination instanceof AudioNode) probe.links.set(this, destination);
      return Reflect.apply(connect, this, destination instanceof AudioNode ? [destination, output, input] : [destination, output]);
    } as typeof connect;
    const OriginalAudio = Audio;
    Reflect.set(window, 'Audio', new Proxy(OriginalAudio, { construct(Target, args) {
      const audio: HTMLAudioElement = Reflect.construct(Target, args); const entry = { audio, started: 0, startedAt: null as number | null, stopped: 0 };
      const play = audio.play.bind(audio); audio.play = () => blocked && audio.src.includes('/audio/game/') ? Promise.reject(new DOMException('Fixture media autoplay policy', 'NotAllowedError')) : play();
      // The progressive fixture uses another local port; public media remains readable by WebAudio.
      audio.crossOrigin = 'anonymous'; audio.addEventListener('loadedmetadata', () => { audio.playbackRate = audio.src.includes('/audio/game/') ? 1 : .25; });
      const initialSource = String(args[0] ?? ''); if (initialSource.includes('/audio/game/')) probe.media.push(entry); else if (initialSource) { audio.playbackRate = .25; probe.jp = audio; }
      audio.addEventListener('playing', () => { if (audio.src.includes('/audio/game/')) { entry.started++; entry.startedAt ??= Date.now(); if (!probe.media.includes(entry)) probe.media.push(entry); audio.playbackRate = 1; } else { probe.jpPlaying++; probe.jp = audio; } });
      audio.addEventListener('pause', () => { entry.stopped++; }); return audio;
    } }));
  }, { blocked, captureCamera });
}
async function fixture(reducedMotion: boolean, failAudio = false, animations = true, blocked = false) {
  const email = `scene-audio-${crypto.randomUUID()}@example.test`; emails.push(email);
  const link = await createLink(database, 'invite', email, null); await consumeLink(database, 'invite', link.token, password, 'Проверка звуков сцены');
  await seedAcceptedHistory(database, course, email, course.words.filter(word => word.reviewStatus !== 'draft' && validSegments(word) && !!word.audioUrl).map(word => word.id), ['marugoto.starter-a1.skill.ga_ability', 'marugoto.starter-a1.skill.frequency', 'marugoto.starter-a1.skill.sorekara_sequence']);
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, reducedMotion: reducedMotion ? 'reduce' : 'no-preference', extraHTTPHeaders: { 'x-forwarded-for': nextFixtureIp() } });
  await installProbe(context, blocked, process.env.BROWSER_FINAL_TRANSPORT_ONLY !== 'true');
  const issued: ReviewItem[] = []; const submissions: ReviewSubmission[] = []; let queueGets = 0; let loseAck = false; let retryHeld = false;
  const retryGate = new Promise<void>(resolve => { releaseRetry = resolve; });
  await context.route('**/api/**', async route => {
    const request = route.request(); const target = new URL(request.url()); target.host = `127.0.0.1:${server.port}`;
    if (target.pathname === '/api/reviews' && request.method() === 'POST') submissions.push(request.postDataJSON());
    const response = await route.fetch({ url: target.href });
    if (target.pathname === '/api/reviews' && request.method() === 'GET' && ++queueGets === 1) {
      const queue: ReviewQueue = await response.json(); const listening = queue.items.find(item => item.mode === 'listening'); const card = queue.items.find(item => item.mode === 'ja-ru'); const grammar = queue.items.filter(item => item.mode === 'grammar');
      if (!listening || !card || grammar.length < 3) throw new Error('Fixture requires two real word directions and three grammar tasks.');
      issued.push(listening, card, ...grammar.slice(0, 3)); await route.fulfill({ response, body: JSON.stringify({ ...queue, items: issued }) }); return;
    }
    if (target.pathname === '/api/reviews' && request.method() === 'POST') {
      expect(response.status()).toBe(200);
      if (loseAck) { loseAck = false; await route.abort('failed'); return; }
      if (submissions.length === 2) { retryHeld = true; await retryGate; }
    }
    await route.fulfill({ response });
  });
  if (failAudio) await context.route('**/audio/game/**', route => route.abort('failed'));
  const page = await context.newPage(); const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto(base); await page.getByLabel('Email', { exact: true }).fill(email); await page.getByLabel('Пароль', { exact: true }).fill(password); await page.getByRole('button', { name: 'Войти', exact: true }).click();
  await expect(page.getByRole('navigation', { name: 'Разделы' })).toBeVisible();
  const settings: LearnerSettings = { ...structuredClone(defaultSettings), animations, lessonStatuses: Object.fromEntries(course.lessons.map(lesson => [lesson.id, 'studying'])), focusSkillIds: ['marugoto.starter-a1.skill.ga_ability', 'marugoto.starter-a1.skill.frequency', 'marugoto.starter-a1.skill.sorekara_sequence'], newWordsPerDay: 1, newSkillsPerDay: 3 };
  expect((await context.request.put(`${apiBase}/api/settings`, { headers: { origin: base }, data: settings })).status()).toBe(200); await page.reload();
  return { context, page, errors, email, issued, submissions, queueGets: () => queueGets, loseAck: () => { loseAck = true; }, retryHeld: () => retryHeld };
}

try {
  if (process.env.BROWSER_HMR_ONLY === 'true') {
    const f = await fixture(true); const { context, page } = f;
    try {
      await startSession(page); await expect.poll(async () => (await sound(page)).sources.filter(source => source.loop && source.started).length).toBeGreaterThanOrEqual(2); const before = await sound(page);
      const planBefore = { review: await page.getByTestId('review-gesture').getAttribute('data-review-id'), scene: await page.getByTestId('study-session').getAttribute('data-scene-id'), progress: await page.getByRole('progressbar', { name: 'Прогресс занятия', exact: true }).getAttribute('aria-valuetext'), queueGets: f.queueGets() };
      const refreshResult = await page.evaluate(async () => {
        const modulePath = `${location.origin}/src/client/App.tsx`; const runtimePath = `${location.origin}/@react-refresh`;
        const previous = await import(modulePath); const next = await import(`${modulePath}?t=${Date.now()}`); const runtime = await import(runtimePath);
        runtime.registerExportsForReactRefresh('/src/client/App.tsx', next); return runtime.validateRefreshBoundaryAndEnqueueUpdate('/src/client/App.tsx', previous, next) ?? 'queued';
      });
      await page.waitForTimeout(400); const afterRefresh = { ...(await sound(page)), ui: await page.locator('.game-shell').getAttribute('data-sound-state') };
      const toggle = page.getByRole('button', { name: 'Звуки сцены', exact: true }); await toggle.click(); await expect.poll(async () => (await savedSettings(context)).sceneSoundEnabled).toBe(false); await toggle.click(); await expect.poll(async () => (await savedSettings(context)).sceneSoundEnabled).toBe(true); await page.waitForTimeout(1000);
      const afterGesture = { ...(await sound(page)), ui: await page.locator('.game-shell').getAttribute('data-sound-state') }; const liveLoopsAfterRefresh = afterRefresh.sources.filter(source => source.loop && source.url); const duckRestored = afterRefresh.jpPaused || liveLoopsAfterRefresh.length > 0 && liveLoopsAfterRefresh.every(source => (source.gain[1] ?? 1) < .3); const green = afterGesture.states.includes('running') && !afterGesture.mediaPaused && duckRestored;
      const planAfter = { review: await page.getByTestId('review-gesture').getAttribute('data-review-id'), scene: await page.getByTestId('study-session').getAttribute('data-scene-id'), progress: await page.getByRole('progressbar', { name: 'Прогресс занятия', exact: true }).getAttribute('aria-valuetext'), queueGets: f.queueGets() };
      const report = { isolatedFastRefreshOnly: true, noSourceWriteOrHmrBroadcast: true, refreshResult, before, afterRefresh, afterGesture, duckRestored, planBefore, planAfter, reviewWrites: f.submissions.length, green, errors: f.errors };
      await Bun.write(`${output}/motion-audio-hmr-${green ? 'green' : 'red'}.json`, JSON.stringify(report, null, 2)); console.info(JSON.stringify(report, null, 2)); expect(planAfter).toEqual(planBefore); expect(f.submissions).toHaveLength(0); expect(f.errors).toEqual([]); expect(green).toBe(true);
    } finally { await context.unrouteAll({ behavior: 'ignoreErrors' }); await context.close(); }
  } else if (process.env.BROWSER_STARTUP_ONLY === 'true') {
    const f = await fixture(false); const { context, page } = f; let deliveredBytes = 0; let fullResponseAt: number | null = null;
    const manifest = await (await context.request.get(`${base}/audio/game/manifest.json`)).json(); const musicPath: string = manifest.scenes.room.music;
    const bytes = new Uint8Array(await Bun.file(`${import.meta.dir}/../public${musicPath}`).arrayBuffer());
    const progressive = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: request => {
      const range = /^bytes=(\d+)-(\d*)$/.exec(request.headers.get('range') ?? ''); const first = Number(range?.[1] ?? 0); const last = range?.[2] ? Math.min(Number(range[2]), bytes.length - 1) : bytes.length - 1; let offset = first; let canceled = false;
      const body = new ReadableStream<Uint8Array>({ async pull(controller) { if (offset > first) await new Promise(resolve => setTimeout(resolve, 82)); if (canceled) return; const end = Math.min(offset + 16384, last + 1); controller.enqueue(bytes.subarray(offset, end)); offset = end; deliveredBytes = Math.max(deliveredBytes, end); if (offset > last) { fullResponseAt = Date.now(); controller.close(); } }, cancel() { canceled = true; } });
      return new Response(body, { status: range ? 206 : 200, headers: { 'content-type': 'audio/mp4', 'content-length': String(last - first + 1), 'accept-ranges': 'bytes', 'access-control-allow-origin': '*', 'cache-control': 'no-store', ...(range ? { 'content-range': `bytes ${first}-${last}/${bytes.length}` } : {}) } });
    } });
    try {
      await context.route(`**${musicPath}`, route => { const target = new URL(route.request().url()); target.host = `127.0.0.1:${progressive.port}`; return route.continue({ url: target.href }); });
      const started = await startSession(page); await expect(page.getByRole('region', { name: 'Начало занятия', exact: true })).toHaveAttribute('data-phase', 'entering'); const entering = await entryStartedAt(page);
      await page.waitForTimeout(3050); const atIntroEnd = { elapsedMs: Date.now() - started, enteringMs: Date.now() - entering, state: await page.locator('.game-shell').getAttribute('data-sound-state'), actualMusicStarts: await starts(page, musicPath), deliveredBytes, totalBytes: bytes.length };
      await expect.poll(() => starts(page, musicPath), { timeout: 20000 }).toBeGreaterThan(0); const firstMusic = (await sound(page)).sources.find(source => source.url.endsWith(musicPath) && source.startedAt); const green = atIntroEnd.actualMusicStarts > 0 && atIntroEnd.deliveredBytes < bytes.length;
      const report = { criterion: 'Music actually starts before the three-second intro ends and before its complete HTTP response is delivered.', rateBitsPerSecond: Math.round(16384 / .082 * 8), atIntroEnd, actualMusicStartMs: firstMusic?.startedAt ? firstMusic.startedAt - started : null, fullResponseMs: fullResponseAt === null ? null : fullResponseAt - started, green, errors: f.errors };
      await Bun.write(`${output}/motion-audio-startup-${green ? 'green' : 'red'}.json`, JSON.stringify(report, null, 2)); console.info(JSON.stringify(report, null, 2)); expect(f.errors).toEqual([]); expect(green).toBe(true);
    } finally { await context.unrouteAll({ behavior: 'ignoreErrors' }); await context.close(); progressive.stop(true); }
  } else {
  const remainder = process.env.BROWSER_FINAL_REMAINDER === 'true'; const transportOnly = process.env.BROWSER_FINAL_TRANSPORT_ONLY === 'true';
  if (transportOnly) {
    const f = await fixture(false); const { page, context } = f;
    try {
      const started = await startSession(page);
      await page.waitForFunction(start => Reflect.get(window, 'qaSceneAudio').entryPhases.some((entry: { phase: string; at: number }) => entry.phase === 'ready' && entry.at >= start), started, { timeout: 30000 });
      const phases: { phase: string; at: number; jpPlaying: number }[] = await page.evaluate(start => Reflect.get(window, 'qaSceneAudio').entryPhases.filter((entry: { at: number }) => entry.at >= start), started);
      const entering = phases.find(entry => entry.phase === 'entering'); const ready = phases.find(entry => entry.phase === 'ready');
      await expect.poll(async () => (await sound(page)).sources.filter(source => source.loop && source.started > 0).length).toBeGreaterThanOrEqual(2); await expect.poll(async () => (await sound(page)).jpPlaying).toBeGreaterThan(0);
      const introMs = entering && ready ? ready.at - entering.at : null; const media = await sound(page); const report = { introMs, phases, loopsStarted: media.sources.filter(source => source.loop && source.started > 0).length, jpPlayingEvents: media.jpPlaying, reviewWrites: f.submissions.length, errors: f.errors };
      await Bun.write(`${output}/learning-scene-transport-2026-10-21.json`, JSON.stringify(report, null, 2)); console.info(JSON.stringify(report, null, 2));
      expect(entering).toBeDefined(); expect(ready).toBeDefined(); expect(introMs).toBeGreaterThanOrEqual(2600); expect(introMs).toBeLessThan(4500); expect(entering!.jpPlaying).toBe(0); expect(ready!.jpPlaying).toBe(0); expect(f.submissions).toHaveLength(0); expect(f.errors).toEqual([]); results.push(report); await checkpoint();
    } finally { await context.unrouteAll({ behavior: 'ignoreErrors' }); await context.close(); }
  } else if (!remainder) {
  const f = await fixture(false); const { page, context } = f;
  try {
    const manifest = await (await context.request.get(`${base}/audio/game/manifest.json`)).json();
    const cues = manifest.sfx as Record<string, string>;
    expect((await sound(page)).sources).toHaveLength(0);
    const started = await startSession(page);
    const intro = page.getByRole('region', { name: 'Начало занятия', exact: true }); const session = page.getByTestId('study-session'); const gesture = page.getByTestId('review-gesture');
    const introKeyboardCheck = await intro.isVisible();
    if (introKeyboardCheck) { await expect(session).not.toBeVisible(); await page.keyboard.press('ArrowRight'); }
    expect(f.submissions).toHaveLength(0); expect(Object.values((await progress(context)).byMode).every(mode => mode.reviewedToday === 0)).toBe(true);
    await expect(intro).toHaveCount(0, { timeout: 6000 });
    const phases = await page.evaluate(start => Reflect.get(window, 'qaSceneAudio').entryPhases.filter((entry: { at: number }) => entry.at >= start), started);
    const enteringPhase = phases.find((entry: { phase: string }) => entry.phase === 'entering'); const readyPhase = phases.find((entry: { phase: string }) => entry.phase === 'ready');
    expect(enteringPhase).toBeDefined(); expect(readyPhase).toBeDefined(); expect(enteringPhase.jpPlaying).toBe(0); expect(readyPhase.jpPlaying).toBe(0);
    const cameraFrames: string[] = enteringPhase.cameraFrames; expect(cameraFrames.some(frame => /scale/.test(frame))).toBe(true);
    const introMs = readyPhase.at - enteringPhase.at; const clickToReadyMs = readyPhase.at - started; expect(introMs).toBeGreaterThanOrEqual(2600); expect(introMs).toBeLessThan(4500);
    await expect(gesture).toBeVisible(); await expect(session).toHaveAttribute('data-scene-id', 'room');
    const decorAtStart = await decoration(page); expect(['morning', 'day', 'evening']).toContain(decorAtStart.period); expect(decorAtStart.props).toHaveLength(4);
    await expect.poll(async () => (await sound(page)).sources.filter(source => source.loop && source.started > 0).length).toBeGreaterThanOrEqual(2);
    await expect.poll(async () => (await sound(page)).jpPlaying).toBeGreaterThan(0);
    await expect.poll(async () => (await sound(page)).sources.some(source => source.loop && (source.gain[1] ?? 1) < .3)).toBe(true);
    await expect.poll(async () => (await sound(page)).jpPaused, { timeout: 15000 }).toBe(true);
    await expect.poll(async () => (await sound(page)).sources.filter(source => source.loop).every(source => (source.gain[1] ?? 0) > .95)).toBe(true);
    const initialGains = (await sound(page)).sources.filter(source => source.loop).map(source => source.gain[0]).sort(); expect(initialGains[0]).toBeCloseTo(.12, 2); expect(initialGains[1]).toBeCloseTo(.18, 2);
    const rig = await checkRig(page, false);
    expect(f.submissions).toHaveLength(0);
    const initialBox = await gesture.boundingBox(); expect(initialBox).not.toBeNull();
    await page.waitForTimeout(350); expect((await gesture.boundingBox())!.y).toBeCloseTo(initialBox!.y, 1);
    const revealBefore = await starts(page, cues.reveal!); await page.getByTestId('card-face').click();
    await expect.poll(() => starts(page, cues.reveal!)).toBe(revealBefore + 1); await page.getByTestId('card-face').click(); expect(await starts(page, cues.reveal!)).toBe(revealBefore + 1);
    await expect(page.getByTestId('scene-companion')).toHaveAttribute('data-activity', 'revealed');
    f.loseAck(); const goodBefore = await starts(page, cues.good!); await expect(gesture.locator('.card-actions button').first()).toBeEnabled(); await gesture.focus(); await page.keyboard.press('ArrowRight');
    const retry = page.getByRole('button', { name: 'Повторить сохранение', exact: true }); await expect(retry).toBeVisible(); expect(await starts(page, cues.good!)).toBe(goodBefore);
    await retry.click(); await expect.poll(f.retryHeld).toBe(true); expect(f.submissions).toHaveLength(2); expect(f.submissions[1]).toEqual(f.submissions[0]); expect(await starts(page, cues.good!)).toBe(goodBefore); releaseRetry?.();
    await expect(gesture).toHaveAttribute('data-review-id', f.issued[1]!.id); await expect.poll(() => starts(page, cues.good!)).toBe(goodBefore + 1);
    await page.getByTestId('card-face').click(); const againBefore = await starts(page, cues.again!); await expect(gesture.locator('.card-actions button').first()).toBeEnabled(); await gesture.focus(); await page.keyboard.press('ArrowLeft');
    await expect(gesture).toHaveAttribute('data-review-id', f.issued[2]!.id); await expect.poll(() => starts(page, cues.again!)).toBe(againBefore + 1);
    const grammar = f.issued[2]; if (grammar?.mode !== 'grammar') throw new Error('Expected real grammar task');
    const bank = page.getByRole('group', { name: 'Доступные элементы', exact: true }); const area = page.getByRole('group', { name: 'Ваше предложение', exact: true }); const order = grammar.exercise.acceptedOrders[0]!;
    for (const id of order) await bank.locator(`[data-token-id="${id}"]`).click();
    await expect(page.locator('[data-outcome="correct"]')).toBeVisible(); expect(await starts(page, cues.good!)).toBe(goodBefore + 1); expect((await progress(context)).byMode.grammar.reviewedToday).toBe(0);
    const moveBefore = await starts(page, cues.move!); const tokens = area.locator('[data-token-id]'); await tokens.first().focus(); await page.keyboard.press('ArrowRight');
    await expect.poll(() => starts(page, cues.move!)).toBe(moveBefore + 1); await tokens.last().focus(); await page.keyboard.press('ArrowRight'); expect(await starts(page, cues.move!)).toBe(moveBefore + 1);
    await expect(page.locator('[data-outcome="incorrect"]')).toBeVisible(); expect(await starts(page, cues.again!)).toBe(againBefore + 1); expect(await starts(page, cues.good!)).toBe(goodBefore + 1);
    await tokens.nth(1).focus(); await page.keyboard.press('ArrowLeft'); await expect(page.locator('[data-outcome="correct"]')).toBeVisible();
    const tokenIds = await tokens.evaluateAll(elements => elements.map(element => element.getAttribute('data-token-id')));
    const nextLocalHour = decorAtStart.period === 'morning' ? 13 : 7; await page.evaluate(hour => Reflect.set(window, 'qaLocalHour', hour), nextLocalHour);
    const nav = page.getByRole('navigation', { name: 'Разделы' }); await nav.getByRole('button', { name: 'Учебник', exact: true }).click();
    await scenePaused(page); await page.keyboard.press('ArrowRight'); expect(f.submissions).toHaveLength(3);
    const lessonCards = page.locator('.lesson-card'); await expect(lessonCards).toHaveCount(18); await expect(page.getByTestId('train-lesson')).toHaveCount(18);
    expect(await lessonCards.locator('.lesson-material').evaluateAll(cards => cards.every(card => card instanceof HTMLDetailsElement && !card.open))).toBe(true);
    await expect(page.locator('.textbook-filters,.lesson-card select,.lesson-card input[type="checkbox"]')).toHaveCount(0);
    await page.setViewportSize({ width: 390, height: 844 }); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true); const mobileTiles = await lessonCards.evaluateAll(cards => cards.slice(0, 3).map(card => card.getBoundingClientRect().toJSON())); expect(mobileTiles[0]!.top).toBe(mobileTiles[1]!.top); expect(mobileTiles[2]!.top).toBeGreaterThan(mobileTiles[0]!.top); await page.setViewportSize({ width: 1280, height: 900 }); expect(f.submissions).toHaveLength(3);
    await nav.getByRole('button', { name: 'Повторение', exact: true }).click(); await expect(gesture).toBeVisible(); await expect(intro).toHaveCount(0); expect(f.queueGets()).toBe(1); expect(await tokens.evaluateAll(elements => elements.map(element => element.getAttribute('data-token-id')))).toEqual(tokenIds);
    expect(await decoration(page)).toEqual(decorAtStart);
    await expect.poll(async () => (await sound(page)).states.includes('running')).toBe(true);
    await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, value: true }); document.dispatchEvent(new Event('visibilitychange')); });
    await scenePaused(page);
    await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, value: false }); document.dispatchEvent(new Event('visibilitychange')); });
    await expect.poll(async () => (await sound(page)).states.includes('running')).toBe(true); await expect(intro).toHaveCount(0);
    await openSettings(page); const volumeControls: [string, string, 'musicVolume' | 'ambienceVolume' | 'sfxVolume' | 'speechVolume'][] = [['Музыка', '31', 'musicVolume'], ['Звуки окружения', '22', 'ambienceVolume'], ['Эффекты действий', '43', 'sfxVolume'], ['Японская озвучка', '64', 'speechVolume']];
    for (const [name, value] of volumeControls) {
      const range = page.getByRole('slider', { name: new RegExp(`^${name}`) }); await range.press('Home'); for (let step = 0; step < Number(value); step++) await range.press('ArrowRight'); await expect(range).toHaveValue(value);
    }
    await page.getByRole('button', { name: 'Сохранить громкость', exact: true }).click(); for (const [, value, field] of volumeControls) await expect.poll(async () => (await savedSettings(context))[field]).toBe(Number(value) / 100);
    await nav.getByRole('button', { name: 'Повторение', exact: true }).click();
    const toggle = page.getByRole('button', { name: 'Звуки сцены', exact: true }); await toggle.click(); await expect.poll(async () => (await savedSettings(context)).sceneSoundEnabled).toBe(false);
    await scenePaused(page);
    const jpBefore = (await sound(page)).jpPlaying;
    expect((await savedSettings(context)).speechVolume).toBe(.64); await toggle.click(); await expect.poll(async () => (await savedSettings(context)).sceneSoundEnabled).toBe(true);
    await expect.poll(async () => (await sound(page)).sources.some(source => source.loop && Math.abs((source.gain[0] ?? 0) - .31) < .02)).toBe(true); await expect(toggle).toBeEnabled();
    await expect(gesture.locator('.card-actions button').first()).toBeEnabled(); await gesture.focus(); await page.keyboard.press('ArrowRight'); await expect(gesture).toHaveAttribute('data-review-id', f.issued[3]!.id);
    await page.getByLabel('Действия карточки', { exact: true }).click(); await page.getByRole('button', { name: 'Ввести фразу', exact: true }).click();
    const manual = page.getByRole('dialog', { name: 'Ввести фразу', exact: true }); await manual.getByRole('textbox', { name: 'Ваша фраза', exact: true }).fill('わたしはがっこうをです。'); await manual.getByRole('button', { name: 'Закрыть редактор', exact: true }).click();
    await expect(page.locator('[data-outcome="exploration"]')).toBeVisible(); await expect(page.getByRole('heading', { name: 'Свободный разбор недоступен', exact: true })).toBeVisible();
    const resultsBeforeNeutral = { good: await starts(page, cues.good!), again: await starts(page, cues.again!) };
    await expect(gesture.locator('.card-actions button').first()).toBeEnabled(); await gesture.focus(); await page.keyboard.press('ArrowRight'); await expect(gesture).toHaveAttribute('data-review-id', f.issued[4]!.id); await bank.locator('[data-token-id]').first().click(); await expect(page.locator('[data-outcome="incomplete"]')).toBeVisible();
    expect({ good: await starts(page, cues.good!), again: await starts(page, cues.again!) }).toEqual(resultsBeforeNeutral); const completeBefore = await starts(page, cues.complete!);
    await expect(gesture.locator('.card-actions button').first()).toBeEnabled(); await gesture.focus(); await page.keyboard.press('ArrowRight'); await expect(page.getByRole('heading', { name: 'Повторение завершено', exact: true })).toBeVisible();
    await expect.poll(() => starts(page, cues.complete!)).toBe(completeBefore + 1); expect(f.submissions).toHaveLength(4); expect((await progress(context)).byMode.grammar.reviewedToday).toBe(1);
    await page.getByRole('button', { name: 'Завершить', exact: true }).click(); await scenePaused(page);
    const accents: object[] = [];
    for (const [index, scene] of ['room', 'garden', 'mountains', 'river', 'tokyo'].entries()) {
      await page.evaluate(value => Reflect.set(window, 'qaSceneRandom', value), (index + .5) / 5); await openRepeat(page); await expect(intro).toBeVisible();
      const skipStarted = Date.now(); await page.getByRole('button', { name: 'Перейти к занятию', exact: true }).click(); await expect(intro).toHaveCount(0); expect(Date.now() - skipStarted).toBeLessThan(1000); await expect(gesture).toBeVisible(); await expect(session).toHaveAttribute('data-scene-id', scene);
      const regional = await page.locator('.scene-accent').evaluateAll(elements => elements.map(element => ({ accent: element.getAttribute('data-accent'), animation: getComputedStyle(element).animationName, box: element.getBoundingClientRect().toJSON() })));
      expect(regional.length).toBeGreaterThan(0); expect(regional.some(accent => accent.animation !== 'none')).toBe(true); accents.push({ scene, regional });
      const decor = await decoration(page); expect(decor.period).toBe(nextLocalHour === 13 ? 'day' : 'morning'); expect(decor.props).toHaveLength(4); expect(await page.locator('.desk-prop').evaluateAll(props => props.every(prop => getComputedStyle(prop).backgroundImage !== 'none' && getComputedStyle(prop).pointerEvents === 'none'))).toBe(true);
      const camera = await page.locator('.scene-camera').evaluate(element => getComputedStyle(element).transform);
      const timeBefore = await page.locator('.scene-accent').evaluateAll(elements => elements.flatMap(element => element.getAnimations().map(animation => Number(animation.currentTime)))); await page.waitForTimeout(220);
      const timeAfter = await page.locator('.scene-accent').evaluateAll(elements => elements.flatMap(element => element.getAnimations().map(animation => Number(animation.currentTime)))); expect(timeAfter.some((time, index) => time > (timeBefore[index] ?? Infinity))).toBe(true); expect(await page.locator('.scene-camera').evaluate(element => getComputedStyle(element).transform)).toBe(camera);
      if (scene === 'room') {
        await page.setViewportSize({ width: 390, height: 844 });
        if (await gesture.locator('[lang="ja"]:visible').count() === 0) await page.getByTestId('card-face').click(); await expect(gesture.locator('[lang="ja"]:visible').first()).toBeVisible();
        const geometry = await gesture.evaluate(element => {
          const box = element.getBoundingClientRect(); const cat = document.querySelector('.scene-companion img')?.getBoundingClientRect(); const controls = [...element.querySelectorAll('button,input,select,summary')].filter(node => node.getBoundingClientRect().height > 0); const japanese = [...element.querySelectorAll('[lang="ja"]')].filter(node => node.getBoundingClientRect().height > 0);
          return { top: box.top + scrollY, ratio: box.width / innerWidth, minFont: Math.min(...japanese.map(node => parseFloat(getComputedStyle(node).fontSize))), minControl: Math.min(...controls.map(node => node.getBoundingClientRect().height)), catOverlaps: !!cat && [...japanese, ...controls].some(node => { const target = node.getBoundingClientRect(); return cat.left < target.right && cat.right > target.left && cat.top < target.bottom && cat.bottom > target.top; }) };
        });
        expect(geometry.ratio).toBeGreaterThanOrEqual(.975); expect(geometry.top).toBeLessThanOrEqual(844 * .25); expect(geometry.minFont).toBeGreaterThanOrEqual(22); expect(geometry.minControl).toBeGreaterThanOrEqual(44); expect(geometry.catOverlaps).toBe(false); results.push({ mobileGeometry: geometry }); await page.setViewportSize({ width: 1280, height: 900 });
      }
      await page.getByRole('button', { name: 'Завершить', exact: true }).click();
    }
    await openSettings(page); await toggle.click(); await expect.poll(async () => (await savedSettings(context)).sceneSoundEnabled).toBe(false); const beforeReload = await savedSettings(context); await page.reload(); expect(await savedSettings(context)).toEqual(beforeReload);
    await page.screenshot({ path: `${output}/qa-scene-audio-settings.png`, fullPage: true }); await settingsMenu(page); await page.getByRole('button', { name: 'Выйти', exact: true }).click(); await expect(page.getByRole('heading', { name: 'Войти', exact: true })).toBeVisible();
    await scenePaused(page);
    const otherEmail = `scene-other-${crypto.randomUUID()}@example.test`; emails.push(otherEmail); const otherLink = await createLink(database, 'invite', otherEmail, null); await consumeLink(database, 'invite', otherLink.token, password, 'Другой ученик');
    await page.getByLabel('Email', { exact: true }).fill(otherEmail); await page.getByLabel('Пароль', { exact: true }).fill(password); await page.getByRole('button', { name: 'Войти', exact: true }).click(); await expect(nav).toBeVisible(); const other = await savedSettings(context);
    expect({ music: other.musicVolume, ambience: other.ambienceVolume, sfx: other.sfxVolume, speech: other.speechVolume, enabled: other.sceneSoundEnabled }).toEqual({ music: .18, ambience: .12, sfx: .25, speech: 1, enabled: true }); await expect(session).toHaveCount(0); expect(f.errors).toEqual([]);
    results.push({ introMs, clickToReadyMs, introKeyboardCheck, cameraFrames, accents, rig, decorAtStart, clockChangedButDecorLocked: true, mobileTiles, textbookCardsAndRemovedManualFilters: true, actualAudioAndDuck: true, sourceCues: true, sameAttemptAckOnce: true, draftAndNeutralNoResultCue: true, nativePlaybackPause: true, simulatedVisibilityPause: true, settingsPersistAndIsolate: true, jpBefore, errors: f.errors }); await checkpoint();
  } catch (error) { releaseRetry?.(); await page.screenshot({ path: `${output}/qa-scene-audio-failure.png`, fullPage: true }); console.info(await page.locator('#main').ariaSnapshot()); throw error; }
  finally { releaseRetry?.(); await context.unrouteAll({ behavior: 'ignoreErrors' }); await context.close(); }
  {
    const f = await fixture(false); const { page, context } = f; let releaseImage: (() => void) | undefined; const imageGate = new Promise<void>(resolve => { releaseImage = resolve; });
    try {
      await context.route(/\/scenes\/garden-(?:mobile-)?v1\.webp$/, async route => { await imageGate; await route.continue(); });
      await page.evaluate(() => Reflect.set(window, 'qaSceneRandom', .3)); await openRepeat(page);
      const intro = page.getByRole('region', { name: 'Начало занятия', exact: true }); await expect(intro).toHaveAttribute('data-phase', 'loading'); await page.waitForTimeout(350); await expect(intro).toHaveAttribute('data-phase', 'loading');
      await expect(page.getByTestId('study-session')).not.toBeVisible(); expect((await sound(page)).jpPlaying).toBe(0); expect(f.submissions).toHaveLength(0);
      const plate = page.locator('.scene-atmosphere'); await expect(plate).toHaveAttribute('data-scene', 'garden'); await expect(plate).toHaveAttribute('data-ready', 'false'); expect(await plate.locator('.scene-plate img').evaluate(element => getComputedStyle(element).opacity)).toBe('0');
      await page.getByRole('button', { name: 'Перейти к занятию', exact: true }).click(); await expect(page.getByTestId('review-gesture')).toBeVisible(); releaseImage?.(); await expect(plate).toHaveAttribute('data-ready', 'true'); await page.getByRole('button', { name: 'Завершить', exact: true }).click();
      await context.route(/\/scenes\/river-(?:mobile-)?v1\.webp$/, route => route.abort('failed')); await page.evaluate(() => Reflect.set(window, 'qaSceneRandom', .7)); const failedStart = Date.now(); await openRepeat(page);
      await expect(page.getByTestId('review-gesture')).toBeVisible({ timeout: 2500 }); expect(Date.now() - failedStart).toBeLessThan(2500); await expect(intro).toHaveCount(0); await expect(plate).toHaveAttribute('data-ready', 'false'); expect(f.submissions).toHaveLength(0); expect(f.errors).toEqual([]);
      results.push({ delayedSelectedPlate: true, oldPlateHidden: true, loadingSkipWorks: true, failedPlateFallbackWorks: true, noJapaneseBeforeReady: true, errors: f.errors }); await checkpoint();
    } finally { releaseImage?.(); await context.unrouteAll({ behavior: 'ignoreErrors' }); await context.close(); }
  }
  } else {
    // Small native gallery check; full new learning flow lives in integration.learning.browser.ts.
    const f = await fixture(true); const { page, context } = f;
    try {
      const cards = page.locator('.lesson-card'); await expect(cards).toHaveCount(18); await expect(page.getByTestId('train-lesson')).toHaveCount(18);
      const details = cards.first().locator('.lesson-material'); await details.locator(':scope > summary').press('Enter'); await expect(details).toHaveAttribute('open', '');
      await details.locator(':scope > summary').press('Enter'); await expect(details).not.toHaveAttribute('open', '');
      await expect(page.locator('.textbook-filters,.lesson-card select,.lesson-card input[type="checkbox"]')).toHaveCount(0); expect(f.submissions).toHaveLength(0); expect(f.errors).toEqual([]);
      results.push({ nativeGalleryDisclosure: true, visibleTrainButtons: 18, removedManualFilters: true, errors: f.errors }); await checkpoint();
    } finally { await context.unrouteAll({ behavior: 'ignoreErrors' }); await context.close(); }
  }
  const variants = [{ reduced: true, failAudio: false, animations: true, blocked: false }, { reduced: true, failAudio: true, animations: true, blocked: false }, { reduced: false, failAudio: false, animations: false, blocked: true }];
  for (const variant of variants.filter(variant => transportOnly ? variant.reduced && variant.failAudio : !remainder || variant.blocked)) {
    const { reduced, failAudio, animations, blocked } = variant; const f = await fixture(reduced, failAudio, animations, blocked); const { page, context } = f;
    try {
      if (reduced && !failAudio) { await openSettings(page); const speech = page.getByRole('slider', { name: /^Японская озвучка/ }); await speech.press('Home'); for (let step = 0; step < 64; step++) await speech.press('ArrowRight'); await page.getByRole('button', { name: 'Сохранить громкость', exact: true }).click(); await expect.poll(async () => (await savedSettings(context)).speechVolume).toBe(.64); await page.getByRole('navigation', { name: 'Разделы' }).getByRole('button', { name: 'Повторение', exact: true }).click(); }
      const start = Date.now(); await openRepeat(page); await expect(page.getByTestId('review-gesture')).toBeVisible({ timeout: 2000 }); if (!transportOnly) expect(Date.now() - start).toBeLessThan(2000); if (transportOnly) expect(await page.evaluate(started => Reflect.get(window, 'qaSceneAudio').entryPhases.some((entry: { phase: string; at: number }) => entry.phase === 'entering' && entry.at >= started), start)).toBe(false); await expect(page.getByRole('region', { name: 'Начало занятия', exact: true })).toHaveCount(0);
      const animations = await page.locator('.scene-camera,.scene-accent').evaluateAll(elements => elements.map(element => getComputedStyle(element).animationName)); expect(animations.every(value => value === 'none')).toBe(true);
      await expect.poll(async () => (await sound(page)).jpPlaying).toBeGreaterThan(0);
      expect(await page.evaluate(() => Reflect.get(window, 'qaSceneAudio').jp.volume)).toBe((await savedSettings(context)).speechVolume);
      if (reduced && !failAudio) { await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, value: true }); document.dispatchEvent(new Event('visibilitychange')); }); await scenePaused(page); await expect.poll(async () => (await sound(page)).jpPaused).toBe(true); await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, value: false }); document.dispatchEvent(new Event('visibilitychange')); }); }
      await expect.poll(async () => (await sound(page)).jpPaused, { timeout: 15000 }).toBe(true); const rig = await checkRig(page, true);
      if (failAudio || blocked) await expect(page.locator('.game-shell')).toHaveAttribute('data-sound-state', blocked ? 'blocked' : 'unavailable');
      await page.getByRole('button', { name: 'Звуки сцены', exact: true }).click(); const plays = (await sound(page)).jpPlaying; const replay = page.getByRole('button', { name: 'Прослушать ещё раз', exact: true }); await expect(replay).toBeEnabled({ timeout: 15000 }); await replay.click(); await expect.poll(async () => (await sound(page)).jpPlaying).toBeGreaterThan(plays);
      await page.getByTestId('card-face').click(); await page.getByTestId('review-gesture').focus(); await page.keyboard.press('ArrowRight');
      await expect(page.getByTestId('review-gesture')).toHaveAttribute('data-review-id', f.issued[1]!.id); expect(f.submissions).toHaveLength(1);
      if (failAudio) await expect(page.getByRole('button', { name: 'Повторить сохранение', exact: true })).toHaveCount(0);
      expect(f.errors).toEqual([]); results.push({ reducedMotion: reduced, animations, failedSceneAudio: failAudio, blockedAudio: blocked, noIntroWait: true, rig, jpIndependentOfSceneMute: true, errors: f.errors }); await checkpoint();
    } finally { releaseRetry?.(); await context.unrouteAll({ behavior: 'ignoreErrors' }); await context.close(); }
  }
  const report = { complete: true, scope: transportOnly ? 'final-native-intro-media-and-reduced-missing-media' : remainder ? 'final-textbook-and-native-autoplay-denial' : 'full', browser: browser.version(), results };
  await Bun.write(`${output}/learning-scene-audio${transportOnly ? '-transport' : remainder ? '-remainder' : ''}-2026-10-21.json`, JSON.stringify(report, null, 2)); console.info(JSON.stringify(report, null, 2));
  }
} finally {
  releaseRetry?.(); await browser.close(); server.stop(true); provider.stop(true);
  for (const email of emails) { await database.sql`delete from access_links where email=${email}`; await database.sql`delete from users where email=${email}`; }
  await database.sql.close();
}
