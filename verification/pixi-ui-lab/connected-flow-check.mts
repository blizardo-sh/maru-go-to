import assert from 'node:assert/strict';
import { ConnectedFlow, liveCatalog } from './connected-flow';
const pub = 'a'.repeat(64), nextPub = 'b'.repeat(64);
const word = { id: 'fish', surface: '魚', kana: 'さかな', segments: [{ surface: '魚', reading: 'さかな' }], meaningRu: 'рыба' };
const example = { ...word, audioUrl: '/audio/fish.m4a' };
const intro = { exerciseId: 'exercise', explanationRu: 'Пример', example, breakdown: [] };
const course: any = { publicationId: pub, words: [word], forms: [{ id: 'form', wordId: word.id, surface: word.surface, kana: word.kana }],
  lessons: [{ id: 'lesson', number: 1, title: 'Урок', topic: 1, videos: [] }],
  learning: [{ lessonId: 'lesson', version: 'v1', titleRu: 'Урок', goals: [{ id: 'goal', titleRu: 'Цель', canDoIds: [], parts: [{ id: 'part', words: [{ wordId: word.id, explanationRu: 'Слово', example }], construction: intro }] }] }],
  exercises: [{ id: 'exercise', promptRu: 'Рыба', tokens: [{ id: 'token', formId: 'form' }], sentenceEnd: '。', acceptedOrders: [['token']] }] };
let issued: any, posts: any[] = [], deferred: ((response: Response) => void) | null = null, holdCourse = false;
const store = new Map<string, string>();
Object.assign(globalThis, { localStorage: { getItem: (key: string) => store.get(key) ?? null, setItem: (key: string, value: string) => store.set(key, value) } });
const originalFetch = globalThis.fetch;
globalThis.fetch = (async (path: string, init: RequestInit = {}) => {
  const json = (value: any) => Response.json(value);
  if (path === '/api/me') return json({ id: 'pupil', name: 'Проверка', email: 'pupil@example.test' });
  if (path === '/api/auth/sign-out') return json({ success: true });
  if (path === '/api/course') {
    assert.equal(new Headers(init.headers).get('X-Learning-Learner-Id'), 'pupil');
    if (holdCourse) return new Promise<Response>(resolve => { deferred = resolve; });
    return json(course);
  }
  if (path === '/api/learning') return json({ lessons: [issued] });
  if (path === '/api/learning/lesson') return json(issued);
  if (path === '/api/learning/lesson/advance') {
    const input = JSON.parse(init.body as string); posts.push(input);
    assert.equal(input.publicationId, issued.publicationId);
    assert.equal(new Headers(init.headers).get('X-Learning-Learner-Id'), 'pupil');
    return json({ attemptId: input.attemptId, state: { ...issued, publicationId: holdCourse ? nextPub : pub, version: issued.version + 1 }, reviewResult: { correct: input.counterChoice === 'right' } });
  }
  if (path === '/api/analyze') return json({ status: 'ok', translationRu: 'Рыба', explanationRu: 'Подготовленный пример' });
  throw new Error(`Unexpected request ${path}`);
}) as typeof fetch;
try {
  issued = { publicationId: pub, lessonId: 'lesson', routeVersion: 'v1', version: 2, partIndex: 0, totalParts: 1, completedSteps: 1, totalSteps: 5, completed: false,
    step: { id: 'counter', kind: 'counter-practice', partId: 'part', goalId: 'goal', counterId: 'mai', quantity: 1, wordId: word.id, format: 'reading-choice' },
    reviewItem: { id: 'counter-review', version: 0, mode: 'counter', counter: { acceptedKeys: ['right'] } } };
  const flow = new ConnectedFlow(() => {}); await flow.boot(); await flow.open('lesson'); flow.start();
  const ticket = flow.ticket(); assert.equal(await flow.chooseCounter('wrong'), false);
  assert.equal(await flow.chooseCounter('right'), true); assert.equal(posts.length, 1);
  assert.equal(posts[0].counterChoice, 'wrong'); assert.equal(await flow.advance(ticket, 'again'), true);
  assert.equal(flow.snapshot().version, 3);
  const pending = { lessonId: 'lesson', submission: { ...posts[0], attemptId: crypto.randomUUID(), stateVersion: 0 } };
  store.set('japanese-pending-learning:pupil', JSON.stringify([pending]));
  assert.equal(await flow.chooseCounter('right'), undefined);
  assert.deepEqual(posts[1], pending.submission); assert.equal(posts.length, 2);
  assert.equal(flow.snapshot().version, 3); assert.match(flow.error, /первоначальный ответ/);
  const bird = { ...word, id: 'bird', surface: '鳥', kana: 'とり', segments: [{ surface: '鳥', reading: 'とり' }] };
  flow.course!.words.push(bird as any);
  flow.route!.goals[0]!.parts[0]!.words.push({ wordId: bird.id, explanationRu: 'Птица', example: { ...example, surface: bird.surface } });
  issued = { ...issued, step: { id: 'bird-intro', kind: 'word-intro', partId: 'part', goalId: 'goal', wordId: bird.id } };
  await flow.open('lesson'); assert.equal(flow.word?.id, bird.id, 'Introduction restarted before the server-issued word');
  issued = { ...issued, step: { id: 'grammar', kind: 'construction-practice', mode: 'grammar', exerciseId: 'exercise', partId: 'part', goalId: 'goal' }, reviewItem: { id: 'grammar-review', version: 0, mode: 'grammar' } };
  await flow.open('lesson'); flow.start();
  assert.equal(await flow.checkConstruction([], '魚'), null); assert.match(flow.checkFeedback, /не оценивает/); assert.equal(posts.length, 2);
  issued = { ...issued, step: { id: 'counter', kind: 'counter-practice', partId: 'part', goalId: 'goal', counterId: 'mai', quantity: 1, wordId: word.id }, reviewItem: { mode: 'counter', counter: { acceptedKeys: ['right'] } } };
  await flow.open('lesson'); flow.start(); holdCourse = true;
  const answer = flow.chooseCounter('right');
  while (!deferred) await new Promise(resolve => setTimeout(resolve, 0));
  await flow.logout(); deferred!(Response.json({ ...course, publicationId: nextPub })); await answer;
  assert.equal(flow.user, null); assert.equal(flow.active, false); assert.equal(flow.course, null); assert.equal(flow.snapshot().confirmedNext, false); assert.deepEqual(liveCatalog.lessons, []);
  console.log('Counter correction, introduction resume, exploration without grading, and late publication response after logout passed.');
} finally { globalThis.fetch = originalFetch; }
