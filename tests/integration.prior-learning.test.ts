import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { disposableDatabase } from './helpers/disposable-database';
import { nextFixtureIp } from './helpers/fixture-ip';
import { createApp } from '../src/server/app';
import { createLink, consumeLink } from '../src/server/auth';
import { connectDatabase } from '../src/server/db';
import { loadCourse } from '../src/server/course';
import { nextCard } from '../src/server/reviews';
import { markPriorLearning } from '../src/server/prior-learning';
import { mainLessonMaterial } from '../src/shared/priorLearning';
import { initialLearningState, learningParts, type LearningState } from '../src/shared/learning';
import type { ReviewItem } from '../src/shared/types';
import { defaultSettings } from '../src/server/material';

const url = process.env.JAPANESE_INTEGRATION_DATABASE_URL;
(url ? describe : describe.skip)('recognize prior learning without fabricated answers', () => {
  const course = loadCourse(), origin = 'http://localhost:5297';
  const route = course.learning!.find(route => route.lessonId.endsWith('.03'))!;
  const targets = mainLessonMaterial(course, route.lessonId), word = targets.find(target => target.kind === 'word')!, grammar = targets.find(target => target.kind === 'grammar')!;
  const users: { id: string; email: string; cookie: string; ip: string }[] = [];
  let db: ReturnType<typeof connectDatabase>, app: ReturnType<typeof createApp>, user: typeof users[number];
  const request = (path: string, body?: unknown, method = body === undefined ? 'GET' : 'POST', owner = user) => app.request(origin + path, { method, headers: { origin, cookie: owner.cookie, 'x-forwarded-for': owner.ip, 'X-Learning-Learner-Id': owner.id, ...(body === undefined ? {} : { 'content-type': 'application/json' }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const mark = (target = word, action = 'mark', requestId = crypto.randomUUID()) => request('/api/prior-learning', { ...target, action, requestId });
  const rows = () => db.sql`select item_id,mode,version,card,due from review_states where user_id=${user.id} order by item_id,mode`;
  const state = async (): Promise<LearningState> => (await request('/api/learning/' + route.lessonId)).json();
  const submit = (item: ReviewItem) => request('/api/reviews', { attemptId: crypto.randomUUID(), reviewId: item.id, version: item.version, mode: item.mode, rating: 3 });
  beforeAll(() => {
    if (!disposableDatabase(new URL(url!))) throw new Error('Disposable local test DB required');
    db = connectDatabase(url!); app = createApp({ database: db, course, config: { DATABASE_URL: url!, BETTER_AUTH_SECRET: 'prior-learning-fixture-secret-long-enough', APP_URL: origin, HOST: '127.0.0.1', PORT: 3097 } });
  });
  beforeEach(async () => {
    const email = `prior-${crypto.randomUUID()}@example.test`, ip = nextFixtureIp(), password = 'Prior-learning-fixture!';
    const invitation = await createLink(db, 'invite', email, null);
    expect(await consumeLink(db, 'invite', invitation.token, password, 'Prior learning')).toBe(true);
    const response = await app.request(origin + '/api/auth/sign-in/email', { method: 'POST', headers: { origin, 'content-type': 'application/json', 'x-forwarded-for': ip }, body: JSON.stringify({ email, password }) });
    expect(response.status).toBe(200);
    user = { id: (await response.json()).user.id, email, ip, cookie: response.headers.getSetCookie().map(value => value.split(';')[0]).join('; ') }; users.push(user);
  });
  afterAll(async () => { if (db) { for (const owner of users) { await db.sql`delete from access_links where email=${owner.email}`; await db.sql`delete from users where id=${owner.id}`; } await db.sql.close(); } });

  test('marks a word due now without an answer and undoes without losing earlier study', async () => {
    await db.sql`insert into study_progress(user_id,kind,item_id,introductions,passed) values(${user.id},'word',${word.itemId},${['default']},${['ja-ru']})`;
    const before = await state(), response = await mark(); expect(response.status).toBe(200); expect(await response.json()).toEqual({ addedCards: 3, removedCards: 0 });
    const cards = await rows(); expect(cards).toHaveLength(3);
    for (const card of cards) { expect(card.version).toBe(0); expect(card.card.reps).toBe(0); expect(card.card.last_review).toBeUndefined(); expect(new Date(card.due).getTime()).toBeLessThanOrEqual(Date.now()); }
    expect(await db.sql`select 1 from review_attempts where user_id=${user.id}`).toHaveLength(0);
    const queue = await (await request('/api/reviews?mode=mixed')).json(); expect(queue.items).toHaveLength(3);
    expect((await state()).step?.id).not.toBe(before.step?.id);
    expect((await (await request('/api/progress')).json()).priorLearning).toEqual([{ ...word, canUndo: true }]);
    expect((await mark(word, 'unmark')).status).toBe(200); expect(await rows()).toHaveLength(0); expect((await state()).step?.id).toBe(before.step?.id);
    const [study] = await db.sql`select introductions,passed from study_progress where user_id=${user.id} and item_id=${word.itemId}`; expect(study).toEqual({ introductions: ['default'], passed: ['ja-ru'] });
  });
  test('marks only core lesson material, completes its route, and preserves old schedules', async () => {
    const card = nextCard(null, 3, new Date('2025-01-01'));
    await db.sql`insert into review_states(user_id,item_id,mode,version,card,due) values(${user.id},${word.itemId},'ja-ru',7,${card},${card.due})`;
    const [original] = await rows();
    const response = await request('/api/prior-learning', { requestId: crypto.randomUUID(), kind: 'lesson', itemId: route.lessonId, action: 'mark' }); expect(response.status).toBe(200);
    const cards = await rows(); expect(cards.find((row:any) => row.item_id === word.itemId)).toEqual(original);
    expect(new Set(cards.map((row:any) => row.item_id))).toEqual(new Set(targets.map(target => target.itemId)));
    expect(cards.some((row:any) => row.mode === 'counter')).toBe(false);
    expect((await state()).completed).toBe(true); expect((await state()).step).toBeNull();
    expect(await db.sql`select 1 from learning_attempts where user_id=${user.id}`).toHaveLength(0);
    const progress = await (await request('/api/progress')).json(); expect(progress.completedLessons).toBeGreaterThanOrEqual(1);
    expect((await mark(word)).status).toBe(200); expect(await rows()).toEqual(cards);
  });
  test('grammar uses one skill and filters stay selected', async () => {
    expect((await mark(grammar)).status).toBe(200); expect(await rows()).toHaveLength(1);
    await request('/api/settings', { ...defaultSettings, repeatTypes: ['words'] }, 'PUT');
    expect((await (await request('/api/reviews?mode=mixed')).json()).items).toHaveLength(0);
    expect((await (await request('/api/progress')).json()).introducedSkillIds).toContain(grammar.itemId);
    expect((await mark(grammar, 'unmark')).status).toBe(200); expect(await rows()).toHaveLength(0);
  });
  test('unvoiced words use two directions and unavailable bulk material rolls back atomically', async () => {
    const unvoiced = structuredClone(course); delete unvoiced.words.find(value => value.id === word.itemId)!.audioUrl;
    await markPriorLearning(db,user.id,unvoiced,{...word,action:'mark',requestId:crypto.randomUUID()});
    expect((await rows()).map((row:any)=>row.mode)).toEqual(['ja-ru','ru-ja']);
    expect((await mark(word,'unmark')).status).toBe(200);
    const draft = structuredClone(course), lastWord = targets.filter(target=>target.kind==='word').at(-1)!;
    draft.words.find(value=>value.id===lastWord.itemId)!.reviewStatus='draft';
    await expect(markPriorLearning(db,user.id,draft,{kind:'lesson',itemId:route.lessonId,action:'mark',requestId:crypto.randomUUID()})).rejects.toMatchObject({status:403});
    expect(await rows()).toHaveLength(0); expect(await db.sql`select 1 from prior_learning where user_id=${user.id}`).toHaveLength(0);
  });
  test('real repetition locks undo and an old operation retry cannot re-enroll an undone mark', async () => {
    const requestId = crypto.randomUUID(); expect((await mark(word, 'mark', requestId)).status).toBe(200);
    expect((await mark(word, 'unmark')).status).toBe(200);
    expect((await mark(word, 'mark', requestId)).status).toBe(200); expect(await rows()).toHaveLength(0);
    expect((await mark()).status).toBe(200);
    const item = (await (await request('/api/reviews?mode=ja-ru')).json()).items[0]; expect((await submit(item)).status).toBe(200);
    const saved = await rows(); expect((await mark(word, 'unmark')).status).toBe(409); expect(await rows()).toEqual(saved);
    expect((await (await request('/api/progress')).json()).priorLearning).toEqual([{ ...word, canUndo: false }]);
  });
  test('undo reopens skipped steps after real work on a different word', async () => {
    expect((await mark()).status).toBe(200);
    const first = await state(); expect(first.step?.kind).toBe('word-intro');
    const response = await request('/api/learning/' + route.lessonId + '/advance', { attemptId: crypto.randomUUID(), routeVersion: first.routeVersion, stateVersion: first.version, stepId: first.step!.id, action: 'continue' }); expect(response.status).toBe(200);
    expect((await mark(word, 'unmark')).status).toBe(200);
    expect((await state()).step?.id).toBe(learningParts(route)[0]![0]!.id);
    const [saved] = await db.sql`select state from learning_states where user_id=${user.id} and lesson_id=${route.lessonId}`; expect(saved.state.completedStepIds).toContain(first.step!.id);
  });
  test('a question issued before a mark can save its genuine answer', async () => {
    const raw = initialLearningState(route), parts = learningParts(route), step = parts[0]!.find(step => step.kind === 'word-practice' && step.wordId === word.itemId)!;
    raw.pendingStepIds = [step.id, ...raw.pendingStepIds.filter(id => id !== step.id && !parts[0]!.some(value => value.id === id && value.kind === 'word-intro'))]; raw.completedStepIds = parts[0]!.filter(step => step.kind === 'word-intro').map(step => step.id); raw.recallPolicy = 'recall-v1';
    await db.sql`insert into learning_states(user_id,lesson_id,route_version,version,state) values(${user.id},${route.lessonId},${route.version},0,${raw})`;
    const issued = await state(); expect((await mark()).status).toBe(200);
    const response = await request('/api/learning/' + route.lessonId + '/advance', { attemptId: crypto.randomUUID(), routeVersion: issued.routeVersion, stateVersion: issued.version, stepId: issued.step!.id, action: 'remember', recall: { helped: false } }); expect(response.status).toBe(200);
    expect(await db.sql`select 1 from review_attempts where user_id=${user.id}`).toHaveLength(1); expect((await mark(word, 'unmark')).status).toBe(409);
  });
  test('isolates learners and rejects non-textbook material and mismatched request reuse', async () => {
    const previous = users[0]!; expect((await (await request('/api/progress')).json()).priorLearning).toEqual([]);
    const requestId = crypto.randomUUID(); expect((await mark(word, 'mark', requestId)).status).toBe(200);
    expect((await mark(grammar, 'mark', requestId)).status).toBe(409);
    expect((await request('/api/prior-learning', { ...word, action: 'mark', requestId }, 'POST', previous)).status).toBe(409);
    expect((await app.request(origin+'/api/prior-learning',{method:'POST',headers:{origin,cookie:user.cookie,'content-type':'application/json','X-Learning-Learner-Id':previous.id},body:JSON.stringify({...word,action:'mark',requestId:crypto.randomUUID()})})).status).toBe(409);
    expect((await request('/api/prior-learning', { ...word, action: 'unmark', requestId: crypto.randomUUID() }, 'POST', previous)).status).not.toBe(500);
    expect(await rows()).toHaveLength(3);
    expect((await mark({ kind: 'word', itemId: 'personal:unavailable' })).status).toBe(403);
    expect((await request('/api/prior-learning', { ...word, requestId: crypto.randomUUID(), action: 'mark', userId: previous.id })).status).toBe(400);
  });
  test('concurrent answer and undo never erase a committed review', async () => {
    expect((await mark()).status).toBe(200);
    const item = (await (await request('/api/reviews?mode=ja-ru')).json()).items[0];
    const [answer, undo] = await Promise.all([submit(item), mark(word, 'unmark')]);
    if (answer.status === 200) { expect(undo.status).toBe(409); expect(await rows()).toHaveLength(3); }
    else { expect(undo.status).toBe(200); expect(answer.status).toBe(409); expect(await rows()).toHaveLength(0); }
  });
});
