import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { createApp } from '../src/server/app';
import { createLink, consumeLink } from '../src/server/auth';
import { connectDatabase } from '../src/server/db';
import { advanceLearningState, currentLearningStep, initialLearningState, type LearningAdvance, type LearningAdvanceResult, type LearningState } from '../src/shared/learning';
import { learningFixture } from './helpers/learning-fixture';
import { nextFixtureIp } from './helpers/fixture-ip';
import { learningWordChoices } from '../src/shared/learningChoices';

const databaseUrl = process.env.JAPANESE_INTEGRATION_DATABASE_URL;
(databaseUrl ? describe : describe.skip)('group introduction and server-graded word choices', () => {
  const origin = 'http://127.0.0.1:5173'; const course = learningFixture(); const route = course.learning[0]!;
  const part = route.goals[0]!.parts[0]!;
  const extraWords = ['せんせい', 'がくせい', 'エンジニア'].map(kana => course.words.find(word => word.kana === kana && word.lessonIds.includes(route.lessonId))!);
  for (const word of extraWords) { word.audioUrl = '/audio/fixture.m4a'; part.words.push({ ...part.words[0]!, wordId: word.id }); }
  const users: { id: string; email: string; cookie: string; ip: string }[] = [];
  let database: ReturnType<typeof connectDatabase>; let app: ReturnType<typeof createApp>;
  const config = { DATABASE_URL: databaseUrl!, BETTER_AUTH_SECRET: 'quiz-fixture-only-more-than-32-characters', APP_URL: origin, PORT: 3000, HOST: '127.0.0.1' };
  const request = (owner: number, body?: LearningAdvance, expectedOwner = users[owner]!.id) => app.request(origin + '/api/learning/' + route.lessonId + (body ? '/advance' : ''), {
    method: body ? 'POST' : 'GET', headers: { origin, cookie: users[owner]!.cookie, 'x-forwarded-for': users[owner]!.ip, 'X-Learning-Learner-Id': expectedOwner, ...(body ? { 'content-type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const state = async (owner = 0): Promise<LearningState> => { const response = await request(owner); expect(response.status).toBe(200); return response.json(); };
  // Unsaved SRS items use "now" as their display due; the question and saved cards must be stable.
  const stableState = (value: LearningState) => value.reviewItem?.isNew ? { ...value, reviewItem: { ...value.reviewItem, due: undefined } } : value;
  const input = (state: LearningState, action: LearningAdvance['action'], choiceWordId?: string): LearningAdvance => ({ attemptId: crypto.randomUUID(), routeVersion: state.routeVersion, stateVersion: state.version, stepId: state.step!.id, action, ...(choiceWordId ? { choiceWordId } : {}) });
  const submit = async (owner: number, data: LearningAdvance): Promise<LearningAdvanceResult> => { const response = await request(owner, data); expect(response.status).toBe(200); return response.json(); };
  const counts = async (owner = 0) => (await database.sql`select (select count(*)::int from learning_attempts where user_id=${users[owner]!.id}) as learning,(select count(*)::int from review_attempts where user_id=${users[owner]!.id}) as reviews,(select count(*)::int from review_states where user_id=${users[owner]!.id}) as cards`)[0];
  beforeAll(async () => {
    const url = new URL(databaseUrl!);
    if (!['localhost', '127.0.0.1'].includes(url.hostname) || url.pathname !== '/japanese_app_test') throw new Error('Disposable local test database required.');
    database = connectDatabase(databaseUrl!); app = createApp({ database, course, config });
    for (let i = 0; i < 4; i++) {
      const email = `quiz-${crypto.randomUUID()}@example.test`; const ip = nextFixtureIp(); const password = 'Quiz-fixture-password-2026!';
      const link = await createLink(database, 'invite', email, null); expect(await consumeLink(database, 'invite', link.token, password, 'Quiz fixture')).toBe(true);
      const response = await app.request(origin + '/api/auth/sign-in/email', { method: 'POST', headers: { origin, 'content-type': 'application/json', 'x-forwarded-for': ip }, body: JSON.stringify({ email, password }) });
      expect(response.status).toBe(200); const body = await response.json(); users.push({ id: body.user.id, email, ip, cookie: response.headers.getSetCookie().map(value => value.split(';')[0]).join('; ') });
    }
  });
  afterAll(async () => { if (!database) return; for (const user of users) { await database.sql`delete from access_links where email=${user.email}`; await database.sql`delete from users where id=${user.id}`; } await database.sql.close(); });

  test('one group ACK completes five intros without SRS; choices and mixed questions survive reload, failures and duplicate submits', async () => {
    const initial = await state(); const start = input(initial, 'start-practice');
    const started = await submit(0, start); let current = started.state;
    expect(current.completedSteps).toBe(5); expect(current.step?.kind).toBe('word-practice'); expect(current.wordChoices).toHaveLength(4);
    expect(await counts()).toEqual({ learning: 1, reviews: 0, cards: 0 });
    expect(await submit(0, start)).toEqual(started);
    app = createApp({ database, course, config }); expect(stableState(await state())).toEqual(stableState(current));
    const before = await counts();
    const nonMember = course.words.find(word => word.lessonIds.includes(route.lessonId) && !current.wordChoices!.includes(word.id))!.id;
    for (const invalid of [input(current, 'choose'), input(current, 'choose', 'foreign-word'), input(current, 'choose', nonMember), input(current, 'remember'), input(current, 'again'), input(current, 'start-practice')]) expect((await request(0, invalid)).status).toBe(400);
    expect(await counts()).toEqual(before); expect(stableState(await state())).toEqual(stableState(current));
    if (current.step?.kind !== 'word-practice') throw new Error('No word question');
    const difficult = current.step.id; const target = current.step.wordId; const wrong = current.wordChoices!.find(id => id !== target)!;
    const attempted = input(current, 'choose', wrong); const first = await submit(0, attempted);
    expect(first.reviewResult).toMatchObject({ correct: false, status: 'scheduled', version: 1 }); expect(first.state.completedSteps).toBe(5);
    expect(await counts()).toEqual({ learning: 2, reviews: 1, cards: 1 });
    expect(await submit(0, attempted)).toEqual(first); expect(await counts()).toEqual({ learning: 2, reviews: 1, cards: 1 });
    expect((await request(0, { ...attempted, attemptId: crypto.randomUUID() })).status).toBe(409);
    expect((await request(0, { ...attempted, choiceWordId: target })).status).toBe(409);
    expect(await database.sql`select item_id from review_states where user_id=${users[0]!.id}`).toEqual([{ item_id: target }]);
    current = first.state;
    while (current.step!.id !== difficult) {
      const step = current.step!; expect(['video', 'part-complete']).not.toContain(step.kind);
      const data = input(current, step.kind === 'word-practice' ? 'choose' : step.kind === 'construction-practice' ? 'remember' : 'continue', step.kind === 'word-practice' ? step.wordId : undefined);
      if (step.kind === 'construction-practice' && step.mode === 'grammar' && current.reviewItem?.mode === 'grammar') data.tokenIds = current.reviewItem.exercise.acceptedOrders[0]!;
      current = (await submit(0, data)).state;
    }
    const correct = await submit(0, input(current, 'choose', target)); expect(correct.reviewResult?.correct).toBe(true); expect(correct.state.step?.kind).toBe('video');
    expect(await state()).toEqual(correct.state);
  });

  test('owner isolation, foreign choices and simultaneous CAS cannot grade another question or learner', async () => {
    const started = await submit(1, input(await state(1), 'start-practice')); const current = started.state;
    expect((await state(2)).version).toBe(0);
    const beforeA = await counts(1); const beforeB = await counts(2);
    if (current.step?.kind !== 'word-practice') throw new Error('Missing word question');
    const data = input(current, 'choose', current.step.wordId);
    expect((await request(2, data, users[1]!.id)).status).toBe(409);
    expect(await counts(1)).toEqual(beforeA); expect(await counts(2)).toEqual(beforeB);
    const responses = await Promise.all([request(1, data), request(1, { ...data, attemptId: crypto.randomUUID() })]);
    expect(responses.map(response => response.status).sort()).toEqual([200, 409]); expect((await counts(1)).reviews).toBe(1);
    expect((await state(2)).version).toBe(0); expect(await counts(2)).toEqual(beforeB);
  });

  test('legacy current/retry state and old outbox ACKs stay valid before and after choosing the new UI', async () => {
    let legacy = initialLearningState(route); legacy = advanceLearningState(route, legacy, 'continue');
    await database.sql`insert into learning_states(user_id,lesson_id,route_version,version,state) values(${users[2]!.id},${route.lessonId},${route.version},4,${legacy})`;
    let current = await state(2); const oldContinue = input(current, 'continue'); const oldAck = await submit(2, oldContinue);
    expect(oldAck.state.completedSteps).toBe(2); expect(oldAck.state.step?.kind).toBe('word-intro');
    current = oldAck.state;
    while (current.step?.kind === 'word-intro') current = (await submit(2, input(current, 'continue'))).state;
    const oldGrade = input(current, 'again'); const gradeAck = await submit(2, oldGrade);
    const row = (await database.sql`select state from learning_states where user_id=${users[2]!.id}`)[0]!.state;
    expect(row.pendingStepIds).toContain(current.step!.id);
    expect(row.wordQuiz).toBeUndefined(); expect(stableState(await state(2))).toEqual(stableState(gradeAck.state));
    const next = gradeAck.state; if (next.step?.kind !== 'word-practice') throw new Error('Missing next legacy word');
    await submit(2, input(next, 'choose', next.step.wordId));
    expect(await submit(2, oldContinue)).toEqual(oldAck); expect(await submit(2, oldGrade)).toEqual(gradeAck);
    const resumed = await state(2); expect(resumed.version).toBeGreaterThan(gradeAck.state.version);
    expect((await request(2, input(resumed, 'remember'))).status).toBe(400);
    expect(currentLearningStep(route, row)?.id).toBe(next.step.id);
  });

  test('an unsent old anchor is rejected without a grade, while a saved ACK predates new choice validation', async () => {
    const current = (await submit(3, input(await state(3), 'start-practice'))).state;
    if (current.step?.kind !== 'word-practice') throw new Error('Missing language question.');
    const step = current.step;
    const oldAnchor = course.words.find(word => word.kana === 'がくせい')!.id;
    expect(current.wordChoices).not.toContain(oldAnchor);
    const before = await counts(3);
    const rejected = await request(3, input(current, 'choose', oldAnchor));
    expect(rejected.status).toBe(400); expect((await rejected.json()).error.code).toBe('INVALID_CHOICE');
    expect(await counts(3)).toEqual(before); expect(stableState(await state(3))).toEqual(stableState(current));
    const wrong = current.wordChoices!.find(id => id !== step.wordId)!;
    const attempt = input(current, 'choose', wrong); const ack = await submit(3, attempt);
    expect(ack.reviewResult?.correct).toBe(false);
    expect(await database.sql`select item_id from review_states where user_id=${users[3]!.id}`).toEqual([{ item_id: step.wordId }]);
    const saved = await counts(3); const removed = course.words.find(word => word.id === wrong)!; const status = removed.reviewStatus;
    try {
      // A deployment may withdraw a distractor; the previously committed result is still authoritative.
      removed.reviewStatus = 'draft';
      expect(() => learningWordChoices(course, route, step)).toThrow();
      expect(await submit(3, attempt)).toEqual(ack);
      expect(await counts(3)).toEqual(saved);
    } finally { removed.reviewStatus = status; }
  });
});
