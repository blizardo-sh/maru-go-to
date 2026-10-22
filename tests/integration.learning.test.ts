import { afterAll, beforeAll, expect, describe, test } from 'bun:test';
import { createApp } from '../src/server/app';
import { connectDatabase } from '../src/server/db';
import { createLink, consumeLink } from '../src/server/auth';
import { learningFixture } from './helpers/learning-fixture';
import { nextFixtureIp } from './helpers/fixture-ip';
import type { LearningAdvance, LearningAdvanceResult, LearningState } from '../src/shared/learning';
import { advanceLearningState, currentLearningStep, initialLearningState, learningParts } from '../src/shared/learning';
import { reviewId, submitReview } from '../src/server/reviews';

const databaseUrl = process.env.JAPANESE_INTEGRATION_DATABASE_URL;
const suite = databaseUrl ? describe : describe.skip;
const origin = 'http://127.0.0.1:5173';
suite('guided learning HTTP with disposable PostgreSQL', () => {
  let database: ReturnType<typeof connectDatabase>;
  const course = learningFixture(); const lessonId = course.learning[0]!.lessonId;
  let app: ReturnType<typeof createApp>;
  const users: { id: string; cookie: string; email: string; ip: string }[] = [];
  const password = 'Guided-fixture-only-password-2026!';
  const request = (path: string, owner = 0, body?: unknown, expectedLearner = users[owner]!.id) => app.request(origin + path, {
    method: body === undefined ? 'GET' : 'POST', headers: { origin, cookie: users[owner]!.cookie, 'x-forwarded-for': users[owner]!.ip, 'X-Learning-Learner-Id': expectedLearner, ...(body === undefined ? {} : { 'content-type': 'application/json' }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const state = async (owner = 0): Promise<LearningState> => {
    const response = await request('/api/learning/' + lessonId, owner); expect(response.status).toBe(200); return response.json();
  };
  const payload = (current: LearningState, action: LearningAdvance['action'] = 'continue', extra: Partial<LearningAdvance> = {}): LearningAdvance => ({ attemptId: crypto.randomUUID(), routeVersion: current.routeVersion, stateVersion: current.version, stepId: current.step!.id, action, ...extra });
  const advance = async (current: LearningState, action: LearningAdvance['action'], extra: Partial<LearningAdvance> = {}, owner = 0): Promise<LearningAdvanceResult> => {
    const response = await request('/api/learning/' + lessonId + '/advance', owner, payload(current, action, extra));
    expect(response.status).toBe(200); return response.json();
  };
  beforeAll(async () => {
    const url = new URL(databaseUrl!);
    if (!['localhost', '127.0.0.1'].includes(url.hostname) || url.pathname !== '/japanese_app_test') throw new Error('Disposable localhost /japanese_app_test required.');
    database = connectDatabase(databaseUrl!);
    app = createApp({ database, course, config: { DATABASE_URL: databaseUrl!, BETTER_AUTH_SECRET: 'guided-fixture-only-auth-secret-more-than-32-characters', APP_URL: origin, PORT: 3000, HOST: '127.0.0.1' } });
    for (let owner = 0; owner < 3; owner++) {
      const email = `guided-${crypto.randomUUID()}@example.test`; const ip = nextFixtureIp();
      const link = await createLink(database, 'invite', email, null); expect(await consumeLink(database, 'invite', link.token, password, 'Guided fixture')).toBe(true);
      const response = await app.request(origin + '/api/auth/sign-in/email', { method: 'POST', headers: { origin, 'content-type': 'application/json', 'x-forwarded-for': ip }, body: JSON.stringify({ email, password }) });
      expect(response.status).toBe(200); const body = await response.json();
      users.push({ id: body.user.id, email, ip, cookie: response.headers.getSetCookie().map(value => value.split(';')[0]).join('; ') });
    }
  });
  afterAll(async () => {
    if (!database) return;
    for (const user of users) { await database.sql`delete from access_links where email=${user.email}`; await database.sql`delete from users where id=${user.id}`; }
    await database.sql.close();
  });

  test('a stale learner tab with another cookie owner cannot read or advance a fresh matching step', async () => {
    const learnerA = users[0]!; const learnerB = users[1]!;
    const initial = await state(); const other = await state(1);
    expect(initial.step?.id).toBe(other.step?.id); expect(initial.version).toBe(other.version);
    const rows = async () => database.sql`select id,(select count(*)::int from learning_states where user_id=users.id) as learning,(select count(*)::int from learning_attempts where user_id=users.id) as learning_attempts,(select count(*)::int from review_states where user_id=users.id) as reviews,(select count(*)::int from review_attempts where user_id=users.id) as review_attempts from users where id in (${learnerA.id},${learnerB.id}) order by id`;
    const before = await rows();
    for (const path of ['/api/learning', '/api/learning/' + lessonId, '/api/progress']) {
      const response = await request(path, 1, undefined, learnerA.id);
      expect(response.status).toBe(409); expect((await response.json()).error.code).toBe('OWNER_CHANGED');
    }
    const response = await request('/api/learning/' + lessonId + '/advance', 1, payload(initial), learnerA.id);
    expect(response.status).toBe(409); expect((await response.json()).error.code).toBe('OWNER_CHANGED');
    expect(await rows()).toEqual(before); expect(await state()).toEqual(initial); expect(await state(1)).toEqual(other);
    // Older clients without the new header keep their authenticated, cookie-scoped behavior.
    expect((await app.request(origin + '/api/learning/' + lessonId, { headers: { cookie: learnerB.cookie } })).status).toBe(200);
  });

  test('old SRS does not credit a new route; read-only resume, owner boundaries, stale and idempotent ACKs', async () => {
    const coreWordId = course.learning[0]!.goals[0]!.parts[0]!.words[0]!.wordId;
    const prior = { attemptId: crypto.randomUUID(), reviewId: reviewId('ja-ru', coreWordId), version: 0, mode: 'ja-ru' as const, rating: 3 as const };
    await submitReview(database, users[0]!.id, course, prior);
    const before = await database.sql`select item_id,mode,version,card,due from review_states where user_id=${users[0]!.id} order by item_id,mode`;
    const initial = await state();
    expect(initial).toMatchObject({ version: 0, completedSteps: 0, completed: false, partIndex: 0, step: { kind: 'word-intro', wordId: coreWordId } });
    expect((await database.sql`select 1 from learning_states where user_id=${users[0]!.id}`)).toHaveLength(0);
    expect((await state(1)).version).toBe(0);
    const input = payload(initial);
    const first = await request('/api/learning/' + lessonId + '/advance', 0, input); expect(first.status).toBe(200); const saved: LearningAdvanceResult = await first.json();
    expect(await (await request('/api/learning/' + lessonId + '/advance', 0, input)).json()).toEqual(saved);
    expect((await request('/api/learning/' + lessonId + '/advance', 1, input)).status).toBe(409);
    expect((await request('/api/learning/' + lessonId + '/advance', 0, { ...input, action: 'skip' })).status).toBe(409);
    expect((await request('/api/learning/' + lessonId + '/advance', 0, payload(initial))).status).toBe(409);
    expect((await request('/api/learning/' + course.lessons[0]!.id + '/advance', 0, input)).status).toBe(404);
    expect(await state()).toEqual(saved.state);
    expect(await database.sql`select item_id,mode,version,card,due from review_states where user_id=${users[0]!.id} order by item_id,mode`).toEqual(before);
    const overview = await (await request('/api/learning')).json();
    expect(overview.lessons[0].version).toBe(1);
  });

  test('first graded Again enrolls SRS immediately, retries a format until Remember, and resumes each exact step', async () => {
    let current = await state(1);
    current = (await advance(current, 'continue', {}, 1)).state;
    current = (await advance(current, 'continue', {}, 1)).state;
    expect(String(current.step?.kind)).toBe('word-practice');
    const initialStep = current.step;
    if (initialStep?.kind !== 'word-practice') throw new Error('Missing practice');
    const target = initialStep.wordId; const difficultId = initialStep.id;
    const first = await advance(current, 'again', {}, 1);
    expect(first.reviewResult).toMatchObject({ status: 'scheduled', version: 1 });
    expect((await database.sql`select 1 from review_states where user_id=${users[1]!.id} and item_id=${target}`)).toHaveLength(1);
    expect(first.state.completedSteps).toBe(2);
    current = first.state;
    for (let round = 0; round < 4; round++) {
      while (current.step!.id !== difficultId) {
        expect(['video', 'part-complete']).not.toContain(current.step!.kind);
        const assembly = current.step?.kind === 'construction-practice' && current.step.mode === 'grammar';
        const extra = assembly ? { tokenIds: current.reviewItem?.mode === 'grammar' ? current.reviewItem.exercise.acceptedOrders[0]! : [] } : {};
        current = (await advance(current, current.step?.kind.endsWith('practice') ? 'remember' : 'continue', extra, 1)).state;
      }
      const result = await advance(current, round === 3 ? 'remember' : 'again', {}, 1);
      expect(result.reviewResult).toBeDefined(); current = result.state;
      expect(await state(1)).toEqual(current);
    }
    expect(current.step?.kind).toBe('video');
    current = (await advance(current, 'skip', {}, 1)).state;
    current = (await advance(current, 'continue', {}, 1)).state;
    expect(current.partIndex).toBe(1);
    while (!current.completed) current = (await advance(current, current.step?.kind === 'word-practice' ? 'remember' : 'continue', {}, 1)).state;
    expect(current.step).toBeNull(); expect(current.completedSteps).toBe(current.totalSteps);
    expect((await state()).completed).toBe(false);
  });

  test('server grades assembly, rejects incomplete/exploratory changes without progress writes and keeps incorrect complete answers in the part', async () => {
    let current = await state();
    while (!(current.step?.kind === 'construction-practice' && current.step.mode === 'grammar')) {
      current = (await advance(current, current.step?.kind.endsWith('practice') ? 'remember' : 'continue')).state;
    }
    if (current.reviewItem?.mode !== 'grammar') throw new Error('Missing assembly review');
    const correct = current.reviewItem.exercise.acceptedOrders[0]!;
    const counts = async () => (await database.sql`select (select count(*)::int from review_attempts where user_id=${users[0]!.id}) as reviews,(select count(*)::int from learning_attempts where user_id=${users[0]!.id}) as learning`)[0];
    const before = await counts();
    const incomplete = await request('/api/learning/' + lessonId + '/advance', 0, payload(current, 'again', { tokenIds: correct.slice(0, -1) }));
    expect(incomplete.status).toBe(409); expect((await incomplete.json()).error.code).toBe('INCOMPLETE_NOT_SCHEDULED');
    const exploratory = await request('/api/learning/' + lessonId + '/advance', 0, payload(current, 'remember', { tokenIds: correct, exploring: true }));
    expect(exploratory.status).toBe(409);
    expect(await counts()).toEqual(before); expect(await state()).toEqual(current);
    const wrong = await advance(current, 'remember', { tokenIds: [...correct].reverse() });
    expect(wrong.reviewResult?.correct).toBe(false); expect(wrong.state.step?.id).toBe(current.step.id);
    current = wrong.state;
    const revealed = await advance(current, 'remember', { tokenIds: correct, revealed: true });
    expect(revealed.reviewResult?.correct).toBe(true); expect(revealed.state.step?.id).toBe(current.step!.id);
    current = (await advance(revealed.state, 'remember', { tokenIds: correct, revealed: false })).state;
    expect(current.step?.kind).toBe('video');
  });

  test('introducing a curated construction does not expose draft sibling examples or remove old skill history', async () => {
    const exerciseId = course.learning[0]!.goals[0]!.parts[0]!.construction!.exerciseId;
    const exercise = course.exercises.find(item => item.id === exerciseId)!;
    const sibling = course.exercises.find(item => item.skillId === exercise.skillId && item.reviewStatus === 'draft')!;
    expect(sibling).toBeDefined();
    await database.sql`update review_states set due=now()-interval '1 minute' where user_id=${users[0]!.id} and item_id=${exercise.skillId} and mode='grammar'`;
    const before = await database.sql`select * from review_states where user_id=${users[0]!.id} and item_id=${exercise.skillId}`;
    const response = await request('/api/reviews?mode=grammar'); expect(response.status).toBe(200);
    const queue = await response.json();
    const items = queue.items.filter((item: { targetId: string }) => item.targetId === exercise.skillId);
    expect(items).toHaveLength(1); expect(items[0].exercise.id).toBe(exerciseId);
    const unreviewed = await request('/api/reviews', 0, { attemptId: crypto.randomUUID(), reviewId: reviewId('grammar', sibling.skillId, sibling.id), version: before[0]!.version, mode: 'grammar', tokenIds: sibling.acceptedOrders[0], revealed: false });
    expect(unreviewed.status).toBe(403);
    expect((await unreviewed.json()).error.code).toBe('MATERIAL_UNAVAILABLE');
    expect(await database.sql`select * from review_states where user_id=${users[0]!.id} and item_id=${exercise.skillId}`).toEqual(before);
  });

  test('simultaneous clients cannot double-grade a step, and forged fields/version are rejected', async () => {
    let current = await state();
    const bad = await request('/api/learning/' + lessonId + '/advance', 0, { ...payload(current), unexpected: 'field' }); expect(bad.status).toBe(400);
    expect((await request('/api/learning/' + lessonId + '/advance', 0, payload(current, 'continue', { routeVersion: 'wrong-route' }))).status).toBe(409);
    const responses = await Promise.all([request('/api/learning/' + lessonId + '/advance', 0, payload(current, 'skip')), request('/api/learning/' + lessonId + '/advance', 0, payload(current, 'skip'))]);
    expect(responses.map(response => response.status).sort()).toEqual([200, 409]);
    current = await state(); expect(current.step?.kind).toBe('part-complete');
    const openapi = await (await request('/api/openapi.json')).json();
    expect(openapi.paths['/api/learning/{lessonId}/advance'].post.requestBody.content['application/json'].schema.properties.stateVersion).toBeDefined();
    expect(openapi.paths['/api/learning/{lessonId}/advance'].post.parameters.some((parameter: { name: string; in: string }) => parameter.in === 'header' && parameter.name === 'X-Learning-Learner-Id')).toBe(true);
  });

  test('a stored pilot route survives optional clips: read-only resume, exact current/retry IDs, ACK replay, stale CAS and completed history',async()=>{
    const oldRoute=structuredClone(course.learning[0]!);let old=initialLearningState(oldRoute);
    old=advanceLearningState(oldRoute,old,'continue');old=advanceLearningState(oldRoute,old,'continue');
    const retryId=currentLearningStep(oldRoute,old)!.id;old=advanceLearningState(oldRoute,old,'again');
    const expectedStep=currentLearningStep(oldRoute,old)!;
    await database.sql`insert into learning_states(user_id,lesson_id,route_version,version,state) values(${users[2]!.id},${lessonId},${oldRoute.version},7,${old})`;
    const lesson=course.lessons.find(item=>item.id===lessonId)!;
    lesson.videos!.push({...lesson.videos![0]!,id:'fixture-added-video',mediaUrl:'https://a1.marugotoweb.jp/en/assets/movies/topics/cando_05_02.mp4',captionsSourceUrl:'https://a1.marugotoweb.jp/en/assets/data/topics/cando_05_02.xml'});
    course.learning[0]!.goals[0]!.videoIds!.push('fixture-added-video');
    const row=async()=>(await database.sql`select route_version,version,state from learning_states where user_id=${users[2]!.id} and lesson_id=${lessonId}`)[0]!;
    const before=await row();const resumed=await state(2);
    expect(resumed).toMatchObject({routeVersion:oldRoute.version,version:7,completedSteps:old.completedStepIds.length,step:expectedStep});expect(resumed.totalSteps).toBe(learningParts(oldRoute).flat().length+1);
    expect(await row()).toEqual(before);
    const input=payload(resumed,'remember');const response=await request('/api/learning/'+lessonId+'/advance',2,input);expect(response.status).toBe(200);const saved=await response.json();
    expect(await (await request('/api/learning/'+lessonId+'/advance',2,input)).json()).toEqual(saved);
    const stale=await request('/api/learning/'+lessonId+'/advance',2,{...input,attemptId:crypto.randomUUID()});expect(stale.status).toBe(409);expect((await stale.json()).error.code).toBe('LEARNING_CONFLICT');
    expect((await row()).state.pendingStepIds).toContain(retryId);expect(await database.sql`select 1 from review_attempts where user_id=${users[2]!.id}`).toHaveLength(1);
    // An already pending pilot video retains its exact identity; both optional steps skip without grading.
    let atVideo=old;
    while(currentLearningStep(oldRoute,atVideo)?.kind!=='video'){const step=currentLearningStep(oldRoute,atVideo)!;atVideo=advanceLearningState(oldRoute,atVideo,step.kind.endsWith('practice')?'remember':'continue');}
    await database.sql`update learning_states set version=9,state=${atVideo} where user_id=${users[2]!.id} and lesson_id=${lessonId}`;
    const reviewsBefore=await database.sql`select * from review_states where user_id=${users[2]!.id}`;const attemptsBefore=await database.sql`select * from review_attempts where user_id=${users[2]!.id}`;
    const pilot=await state(2);expect(pilot.step).toEqual(currentLearningStep(oldRoute,atVideo));
    const firstSkip=await advance(pilot,'skip',{},2);expect(firstSkip.reviewResult).toBeUndefined();expect(firstSkip.state.step).toMatchObject({kind:'video',videoId:'fixture-added-video'});
    const secondSkip=await advance(firstSkip.state,'skip',{},2);expect(secondSkip.reviewResult).toBeUndefined();expect(secondSkip.state.step?.kind).toBe('part-complete');
    expect(await database.sql`select * from review_states where user_id=${users[2]!.id}`).toEqual(reviewsBefore);expect(await database.sql`select * from review_attempts where user_id=${users[2]!.id}`).toEqual(attemptsBefore);
    let complete=initialLearningState(oldRoute);
    while(currentLearningStep(oldRoute,complete)){const step=currentLearningStep(oldRoute,complete)!;complete=advanceLearningState(oldRoute,complete,step.kind.endsWith('practice')?'remember':step.kind==='video'?'skip':'continue');}
    await database.sql`update learning_states set version=12,state=${complete} where user_id=${users[2]!.id} and lesson_id=${lessonId}`;
    const completedRow=await row();const done=await state(2);expect(done).toMatchObject({version:12,completed:true,step:null});expect(done.completedSteps).toBe(done.totalSteps);expect(await row()).toEqual(completedRow);
    expect(await database.sql`select * from review_states where user_id=${users[2]!.id}`).toEqual(reviewsBefore);
    const overview=await (await request('/api/learning',2)).json();expect(overview.lessons[0]).toMatchObject({completed:true,completedSteps:done.totalSteps,totalSteps:done.totalSteps});
  });
});
