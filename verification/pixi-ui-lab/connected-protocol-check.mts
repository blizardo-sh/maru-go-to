import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { SQL } from 'bun';
import { chromium } from '@playwright/test';
const root = new URL('./.local/rehearsal-20261028/', import.meta.url);
const runtime = JSON.parse(readFileSync(new URL('runtime.json', root), 'utf8'));
assert.equal(new URL(runtime.database).hostname, '127.0.0.1');
assert.equal(new URL(runtime.database).pathname, '/japanese_pixi_work');
const profiles = JSON.parse(readFileSync(new URL('login.json', root), 'utf8'));
const owner = profiles[1], sql = new SQL(runtime.database);
const [{ payload, result, lesson_id }] = await sql`select payload,result,lesson_id from learning_attempts where user_id=${owner.id} and payload->>'action'='choose' order by created_at desc limit 1`;
assert.ok(payload && result);
const counts = async () => (await sql`select (select count(*) from learning_attempts)::int as learning,(select count(*) from review_attempts)::int as reviews`)[0];
const before = await counts(), browser = await chromium.launch({ channel: 'chrome', headless: true });
const context = await browser.newContext({ reducedMotion: 'reduce' }), page = await context.newPage();
const origin = runtime.origin;
const request = async (body: unknown, headers: Record<string, string> = {}, lesson = lesson_id) => {
  const response = await context.request.post(`${origin}/api/learning/${encodeURIComponent(lesson)}/advance`, { data: body, headers: { Origin: origin, 'X-Learning-Learner-Id': owner.id, ...headers } });
  return { status: response.status(), data: await response.json() };
};
try {
  const signed = await context.request.post(`${origin}/api/auth/sign-in/email`, { data: { email: owner.email, password: owner.password }, headers: { Origin: origin } });
  assert.equal(signed.status(), 200);
  const duplicate = await request(payload);
  assert.equal(duplicate.status, 200); assert.deepEqual(duplicate.data, result);
  const stale = { ...payload, attemptId: crypto.randomUUID(), stateVersion: 0 };
  assert.equal((await request(stale)).data.error.code, 'LEARNING_CONFLICT');
  assert.equal((await request(payload, { 'X-Learning-Learner-Id': profiles[0].id })).data.error.code, 'OWNER_CHANGED');
  assert.equal((await request(payload, { 'X-Content-Publication': '0'.repeat(64) })).data.error.code, 'PUBLICATION_CONFLICT');
  assert.deepEqual(await counts(), before, 'Rejected/duplicate requests changed attempt history');
  await page.goto(`${origin}/legacy.html`);
  const lesson = page.locator(`article[data-lesson-id="${lesson_id}"]`);
  await page.getByRole('navigation', { name: 'Разделы', exact: true }).getByRole('button', { name: 'Учебник', exact: true }).click();
  await lesson.getByText('Урок пройден', { exact: true }).waitFor();
  assert.equal(await page.getByRole('progressbar', { name: 'Прогресс урока 1', exact: true }).getAttribute('aria-valuenow'), '100');
  // An older client may leave exactly this queue after losing an ACK.
  const key = `japanese-pending-learning:${owner.id}`;
  await page.evaluate(({ key, pending }) => localStorage.setItem(key, JSON.stringify(pending)), { key, pending: [{ lessonId: lesson_id, submission: stale }, { lessonId: lesson_id, submission: payload }] });
  await page.route('**/api/learning/*/advance', route => route.abort('failed'));
  await page.goto(`${origin}/learn.html`); await page.waitForFunction(() => window.__PAPER__?.snapshot().lesson.error);
  assert.equal(await page.evaluate(key => JSON.parse(localStorage.getItem(key)!).length, key), 2, 'Ambiguous failure discarded outbox');
  await page.unroute('**/api/learning/*/advance');
  await page.reload(); await page.waitForFunction(() => window.__PAPER__?.snapshot().lesson.authenticated && !window.__PAPER__.snapshot().lesson.busy);
  assert.equal(await page.evaluate(key => JSON.parse(localStorage.getItem(key)!).length, key), 0);
  assert.deepEqual(await counts(), before, 'Outbox replay graded an acknowledged answer twice');
  // Two independently issued views of another lesson: only one version can commit.
  const other = 'marugoto.starter-a1.lesson.02', second = await context.newPage();
  await second.goto(`${origin}/learn.html`); await second.waitForFunction(() => window.__PAPER__);
  const issued = async (p: typeof page) => p.evaluate(async lesson => (await fetch(`/api/learning/${lesson}`)).json(), other);
  const a = await issued(page), b = await issued(second); assert.equal(a.version, b.version);
  const submission = { attemptId: crypto.randomUUID(), publicationId: a.publicationId, routeVersion: a.routeVersion, stateVersion: a.version, stepId: a.step.id, action: 'continue' };
  assert.equal((await request(submission, {}, other)).status, 200);
  assert.equal((await request({ ...submission, attemptId: crypto.randomUUID() }, {}, other)).data.error.code, 'LEARNING_CONFLICT');
  // A cookie change in the other tab cannot load another pupil into this flow.
  await context.request.post(`${origin}/api/auth/sign-out`, { data: {}, headers: { Origin: origin } });
  await context.request.post(`${origin}/api/auth/sign-in/email`, { data: { email: profiles[0].email, password: profiles[0].password }, headers: { Origin: origin } });
  const control = await page.evaluate(() => window.__PAPER__.snapshot().controls.find((c: any) => c.id === 'lesson-4'));
  await page.evaluate((y: number) => scrollTo(0, y - 250), control.rect.y);
  await page.mouse.click(control.rect.x + control.rect.width / 2, control.rect.y + control.rect.height / 2 - await page.evaluate(() => scrollY));
  await page.waitForFunction(() => window.__PAPER__.snapshot().lesson.error);
  assert.match(await page.evaluate(() => window.__PAPER__.snapshot().lesson.error), /другой вкладке/);
  const report = { at: new Date().toISOString(), duplicateAttempt: true, staleVersion: true, ownerMismatch: true, publicationMismatch: true,
    ambiguousFailureRetainsOutbox: true, oldClientOutboxRecovered: true, replayDoesNotRegrade: true, twoTabs: true, otherTabOwnerChange: true, legacyShowsCompletedLesson: true };
  writeFileSync(new URL('protocol-report.json', root), JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });
  console.log(JSON.stringify(report));
} finally { await browser.close(); await sql.close(); }
