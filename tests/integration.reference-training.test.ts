import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { createApp } from '../src/server/app';
import { consumeLink, createLink } from '../src/server/auth';
import { connectDatabase } from '../src/server/db';
import { defaultSettings } from '../src/server/material';
import { reviewId } from '../src/server/reviews';
import { initialLearningState } from '../src/shared/learning';
import type { LearnerSettings, ReviewItem, ReviewQueue, ReviewSubmission } from '../src/shared/types';
import { learningFixture } from './helpers/learning-fixture';
import { nextFixtureIp } from './helpers/fixture-ip';

const databaseUrl = process.env.JAPANESE_INTEGRATION_DATABASE_URL;
(databaseUrl ? describe : describe.skip)('per-learner repeat types and learned construction drills', () => {
  const origin = 'http://localhost:5299', course = learningFixture(), route = course.learning[0]!;
  const prepared = route.goals[0]!.parts[0]!.construction!;
  const exercise = course.exercises.find(value => value.id === prepared.exerciseId)!;
  const learners: { id: string; email: string; cookie: string; ip: string }[] = [];
  let database: ReturnType<typeof connectDatabase>, app: ReturnType<typeof createApp>, user: typeof learners[number];
  const request = (path: string, body?: unknown, method = body === undefined ? 'GET' : 'POST', owner = user, expected = owner.id) => app.request(origin + path, {
    method, headers: { origin, cookie: owner.cookie, 'x-forwarded-for': owner.ip, 'X-Learning-Learner-Id': expected, ...(body === undefined ? {} : { 'content-type': 'application/json' }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const settings = async (): Promise<LearnerSettings> => { const response = await request('/api/settings'); expect(response.status).toBe(200); return response.json(); };
  const queue = async (path: string): Promise<ReviewQueue> => { const response = await request(path); expect(response.status).toBe(200); return response.json(); };
  const rows = () => database.sql`select item_id,mode,version,card,due from review_states where user_id=${user.id} order by item_id,mode`;
  const introduce = async (id: string) => { const response = await request('/api/reviews', { attemptId: crypto.randomUUID(), reviewId: reviewId('ja-ru', id), version: 0, mode: 'ja-ru', rating: 3 }); expect(response.status).toBe(200); };
  const answer = (item: Extract<ReviewItem, { mode: 'grammar' }>): ReviewSubmission => ({ attemptId: crypto.randomUUID(), reviewId: item.id, version: item.version, mode: 'grammar', tokenIds: item.exercise.acceptedOrders[0]!, revealed: false, rating: 3 });
  const learnConstruction = async () => {
    const ids = new Set(exercise.tokens.map(token => course.forms.find(form => form.id === token.formId)!.wordId));
    for (const id of ids) if (course.words.find(word => word.id === id)!.reviewStatus !== 'draft') await introduce(id);
    expect((await request('/api/reviews', { attemptId: crypto.randomUUID(), reviewId: reviewId('grammar', exercise.skillId, exercise.id), version: 0, mode: 'grammar', tokenIds: exercise.acceptedOrders[0], revealed: false, rating: 3 })).status).toBe(200);
  };
  beforeAll(() => {
    const url = new URL(databaseUrl!); if (!['localhost', '127.0.0.1'].includes(url.hostname) || url.pathname !== '/japanese_app_test') throw new Error('Disposable local japanese_app_test required.');
    database = connectDatabase(databaseUrl!); app = createApp({ database, course, config: { DATABASE_URL: databaseUrl!, BETTER_AUTH_SECRET: 'reference-training-isolated-secret-over-32-characters', APP_URL: origin, PORT: 3099, HOST: '127.0.0.1' } });
  });
  beforeEach(async () => {
    const email = `reference-drill-${crypto.randomUUID()}@example.test`, ip = nextFixtureIp(), password = 'Reference-fixture-only-password!';
    const link = await createLink(database, 'invite', email, null); expect(await consumeLink(database, 'invite', link.token, password, 'Reference fixture')).toBe(true);
    const response = await app.request(origin + '/api/auth/sign-in/email', { method: 'POST', headers: { origin, 'content-type': 'application/json', 'x-forwarded-for': ip }, body: JSON.stringify({ email, password }) });
    expect(response.status).toBe(200); user = { id: (await response.json()).user.id, email, ip, cookie: response.headers.getSetCookie().map(value => value.split(';')[0]).join('; ') }; learners.push(user);
  });
  afterAll(async () => { if (!database) return; for (const learner of learners) { await database.sql`delete from access_links where email=${learner.email}`; await database.sql`delete from users where id=${learner.id}`; } await database.sql.close(); });

  test('old settings default to all types without a write; selections persist per owner and reject invented SRS types', async () => {
    expect((await settings()).repeatTypes).toEqual(['words', 'counters', 'constructions', 'questions', 'time']);
    expect(await database.sql`select 1 from preferences where user_id=${user.id}`).toHaveLength(0);
    const { repeatTypes: ignored, ...legacy } = structuredClone(defaultSettings);
    await database.sql`insert into preferences(user_id,settings) values(${user.id},${legacy})`;
    expect((await settings()).repeatTypes).toEqual(['words', 'counters', 'constructions', 'questions', 'time']);
    expect((await database.sql`select settings from preferences where user_id=${user.id}`)[0]!.settings).toEqual(legacy);
    const saved = { ...await settings(), repeatTypes: ['constructions'] };
    expect((await request('/api/settings', saved, 'PUT')).status).toBe(200); expect((await settings()).repeatTypes).toEqual(['constructions']);
    for (const repeatTypes of [['kana'], ['words', 'words'], ['unknown'], ['words', 'counters', 'constructions', 'words']]) expect((await request('/api/settings', { ...saved, repeatTypes }, 'PUT')).status).toBe(400);
    expect((await request('/api/settings', saved, 'PUT', user, crypto.randomUUID())).status).toBe(409);
    expect((await settings()).repeatTypes).toEqual(['constructions']);
  });

  test('mixed repeat filters only due, introduced items; empty selection stays empty and never changes progress', async () => {
    await learnConstruction();
    const book = course.words.find(word => word.kana === 'ほん' && !/суффикс/.test(word.meaningRu))!; await introduce(book.id);
    const counter = (await queue('/api/training?counters=true')).items.find((item): item is Extract<ReviewItem, { mode: 'counter' }> => item.mode === 'counter')!;
    expect(counter).toBeDefined();
    expect((await request('/api/reviews', { attemptId: crypto.randomUUID(), reviewId: counter.id, version: counter.version, mode: 'counter', rating: 3, choice: counter.counter.acceptedKeys[0], helped: false })).status).toBe(200);
    await database.sql`update review_states set due=now()-interval '1 day' where user_id=${user.id}`;
    const before = await rows(), progress = await (await request('/api/progress')).json();
    for (const selected of [['words'], ['counters'], ['constructions'], []] as LearnerSettings['repeatTypes'][]) {
      expect((await request('/api/settings', { ...await settings(), repeatTypes: selected }, 'PUT')).status).toBe(200);
      const batch = await queue('/api/reviews?mode=mixed'); expect(batch.remainingNew).toBe(0);
      expect(batch.items.every(item => selected.includes(item.mode === 'grammar' ? 'constructions' : item.mode === 'counter' ? 'counters' : 'words'))).toBe(true);
      const expected = selected.reduce((sum, type) => sum + (type === 'words' ? progress.byMode['ja-ru'].due + progress.byMode['ru-ja'].due + progress.byMode.listening.due : progress.byMode[type === 'counters' ? 'counter' : 'grammar'].due), 0);
      expect(batch.remainingDue).toBe(expected); expect(batch.items).toHaveLength(Math.min(30, expected));
    }
    expect((await queue('/api/reviews?mode=mixed')).items).toEqual([]); expect(await rows()).toEqual(before);
    expect(await (await request('/api/progress')).json()).toEqual({...progress, repeatDue:0});
    expect((await settings()).repeatTypes).toEqual([]);
    await database.sql`update review_states set due=now()+interval '2 days' where user_id=${user.id}`;
    expect((await request('/api/settings', { ...await settings(), repeatTypes: ['words', 'counters', 'constructions'] }, 'PUT')).status).toBe(200);
    // Word modes with no prior row retain their existing introduced-material due semantics.
    const future = await queue('/api/reviews?mode=mixed'); expect(future.items.every(item => item.mode !== 'grammar' && item.mode !== 'counter' && !before.some((row: { item_id: string; mode: string }) => row.item_id === item.targetId && row.mode === item.mode))).toBe(true);
  });

  test('all three learned drill formats share one schedule and idempotent ACK, leaving the lesson current step intact', async () => {
    const path = `/api/training?skillId=${exercise.skillId}`;
    expect((await request(path)).status).toBe(403); await learnConstruction();
    const state = initialLearningState(route);
    await database.sql`insert into learning_states(user_id,lesson_id,route_version,version,state) values(${user.id},${route.lessonId},${route.version},7,${state})`;
    const before = await rows(), lessonBefore = await database.sql`select * from learning_states where user_id=${user.id}`;
    const items: Extract<ReviewItem, { mode: 'grammar' }>[] = [];
    for (const mode of ['ja-ru', 'listening', 'grammar'] as const) {
      const batch = await queue(path + '&constructionMode=' + mode); const item = batch.items.find((item): item is Extract<ReviewItem, { mode: 'grammar' }> => item.mode === 'grammar' && item.exercise.id === exercise.id)!;
      expect(item).toBeDefined(); expect(item.isNew).toBe(false); expect(item.construction).toEqual({ ...prepared, mode }); items.push(item);
    }
    expect(new Set(items.map(item => item.id)).size).toBe(1); expect(new Set(items.map(item => item.version)).size).toBe(1); expect(await rows()).toEqual(before);
    await database.sql`update review_states set due=now()-interval '1 day' where user_id=${user.id} and mode='grammar'`;
    const first = items[0]!, input = answer(first), response = await request('/api/reviews', input); expect(response.status).toBe(200);
    const result = await response.json(); expect(result).toMatchObject({ status: 'scheduled', version: first.version + 1, correct: true });
    expect(await (await request('/api/reviews', input)).json()).toEqual(result);
    expect((await request('/api/reviews', { ...input, rating: 1 })).status).toBe(409);
    const scheduled = await rows();
    for (const item of items.slice(1)) expect(await (await request('/api/reviews', answer(item))).json()).toMatchObject({ status: 'additional-practice', version: result.version });
    expect(await rows()).toEqual(scheduled); expect(await database.sql`select * from learning_states where user_id=${user.id}`).toEqual(lessonBefore);
    expect((await request(path, undefined, 'GET', learners[0]!)).status).toBe(403);
    expect((await request(path, undefined, 'GET', user, learners[0]!.id)).status).toBe(409);
  });

  test('drill context rejects mixed scopes and unavailable listening instead of substituting another example', async () => {
    await learnConstruction();
    for (const query of [`skillId=${exercise.skillId}&lessonId=${route.lessonId}`, 'counters=true&constructionMode=listening', `skillId=${exercise.skillId}&constructionMode=ru-ja`]) expect((await request('/api/training?' + query)).status).toBe(400);
    expect((await request('/api/training?skillId=unknown')).status).toBe(404);
    const withoutRecording = structuredClone(course); withoutRecording.learning![0]!.goals[0]!.parts[0]!.construction!.example.audioUrl = '';
    const unavailable = createApp({ database, course: withoutRecording, config: { DATABASE_URL: databaseUrl!, BETTER_AUTH_SECRET: 'reference-training-isolated-secret-over-32-characters', APP_URL: origin, PORT: 3099, HOST: '127.0.0.1' } });
    const response = await unavailable.request(origin + `/api/training?skillId=${exercise.skillId}&constructionMode=listening`, { headers: { cookie: user.cookie } });
    expect(response.status).toBe(403); expect((await response.json()).error.code).toBe('AUDIO_UNAVAILABLE');
    const contract = await (await request('/api/openapi.json')).json(); expect(contract.paths['/api/training'].get.parameters.some((value: any) => value.name === 'skillId')).toBe(true);
  });
});
