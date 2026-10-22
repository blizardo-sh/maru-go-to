import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { createApp } from '../src/server/app';
import { createLink, consumeLink } from '../src/server/auth';
import { loadCourse } from '../src/server/course';
import { connectDatabase } from '../src/server/db';
import { defaultSettings } from '../src/server/material';
import { nextFixtureIp } from './helpers/fixture-ip';
import { reviewId } from '../src/server/reviews';
import type { Course, LearnerSettings, Progress, ReviewItem, ReviewQueue, ReviewSubmission, WordList } from '../src/shared/types';

const databaseUrl = process.env.JAPANESE_INTEGRATION_DATABASE_URL;
const suite = databaseUrl ? describe : describe.skip;
const origin = 'http://127.0.0.1:5173';

suite('application HTTP integration with disposable PostgreSQL', () => {
  let database: ReturnType<typeof connectDatabase>;
  let app: ReturnType<typeof createApp>;
  let course: Course;
  const learners: { id: string; email: string; cookie: string; ip: string }[] = [];
  let fixtureIp = nextFixtureIp();
  const password = 'Integration-only-password-2026!';
  const request = (path: string, cookie = '', body?: unknown, method = body === undefined ? 'GET' : 'POST') =>
    app.request(origin + path, {
      method,
      headers: { origin, 'x-forwarded-for': learners.find(learner => learner.cookie === cookie)?.ip ?? fixtureIp, ...(cookie ? { cookie } : {}), ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  const settings = (): LearnerSettings => ({
    ...structuredClone(defaultSettings),
    lessonStatuses: Object.fromEntries(course.lessons.map(lesson => [lesson.id, 'studying' as const])),
    newWordsPerDay: 100,
    newSkillsPerDay: 50,
  });
  const queue = async (mode: string): Promise<ReviewQueue> => {
    const lesson=course.lessons.find(lesson=>lesson.number===3)!;
    const response = await request('/api/training?lessonId=' + lesson.id, learners[0]!.cookie);
    expect(response.status).toBe(200);
    const queue:ReviewQueue=await response.json();
    const items:ReviewItem[]=[];
    for(const item of queue.items){
      if(mode==='grammar'){if(item.mode==='grammar')items.push(item);continue;}
      if(item.mode==='grammar'||item.mode==='counter'||mode==='listening'&&!item.word.audioUrl)continue;
      items.push({...item,id:reviewId(mode as 'ja-ru'|'ru-ja'|'listening',item.targetId),mode:mode as 'ja-ru'|'ru-ja'|'listening'});
    }
    return {...queue,items};
  };
  const answer = (item: ReviewItem, extra: object = {}): ReviewSubmission => item.mode === 'counter' ? {attemptId:crypto.randomUUID(),reviewId:item.id,version:item.version,mode:'counter',rating:3,choice:item.counter.acceptedKeys[0],helped:false,...extra} : item.mode === 'grammar'
    ? { attemptId: crypto.randomUUID(), reviewId: item.id, version: item.version, mode: item.mode, tokenIds: item.exercise.acceptedOrders[0]!, revealed: false, ...extra }
    : { attemptId: crypto.randomUUID(), reviewId: item.id, version: item.version, mode: item.mode, rating: 3, ...extra };

  beforeAll(async () => {
    const target = new URL(databaseUrl!);
    if (!['127.0.0.1', 'localhost'].includes(target.hostname) || target.pathname !== '/japanese_app_test') {
      throw new Error('Integration tests require disposable localhost /japanese_app_test.');
    }
    database = connectDatabase(databaseUrl!);
    course = loadCourse();
    app = createApp({ database, course, config: { DATABASE_URL: databaseUrl!, BETTER_AUTH_SECRET: 'integration-only-secret-with-more-than-32-characters', APP_URL: origin, PORT: 3000, HOST: '127.0.0.1' } });
    for (let index = 0; index < 2; index++) {
      fixtureIp = nextFixtureIp();
      const email = `integration-${crypto.randomUUID()}@example.test`;
      const link = await createLink(database, 'invite', email, null);
      expect(await consumeLink(database, 'invite', link.token, password, `Integration ${index}`)).toBe(true);
      const response = await request('/api/auth/sign-in/email', '', { email, password });
      expect(response.status).toBe(200);
      const result = await response.json();
      const cookie = response.headers.getSetCookie().map(part => part.split(';')[0]).join('; ');
      expect(cookie).toContain('session_token');
      learners.push({ id: result.user.id, email, cookie, ip: fixtureIp });
    }
  });
  beforeEach(async () => {
    for (const learner of learners) {
      const response = await request('/api/settings', learner.cookie, settings(), 'PUT');
      expect(response.status).toBe(200);
    }
  });
  afterAll(async () => {
    if (!database) return;
    for (const learner of learners) {
      await database.sql`delete from access_links where email=${learner.email}`;
      await database.sql`delete from users where id=${learner.id}`;
    }
    await database.sql.close();
  });

  test('unauthenticated access and direct signup remain closed', async () => {
    expect((await request('/api/settings')).status).toBe(401);
    expect((await request('/api/reviews?mode=ja-ru')).status).toBe(401);
    const signup = await request('/api/auth/sign-up/email', '', { name: 'Uninvited', email: `uninvited-${crypto.randomUUID()}@example.test`, password });
    expect(signup.status).toBeGreaterThanOrEqual(400);
    const invalid = await request('/api/reviews', learners[0]!.cookie, { attemptId: crypto.randomUUID(), reviewId: 'bad', version: 0, mode: 'listening', rating: 5 });
    expect(invalid.status).toBe(400);
    const foreignOrigin = await app.request(origin + '/api/settings', { method: 'PUT', headers: { cookie: learners[0]!.cookie, origin: 'https://another-origin.example', 'content-type': 'application/json' }, body: JSON.stringify(settings()) });
    expect(foreignOrigin.status).toBe(403);
    expect((await request('/api/admin/users', learners[1]!.cookie)).status).toBe(403);
  });

  test('official course material covers both books and every lesson', async () => {
    const response = await request('/api/course', learners[0]!.cookie);
    expect(response.status).toBe(200);
    const delivered: Course = await response.json();
    expect(delivered.lessons.map(lesson => lesson.number).sort((a,b) => a-b)).toEqual(Array.from({ length: 18 }, (_,index) => index+1));
    const sourceRows = new Set(delivered.words.flatMap(word => word.sourceRefs)
      .filter(source => source.url.endsWith('VocabularyIndex2_RU.pdf') && source.page && source.row)
      .map(source => `${source.part}:${source.page}:${source.row}`));
    expect(sourceRows.size).toBeGreaterThanOrEqual(1113);
    for (const lesson of delivered.lessons) {
      const words = delivered.words.filter(word => word.lessonIds.includes(lesson.id));
      expect(words.length).toBeGreaterThan(0);
      for (const part of ['katsudoo', 'rikai']) {
        expect(words.some(word => word.sourceRefs.some(source => source.part === part && source.page && source.entry))).toBe(true);
      }
    }
  });

  test('private lists cannot be read, edited or enabled by another learner', async () => {
    const created = await request('/api/lists', learners[0]!.cookie, { name: 'Only learner A', text: '試験 — испытание\nテスト — тест' });
    expect(created.status).toBe(200);
    const list: WordList = await created.json();
    expect(list.words).toHaveLength(2);
    const personalOnly = { ...settings(), lessonStatuses: {}, enabledListIds: [list.id] };
    expect((await request('/api/settings', learners[0]!.cookie, personalOnly, 'PUT')).status).toBe(200);
    expect((await (await request('/api/training?listId='+list.id,learners[0]!.cookie)).json()).items).toHaveLength(0);
    const confirmed = await request(`/api/lists/${list.id}/words/${list.words[0]!.id}`, learners[0]!.cookie, { kana: 'しけん' }, 'PATCH');
    expect(confirmed.status).toBe(200);
    expect((await confirmed.json()).reviewStatus).toBe('reviewed');
    expect((await (await request('/api/training?listId='+list.id,learners[0]!.cookie)).json()).items.map((item:ReviewItem) => item.targetId)).toEqual([list.words[0]!.id]);
    const response = await request('/api/lists', learners[1]!.cookie);
    const body = await response.json();
    expect(body.lists.some((candidate: WordList) => candidate.id === list.id)).toBe(false);
    const edited = await request(`/api/lists/${list.id}/words/${list.words[0]!.id}`, learners[1]!.cookie, { meaningRu: 'stolen' }, 'PATCH');
    expect([403,404]).toContain(edited.status);
    const enabled = await request('/api/settings', learners[1]!.cookie, { ...settings(), enabledListIds: [list.id] }, 'PUT');
    expect([200,400,403]).toContain(enabled.status);
    if (enabled.status === 200) {
      const queueResponse = await request('/api/reviews?mode=ja-ru', learners[1]!.cookie);
      const personalQueue: ReviewQueue = await queueResponse.json();
      expect(personalQueue.items.some(item => list.words.some(word => word.id === item.targetId))).toBe(false);
    }
  });

  test('manual legacy focus and display choices do not change training', async () => {
    const first = course.lessons.find(lesson => lesson.number === 1)!;
    const last = course.lessons.find(lesson => lesson.number === 18)!;
    const selected = { ...settings(), lessonStatuses: { [first.id]: 'studying' as const }, focusLessonIds: [last.id] };
    expect((await request('/api/settings', learners[0]!.cookie, selected, 'PUT')).status).toBe(200);
    const original = await queue('ja-ru');
    expect(original.items.length).toBeGreaterThan(0);
    for (const item of original.items) {
      expect(item.mode).not.toBe('grammar');
      if (item.mode !== 'grammar' && item.mode !== 'counter') expect(item.word.lessonIds).toContain(course.lessons.find(lesson=>lesson.number===3)!.id);
    }
    expect((await request('/api/settings', learners[0]!.cookie, { ...selected, orthography: 'kana' }, 'PUT')).status).toBe(200);
    const changed = await queue('ja-ru');
    expect(changed.items.map(item => [item.id,item.version])).toEqual(original.items.map(item => [item.id,item.version]));
  });

  test('retry, concurrent devices and audio change exactly their own schedule', async () => {
    const japanese = await queue('ja-ru');
    const audio = await queue('listening');
    const item = japanese.items.find(candidate => audio.items.some(other => other.targetId === candidate.targetId))!;
    expect(item).toBeDefined();
    const submission = answer(item);
    const first = await request('/api/reviews', learners[0]!.cookie, submission);
    expect(first.status).toBe(200);
    const saved = await first.json();
    expect(saved.status).toBe('scheduled');
    const retried = await request('/api/reviews', learners[0]!.cookie, submission);
    expect(retried.status).toBe(200);
    expect(await retried.json()).toEqual(saved);
    const [{ count }] = await database.sql`select count(*)::int as count from review_attempts where attempt_id=${submission.attemptId}`;
    expect(count).toBe(1);
    const crossUser = await request('/api/reviews', learners[1]!.cookie, submission);
    expect(crossUser.status).toBe(409);

    const russian = (await (await request('/api/reviews?mode=ru-ja',learners[0]!.cookie)).json() as ReviewQueue).items.find(candidate => candidate.targetId === item.targetId)!;
    expect(russian.version).toBe(0);
    const concurrent = await Promise.all([request('/api/reviews', learners[0]!.cookie, answer(russian)), request('/api/reviews', learners[0]!.cookie, answer(russian))]);
    expect(concurrent.map(response => response.status)).toEqual([200,200]);
    const results = await Promise.all(concurrent.map(response => response.json()));
    expect(results.map(result => result.status).sort()).toEqual(['additional-practice','scheduled']);

    expect((await request('/api/settings', learners[0]!.cookie, { ...settings(), orthography: 'kanji' }, 'PUT')).status).toBe(200);
    const listening = (await (await request('/api/reviews?mode=listening',learners[0]!.cookie)).json() as ReviewQueue).items.find(candidate => candidate.targetId === item.targetId)!;
    expect(listening.version).toBe(0);
    expect((await request('/api/reviews', learners[0]!.cookie, answer(listening))).status).toBe(200);
    const states = await database.sql`select mode,version from review_states where user_id=${learners[0]!.id} and item_id=${item.targetId} order by mode`;
    expect(states.map((row: {mode: string;version: number}) => [row.mode,row.version])).toEqual([['ja-ru',1],['listening',1],['ru-ja',1]]);
    const progress = await request('/api/progress', learners[0]!.cookie);
    expect((await progress.json()).wordsIntroducedToday).toBe(1);
  });

  test('prepared construction grading is separate from self-rated word practice', async () => {
    const item = (await queue('grammar')).items[0]!;
    expect(item.mode).toBe('grammar');
    if (item.mode !== 'grammar') throw new Error('Missing grammar card');
    const response = await request('/api/reviews', learners[0]!.cookie, answer(item));
    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result.correct).toBe(true);
    expect(result.status).toBe('scheduled');
    const [{ count }] = await database.sql`select count(*)::int as count from review_states where user_id=${learners[0]!.id} and item_id=${item.targetId} and mode<>'grammar'`;
    expect(count).toBe(0);
  });
  test('meaning-changing forms are exploratory and cannot grade the original prepared prompt', async () => {
    const normalizeProgress = (progress: Progress): Progress => ({ ...progress, introducedWordIds: [...progress.introducedWordIds].sort(), introducedSkillIds: [...progress.introducedSkillIds].sort() });
    for (const [exerciseId, expectedKana] of [
      ['marugoto.starter-a1.example.frequency.l11.2', 'みません'],
      ['marugoto.starter-a1.example.verb_past.l15.1', 'かいました'],
    ]) {
      const exercise = course.exercises.find(candidate => candidate.id === exerciseId)!;
      expect(exercise.reviewStatus).not.toBe('draft');
      expect(exercise.tokens.every(token => course.forms.find(form => form.id === token.formId)?.reviewStatus !== 'draft')).toBe(true);
      const token = exercise.tokens.find(candidate => course.forms.find(form => form.id === candidate.formId)?.kana === expectedKana)!;
      const expectedForm = course.forms.find(form => form.id === token.formId)!;
      const word = course.words.find(word => word.id === expectedForm.wordId)!;
      const present = course.forms.find(form => form.wordId === word.id && form.surface === word.surface && form.kana === word.kana)!;
      expect(present).toBeDefined();
      expect(expectedForm.wordId).toBe(present.wordId);
      const submission: ReviewSubmission = { attemptId: crypto.randomUUID(), reviewId: reviewId('grammar', exercise.skillId, exercise.id), version: 0, mode: 'grammar', tokenIds: exercise.acceptedOrders[0]!, tokenForms: { [token.id]: present.id }, revealed: false };
      const before: Progress = await (await request('/api/progress', learners[0]!.cookie)).json();
      const wrong = await request('/api/reviews', learners[0]!.cookie, submission);
      expect(wrong.status).toBe(409);
      expect((await wrong.json()).error.code).toBe('EXPLORATION_NOT_SCHEDULED');
      const after: Progress = await (await request('/api/progress', learners[0]!.cookie)).json();
      expect(normalizeProgress(after)).toEqual(normalizeProgress(before));
      const correction = await request('/api/reviews', learners[0]!.cookie, { ...submission, attemptId: crypto.randomUUID(), tokenForms: { [token.id]: expectedForm.id } });
      expect(correction.status).toBe(200);
      expect(await correction.json()).toMatchObject({ correct: true, status: 'scheduled', version: 1 });
    }
  });


  test('only an owned and confirmed noun enters the safe prepared personal template', async () => {
    const owner = learners[1]!;
    const other = learners[0]!;
    const created = await request('/api/lists', owner.cookie, { name: 'Personal grammar boundary', text: '傘; かさ; зонтик\n泳ぎます; およぎます; плавать\n未確認; みかくにん; без проверки' });
    expect(created.status).toBe(200);
    const list: WordList = await created.json();
    const noun = list.words[0]!;
    const verb = list.words[1]!;
    const draft = list.words[2]!;
    expect((await request(`/api/lists/${list.id}/words/${noun.id}`, owner.cookie, { pos: 'noun' }, 'PATCH')).status).toBe(200);
    expect((await request(`/api/lists/${list.id}/words/${verb.id}`, owner.cookie, { pos: 'verb' }, 'PATCH')).status).toBe(200);
    const skillId = 'marugoto.starter-a1.skill.wa_identity';
    expect((await request('/api/settings', owner.cookie, { ...settings(), enabledListIds: [list.id], focusSkillIds: [skillId] }, 'PUT')).status).toBe(200);
    const courseResponse = await request('/api/course', owner.cookie);
    const personalized: Course = await courseResponse.json();
    const example = personalized.exercises.find(exercise => exercise.id.startsWith(noun.id))!;
    expect(example).toBeDefined();
    expect(example.skillId).toBe(skillId);
    expect(personalized.exercises.some(exercise => exercise.id.startsWith(verb.id) || exercise.id.startsWith(draft.id))).toBe(false);
    const forms = new Map(personalized.forms.map(form => [form.id,form]));
    expect(example.acceptedOrders[0]!.map(id => forms.get(example.tokens.find(token => token.id === id)!.formId)!.surface).join('')).toBe('これは傘です');
    const queueResponse = await request('/api/training?listId='+list.id, owner.cookie);
    const personalizedQueue: ReviewQueue = await queueResponse.json();
    const item = personalizedQueue.items.find(candidate => candidate.mode === 'grammar' && candidate.exercise.id === example.id)!;
    expect(item).toBeDefined();
    const submission = answer(item);
    const graded = await request('/api/reviews', owner.cookie, submission);
    expect(graded.status).toBe(200);
    expect((await graded.json()).correct).toBe(true);
    const stolen = await request('/api/reviews', other.cookie, { ...submission, attemptId: crypto.randomUUID() });
    expect(stolen.status).toBe(403);
    const otherResponse = await request('/api/course', other.cookie);
    const otherCourse: Course = await otherResponse.json();
    expect(otherCourse.words.some(word => word.id === noun.id)).toBe(false);
    expect((await request('/api/settings', owner.cookie, settings(), 'PUT')).status).toBe(200);
    const disabledResponse = await request('/api/course', owner.cookie);
    const disabled: Course = await disabledResponse.json();
    expect(disabled.exercises.some(exercise => exercise.id.startsWith(noun.id))).toBe(true);
  });

  test('legacy zero limits do not affect automatic enrollment or due reviews', async () => {
    const limited = { ...settings(), newWordsPerDay: 0, newSkillsPerDay: 0 };
    expect((await request('/api/settings', learners[1]!.cookie, limited, 'PUT')).status).toBe(200);
    for (const mode of ['ja-ru','ru-ja','listening','grammar']) {
      const response = await request('/api/reviews?mode=' + mode, learners[1]!.cookie);
      const result: ReviewQueue = await response.json();
      expect(result.items.every(item=>!item.isNew)).toBe(true);
      expect(result.remainingNew).toBe(0);
    }
    await database.sql`update review_states set due=now()-interval '1 minute' where user_id=${learners[0]!.id} and mode='ja-ru'`;
    expect((await request('/api/settings', learners[0]!.cookie, limited, 'PUT')).status).toBe(200);
    const due:ReviewQueue=await (await request('/api/reviews?mode=ja-ru',learners[0]!.cookie)).json();
    expect(due.remainingDue).toBeGreaterThan(0);
    expect(due.items.every(item => !item.isNew)).toBe(true);
    expect(due.remainingNew).toBe(0);
  });

});
