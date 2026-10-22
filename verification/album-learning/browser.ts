import { mkdir } from 'node:fs/promises';
import { chromium, expect } from '@playwright/test';
import { checkAlbumOverview, checkLazyIllustrations } from './checks';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defaultSettings } from '../../src/server/material';
import type { Course } from '../../src/shared/types';

const fixture = await Bun.file(process.env.ALBUM_FIXTURE_PATH ?? join(tmpdir(),'maru-album-fixture.json')).json();
if (fixture.base !== 'http://localhost:5298' || fixture.database !== 'japanese_app_test') throw new Error('Isolated album preview required');
const actor = fixture.actors[1]; const base = fixture.base;
const output = process.env.ALBUM_ARTIFACT_DIR ?? join(tmpdir(),'maru-album-browser'); await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce', extraHTTPHeaders: { 'x-forwarded-for': '198.18.98.1' } });
// Freeze only the dedicated source preview's dev transport; built-app CI has no HMR.
if(new URL(base).port==='5298')await context.routeWebSocket(url=>['localhost','127.0.0.1'].includes(url.hostname)&&url.port==='5298',socket=>socket.close());
const page = await context.newPage(); page.setDefaultTimeout(15000); const errors: string[] = [];
page.on('pageerror', error => errors.push(error.message));
const report: Record<string, unknown> = { base, isolatedContext: true, databaseReset: false, fixture: actor.id };
try {
  const login = await context.request.post(base + '/api/auth/sign-in/email', { headers: { origin: base }, data: { email: actor.email, password: actor.password } });
  expect(login.status()).toBe(200);
  const headers = { origin: base, 'X-Learning-Learner-Id': actor.id };
  expect((await context.request.put(base + '/api/settings', { headers, data: { ...defaultSettings, animations: false, sceneSoundEnabled: false } })).status()).toBe(200);
  const course: Course = await (await context.request.get(base + '/api/course')).json();
  await page.goto(base); await expect(page.getByTestId('learn-lesson')).toHaveCount(18);
  await page.locator('[data-testid=learn-lesson][data-lesson-id="marugoto.starter-a1.lesson.04"]').click();
  const skip = page.getByRole('button', { name: /Перейти к занятию/ }); if (await skip.isVisible()) await skip.click();
  await expect(page.getByTestId('learning-word-group')).toBeVisible({ timeout: 15000 });
  report.lazyIllustrations=await checkLazyIllustrations(page);
  if(!Bun.argv.includes('--io-only'))Object.assign(report,await checkAlbumOverview(page,course,output,Bun.argv.includes('--props-only')));
expect(errors).toEqual([]); report.errors=errors; report.green=true;
  await Bun.write(`${output}/focused-green.json`, JSON.stringify(report,null,2)); console.info(JSON.stringify({ green:true, tileCases:(report.tiles as unknown[]|undefined)?.length??0, propCases:(report.props as unknown[]|undefined)?.length??0, errors }));
} catch (error) { report.green=false; report.error=error instanceof Error?error.message:String(error); report.errors=errors; await page.screenshot({path:`${output}/focused-red.png`,fullPage:true}).catch(()=>{}); await Bun.write(`${output}/focused-red.json`,JSON.stringify(report,null,2)); throw error; }
finally { await context.close(); await browser.close(); }
