import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { createApp } from '../src/server/app';
import { createLink, consumeLink } from '../src/server/auth';
import { loadCourse } from '../src/server/course';
import { connectDatabase } from '../src/server/db';
import { defaultSettings } from '../src/server/material';
import { reviewId } from '../src/server/reviews';
import { nextFixtureIp } from './helpers/fixture-ip';

const databaseUrl = process.env.JAPANESE_INTEGRATION_DATABASE_URL;
const suite = databaseUrl ? describe : describe.skip;
suite('authored equivalent sentence variants over HTTP', () => {
  const origin = 'http://127.0.0.1:5173';
  const email = `topic-omission-${crypto.randomUUID()}@example.test`;
  const password = 'Topic-omission-fixture-only-password!';
  const fixtureIp = nextFixtureIp();
  const course = loadCourse();
  let database: ReturnType<typeof connectDatabase>;
  let app: ReturnType<typeof createApp>;
  let cookie = '';
  let userId = '';
  const request = (path: string, body?: unknown, method = body === undefined ? 'GET' : 'POST') => app.request(origin + path, {
    method, headers: { origin, 'x-forwarded-for': fixtureIp, ...(cookie ? { cookie } : {}), ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  beforeAll(async () => {
    const target = new URL(databaseUrl!);
    if (target.hostname !== '127.0.0.1' || target.pathname !== '/japanese_app_test') throw new Error('Use only disposable localhost japanese_app_test.');
    database = connectDatabase(databaseUrl!);
    app = createApp({ database, course, config: { DATABASE_URL: databaseUrl!, BETTER_AUTH_SECRET: 'topic-omission-fixture-secret-with-more-than-32-characters', APP_URL: origin, PORT: 3000, HOST: '127.0.0.1' } });
    const link = await createLink(database, 'invite', email, null);
    expect(await consumeLink(database, 'invite', link.token, password, 'Topic omission fixture')).toBe(true);
    const signedIn = await request('/api/auth/sign-in/email', { email, password });
    expect(signedIn.status).toBe(200);
    userId = (await signedIn.json()).user.id;
    cookie = signedIn.headers.getSetCookie().map(value => value.split(';')[0]).join('; ');
    expect((await request('/api/settings', { ...structuredClone(defaultSettings), lessonStatuses: Object.fromEntries(course.lessons.map(lesson => [lesson.id, 'studying'])), newWordsPerDay: 5, newSkillsPerDay: 2 }, 'PUT')).status).toBe(200);
  });
  afterAll(async () => {
    if (!database) return;
    await database.sql`delete from access_links where email=${email}`;
    if (userId) await database.sql`delete from users where id=${userId}`;
    await database.sql.close();
  });
  test('a self-introduction may omit the known わたしは topic and commit the same skill as Good', async () => {
    const exercise = course.exercises.find(item => item.id.endsWith('ga_ability.l03.1'))!;
    const tokenIds = ['t3', 't4', 't5'];
    const input = { reviewId: reviewId('grammar', exercise.skillId, exercise.id), version: 0, tokenIds, revision: 1 };
    const evaluated = await request('/api/reviews/evaluate', input);
    const evaluation = await evaluated.json();
    const analyzed = await request('/api/analyze', { text: 'にほんごができます。', revision: 1, wordIds: exercise.tokens.filter(token => tokenIds.includes(token.id)).map(token => token.formId) });
    const analysis = await analyzed.json();
    const submission = { reviewId: input.reviewId, version: input.version, tokenIds, mode: 'grammar', attemptId: crypto.randomUUID(), revealed: false, exploring: true };
    const committed = await request('/api/reviews', submission);
    const commit = await committed.json();
    expect(evaluated.status).toBe(200);
    expect(evaluation.outcome).toBe('correct');
    expect(analysis).toMatchObject({ status: 'ok', grammar: 'correct', translationRu: 'Я могу говорить по-японски.' });
    expect(committed.status).toBe(200);
    expect(commit).toMatchObject({ correct: true, status: 'scheduled', version: 1 });
    expect(await (await request('/api/reviews', submission)).json()).toEqual(commit);
    const [state] = await database.sql`select card from review_states where user_id=${userId} and item_id=${exercise.skillId} and mode='grammar'`;
    expect(state.card.last_review).toBeDefined();
    expect(state.card.due).toBe(commit.nextDue);
    const [{ count }] = await database.sql`select count(*)::int as count from review_attempts where user_id=${userId} and item_id=${exercise.skillId}`;
    expect(count).toBe(1);
  });
});
