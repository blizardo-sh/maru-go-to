// Manual network check: real official media, no accounts, API, database or saved video files.
import { chromium } from '@playwright/test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { course } from '../src/shared/course';
import { output } from './helpers/artifact-output';

const root = resolve(import.meta.dir, '..');
const args = process.argv.slice(2);
const templateMode = args.includes('--template-policy');
const origin = args.find(arg => !arg.startsWith('--')) ?? 'https://outboundserver.freemyip.com';
const address = new URL(origin);
if (args.some(arg => arg.startsWith('--') && arg !== '--template-policy') || args.filter(arg => !arg.startsWith('--')).length > 1 || address.protocol !== 'https:' || address.username || address.password || address.pathname !== '/' || address.search || address.hash) throw new Error('Usage: bun tests/integration.lesson-video.browser.ts [https://origin] [--template-policy]');
const site = address.origin;
const videos = course.lessons.filter(lesson => lesson.video).map(lesson => ({ lesson: lesson.number, material: lesson.video! }));
if (videos.map(video => video.lesson).join(',') !== '1,2,3,4') throw new Error('Expected the four reviewed lesson videos.');
const template = readFileSync(join(root, 'deployment/nginx-http.conf'), 'utf8').match(/add_header Content-Security-Policy "([^"]+)" always;/)?.[1];
if (!template) throw new Error('Missing reviewed nginx policy.');
const scratch = mkdtempSync(join(tmpdir(), 'maru-video-probe-'));
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
const results: object[] = [];
let green = true;
try {
  const entry = join(scratch, 'entry.ts');
  await Bun.write(entry, `import {createElement} from ${JSON.stringify(join(root, 'node_modules/react'))};
import {createRoot} from ${JSON.stringify(join(root, 'node_modules/react-dom/client'))};
import {LessonVideo} from ${JSON.stringify(join(root, 'src/client/LessonVideo'))};
const videos=${JSON.stringify(videos)};
const selected=videos.find(video=>video.lesson===Number(new URL(location.href).searchParams.get('lesson')));
createRoot(document.getElementById('root')).render(createElement(LessonVideo,{material:selected.material}));`);
  const built = await Bun.build({ entrypoints: [entry], target: 'browser', format: 'esm', minify: true, define: { 'process.env.NODE_ENV': '"production"' } });
  if (!built.success) throw new Error(built.logs.join('\n'));
  const javascript = await built.outputs[0]!.text();
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  for (const { lesson, material } of videos) {
    const context = await browser.newContext();
    const page = await context.newPage();
    const violations: object[] = [];
    const responses: { status: number; contentType: string | undefined; contentRange: string | undefined }[] = [];
    let publishedPolicies: string[] = [];
    let documentStatus = 0;
    let deliveredPolicy = '';
    let documentError = '';
    await page.exposeFunction('recordVideoPolicy', (value: object) => { violations.push(value); });
    await page.addInitScript(() => document.addEventListener('securitypolicyviolation', event => {
      const host = window as unknown as { recordVideoPolicy: (value: object) => Promise<void> };
      void host.recordVideoPolicy({ directive: event.effectiveDirective, blockedURI: event.blockedURI, disposition: event.disposition });
    }));
    page.on('response', async response => {
      if (response.url() !== material.mediaUrl) return;
      const headers = await response.allHeaders();
      responses.push({ status: response.status(), contentType: headers['content-type'], contentRange: headers['content-range'] });
    });
    await page.route(`${site}/__maru_video_probe.js`, route => route.fulfill({ status: 200, contentType: 'application/javascript', body: javascript }));
    const documentUrl = `${site}/?maru-video-probe=1&lesson=${lesson}`;
    await page.route(documentUrl, async route => {
      try {
        const upstream = await route.fetch({ timeout: 20000 });
        documentStatus = upstream.status();
        publishedPolicies = upstream.headersArray().filter(header => header.name.toLowerCase() === 'content-security-policy').map(header => header.value);
        if (documentStatus !== 200 || !publishedPolicies.length) throw new Error('Published document or enforced CSP unavailable.');
        // A future meta policy needs explicit review; never silently remove a restriction.
        if (/http-equiv\s*=\s*["']?content-security-policy/i.test(await upstream.text())) throw new Error('Published page has a meta CSP; this probe cannot safely replay it.');
        const headers = upstream.headers();
        delete headers['content-length']; delete headers['content-encoding'];
        deliveredPolicy = templateMode ? template : publishedPolicies.join(', ');
        headers['content-security-policy'] = deliveredPolicy;
        await route.fulfill({ status: documentStatus, headers, body: '<!doctype html><html lang="ru"><meta charset="utf-8"><body><div id="root"></div><script type="module" src="/__maru_video_probe.js"></script></body></html>' });
      } catch (error) { documentError = String(error); await route.abort(); }
    });
    try {
      await page.goto(documentUrl, { timeout: 25000 });
      const media = page.locator('video');
      await media.waitFor({ timeout: 5000 });
      await media.click({ position: { x: 15, y: 15 } });
      const playback = await media.evaluate(async (video: HTMLVideoElement) => {
        const play = await Promise.race([
          video.play().then(() => 'resolved').catch((error: Error) => `${error.name}: ${error.message}`),
          new Promise<string>(resolve => setTimeout(() => resolve('timeout'), 10000)),
        ]);
        await new Promise(resolve => setTimeout(resolve, 1500));
        return { play, currentTime: video.currentTime, readyState: video.readyState, error: video.error ? { code: video.error.code, message: video.error.message } : null };
      });
      const passed = playback.currentTime > .25 && !playback.error && responses.some(response => response.status === 206 && response.contentType?.startsWith('video/mp4')) && !violations.length;
      green &&= passed;
      results.push({ lesson, source: material.mediaUrl, documentStatus, publishedPolicies, deliveredPolicy, playback, responses, violations, passed });
    } catch (error) { green = false; results.push({ lesson, source: material.mediaUrl, documentStatus, publishedPolicies, deliveredPolicy, documentError, failure: String(error), passed: false }); }
    finally { await context.close(); }
  }
  const report = { mode: templateMode ? 'isolated-template-policy' : 'fresh-published-policy', site, browser: browser.version(), checkedAt: new Date().toISOString(), green, accountsUsed: false, savedMediaFiles: false, results };
  await Bun.write(`${output}/lesson-video-${templateMode ? 'template' : 'published'}.json`, JSON.stringify(report, null, 2));
  console.info(JSON.stringify(report, null, 2));
  if (!green) process.exitCode = 1;
} finally { await browser?.close(); rmSync(scratch, { recursive: true, force: true }); }
