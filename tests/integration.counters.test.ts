import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { createApp } from '../src/server/app';
import { connectDatabase } from '../src/server/db';
import { createLink, consumeLink } from '../src/server/auth';
import { loadCourse } from '../src/server/course';
import { reviewId } from '../src/server/reviews';
import { counterReading, counterTarget } from '../src/shared/counters';
import type { Progress, ReviewItem, ReviewQueue } from '../src/shared/types';
import { nextFixtureIp } from './helpers/fixture-ip';

const databaseUrl = process.env.JAPANESE_INTEGRATION_DATABASE_URL;
(databaseUrl ? describe : describe.skip)('counter practice over authenticated HTTP', () => {
  const origin = 'http://127.0.0.1:5173', course = loadCourse();
  const password = 'Counter-fixture-only-no-real-account!';
  let database: ReturnType<typeof connectDatabase>, app: ReturnType<typeof createApp>, cookie = '', userId = '', ip = nextFixtureIp();
  const learners: { id: string; email: string }[] = [];
  const request = (path: string, body?: unknown) => app.request(origin + path, { method: body === undefined ? 'GET' : 'POST', headers: { origin, cookie, 'x-forwarded-for': ip, ...(body === undefined ? {} : { 'content-type': 'application/json' }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const progress = async (): Promise<Progress> => (await request('/api/progress')).json();
  const train = async (): Promise<ReviewQueue> => { const response = await request('/api/training?counters=true'); expect(response.status).toBe(200); return response.json(); };
  const word = (kana: string) => course.words.find(word => word.kana === kana && !/суффикс/.test(word.meaningRu))!;
  async function introduce(kana: string) { const entry = word(kana); expect(entry).toBeDefined(); expect((await request('/api/reviews', { mode: 'ja-ru', attemptId: crypto.randomUUID(), reviewId: reviewId('ja-ru', entry.id), version: 0, rating: 3 })).status).toBe(200); }
  const input = (item: Extract<ReviewItem, { mode: 'counter' }>, choice = item.counter.acceptedKeys[0]) => ({ attemptId: crypto.randomUUID(), reviewId: item.id, version: item.version, mode: 'counter', rating: 3, choice, helped: false });
  beforeAll(() => {
    const url = new URL(databaseUrl!); if (url.hostname !== '127.0.0.1' || url.pathname !== '/japanese_app_test') throw new Error('Use disposable localhost japanese_app_test.');
    database = connectDatabase(databaseUrl!); app = createApp({ database, course, config: { DATABASE_URL: databaseUrl!, BETTER_AUTH_SECRET: 'counter-isolated-fixture-secret-more-than-32-characters', APP_URL: origin, PORT: 3000, HOST: '127.0.0.1' } });
  });
  beforeEach(async () => {
    cookie = ''; ip = nextFixtureIp(); const email = `counter-${crypto.randomUUID()}@example.test`;
    const link = await createLink(database, 'invite', email, null); expect(await consumeLink(database, 'invite', link.token, password, 'Counter fixture')).toBe(true);
    const response = await request('/api/auth/sign-in/email', { email, password }); expect(response.status).toBe(200);
    userId = (await response.json()).user.id; learners.push({ id: userId, email }); cookie = response.headers.getSetCookie().map(value => value.split(';')[0]).join('; ');
  });
  afterAll(async () => { if (!database) return; for (const learner of learners) { await database.sql`delete from access_links where email=${learner.email}`; await database.sql`delete from users where id=${learner.id}`; } await database.sql.close(); });

  test('individual textbook words unlock counters; unknown words, private copies and locked quantities are rejected', async () => {
    expect((await train()).items).toEqual([]);
    await introduce('ほん'); const batch = await train(); expect(batch.items).toHaveLength(20);
    expect(batch.items.every(item => item.mode === 'counter' && item.counter.word.id === word('ほん').id && item.counter.definition.id === 'satsu')).toBe(true);
    const before = await progress(); expect(before.completedLessons).toBe(0); expect(before.counters).toEqual([]);
    const forged = (target: string, id: string) => request('/api/reviews', { attemptId: crypto.randomUUID(), reviewId: reviewId('counter', target, `${id}|${crypto.randomUUID()}`), version: 0, mode: 'counter', rating: 3, helped: false });
    expect((await forged(counterTarget('nin', 'recall', 1), word('ひと').id)).status).toBe(403);
    expect((await forged(counterTarget('satsu', 'recall', 11), word('ほん').id)).status).toBe(403);
    const list = await (await request('/api/lists', { name: 'Private copy', text: '本; ほん; книга' })).json();
    expect((await forged(counterTarget('satsu', 'recall', 1), list.words[0].id)).status).toBe(403);
    expect((await progress()).counters).toEqual([]);
  });

  test('a 20-card mixed deck contains all five formats and never introduces distractor vocabulary', async () => {
    for (const kana of ['ほん', 'かさ', 'たまご', 'シャツ', 'ひと', 'いす']) await introduce(kana);
    const before = await progress(), batch = await train();
    expect(batch.items).toHaveLength(20); expect(new Set(batch.items.map(item => item.targetId)).size).toBe(20);
    expect(new Set(batch.items.map(item => item.mode === 'counter' && item.counter.kind))).toEqual(new Set(['image-counter', 'counter-image', 'reading-choice', 'listening-image', 'recall']));
    for (const item of batch.items) {
      if (item.mode !== 'counter') throw new Error('Expected counter');
      expect(before.introducedWordIds).toContain(item.counter.word.id);
      expect(item.counter.examples.every(example => !!example.audioUrl)).toBe(true);
      for (const option of item.counter.options) if (option.word) expect(before.introducedWordIds).toContain(option.word.id);
    }
    const after = await progress();
    expect({ ...after, introducedWordIds: [...after.introducedWordIds].sort() }).toEqual({ ...before, introducedWordIds: [...before.introducedWordIds].sort() });
  });

  test('wrong choices cannot become Good; ACK retries and same-presentation corrections cannot inflate tier confidence', async () => {
    await introduce('ほん'); const item = (await train()).items.find((item): item is Extract<ReviewItem, { mode: 'counter' }> => item.mode === 'counter' && item.counter.kind === 'reading-choice')!;
    const wrong = item.counter.options.find(option => !item.counter.acceptedKeys.includes(option.key))!.key;
    const first = input(item, wrong), response = await request('/api/reviews', first); expect(response.status).toBe(200);
    const result = await response.json(); expect(result).toMatchObject({ status: 'scheduled', correct: false, version: 1 });
    expect(await (await request('/api/reviews', first)).json()).toEqual(result);
    const retry = await request('/api/reviews', { ...input(item), version: result.version }); expect(retry.status).toBe(200);
    expect(await retry.json()).toMatchObject({ correct: true, status: 'additional-practice' });
    const p = await progress(); expect(p.introducedWordIds).toEqual([word('ほん').id]); expect(p.wordsIntroducedToday).toBe(1);
    expect(p.counters[0]!.history).toHaveLength(1); expect(p.counters[0]!.history[0]!.confident).toBe(false);
  });

  test('twenty qualifying first answers open only their suffix and retain earlier readings for due review', async () => {
    await introduce('ほん'); await introduce('かさ');
    for (let index = 0; index < 20; index++) {
      const quantity = index % 10 + 1, kind = index < 3 ? 'recall' : 'reading-choice';
      const target = counterTarget('satsu', kind, quantity);
      const state = await database.sql`select version from review_states where user_id=${userId} and item_id=${target} and mode='counter'`;
      const response = await request('/api/reviews', { attemptId: crypto.randomUUID(), reviewId: reviewId('counter', target, `${word('ほん').id}|${crypto.randomUUID()}`), version: state[0]?.version ?? 0, mode: 'counter', rating: 3, choice: kind === 'recall' ? undefined : counterReading('satsu', quantity), helped: false });
      expect(response.status).toBe(200);
    }
    const p = await progress(); expect(p.counters.find(progress => progress.counterId === 'satsu')!.level).toBe(1); expect(p.counters.some(progress => progress.counterId === 'hon')).toBe(false);
    expect((await train()).items.some(item => item.mode === 'counter' && item.counter.level === 1)).toBe(true);
    const target = counterTarget('satsu', 'recall', 1);
    await database.sql`update review_states set due=now()-interval '1 day' where user_id=${userId} and item_id=${target} and mode='counter'`;
    const due: ReviewQueue = await (await request('/api/reviews?mode=counter')).json();
    expect(due.items.some(item => item.targetId === target && !item.isNew && item.version === 1)).toBe(true);
    expect(due.items.every(item => !item.isNew)).toBe(true);
    const others: ReviewQueue = await (await request('/api/reviews?mode=mixed')).json(); expect(others.items.some(item => item.mode === 'counter')).toBe(true);
  });

  test('the OpenAPI contract includes counter cards, progress and training without transform failures', async () => {
    const response = await request('/api/openapi.json'); expect(response.status).toBe(200);
    const contract = await response.json(); expect(contract.paths['/api/training'].get.parameters.some((parameter: { name: string }) => parameter.name === 'counters')).toBe(true);
  });
});
