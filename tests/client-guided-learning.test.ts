import { afterEach, beforeEach, expect, spyOn, test } from 'bun:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { currentLearningState, pendingLearning, submitLearning, type PendingLearning } from '../src/client/guidedApi';
import { pendingReviews, submitReview } from '../src/client/api';
import { Textbook } from '../src/client/Textbook';
import { sourceKey, trainingContext } from '../src/client/learning';
import { defaultSettings } from '../src/server/material';
import type { LearningState } from '../src/shared/learning';
import type { Progress, ReviewSubmission } from '../src/shared/types';
import { learningFixture } from './helpers/learning-fixture';

class MemoryStorage implements Storage {
  private items = new Map<string, string>();
  get length() { return this.items.size; }
  clear() { this.items.clear(); }
  getItem(key: string) { return this.items.get(key) ?? null; }
  key(index: number) { return [...this.items.keys()][index] ?? null; }
  removeItem(key: string) { this.items.delete(key); }
  setItem(key: string, value: string) { this.items.set(key, value); }
}
const storage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
let fetchSpy: ReturnType<typeof spyOn<typeof globalThis, 'fetch'>>;
const state: LearningState = { lessonId: 'lesson-3', routeVersion: 'v1', version: 0, partIndex: 0, totalParts: 2, completedSteps: 0, totalSteps: 15, completed: false, step: { id: 'intro-1', goalId: 'goal-1', partId: 'part-1', kind: 'word-intro', wordId: 'word-1' } };
const attempt = (): PendingLearning => ({ lessonId: state.lessonId, submission: { attemptId: crypto.randomUUID(), routeVersion: state.routeVersion, stateVersion: 0, stepId: 'intro-1', action: 'continue' } });

beforeEach(() => { Object.defineProperty(globalThis, 'localStorage', { value: new MemoryStorage(), configurable: true }); fetchSpy = spyOn(globalThis, 'fetch'); });
afterEach(() => { fetchSpy.mockRestore(); if (storage) Object.defineProperty(globalThis, 'localStorage', storage); else Reflect.deleteProperty(globalThis, 'localStorage'); });

test('lost learning ACK retains the exact attempt, retries unchanged, and never touches another learner outbox', async () => {
  const first = attempt(); first.submission.publicationId = 'a'.repeat(64); const other = attempt(); const posts: unknown[] = [];
  localStorage.setItem('japanese-pending-learning:learner-b', JSON.stringify([other]));
  fetchSpy.mockImplementation(Object.assign(async (_url: RequestInfo | URL, init?: RequestInit) => { expect(new Headers(init?.headers).get('X-Content-Publication')).toBe(first.submission.publicationId!); posts.push(JSON.parse(String(init?.body))); throw new Error('Lost ACK'); }, { preconnect() {} }));
  await expect(submitLearning('learner-a', first)).rejects.toThrow('Lost ACK');
  expect(pendingLearning('learner-a')).toEqual([first]); expect(pendingLearning('learner-b')).toEqual([other]);
  fetchSpy.mockImplementation(Object.assign(async (_url: RequestInfo | URL, init?: RequestInit) => { expect(new Headers(init?.headers).get('X-Content-Publication')).toBe(first.submission.publicationId!); posts.push(JSON.parse(String(init?.body))); return Response.json({ attemptId: first.submission.attemptId, state: { ...state, publicationId: 'b'.repeat(64), routeVersion: 'new-publication-route', version: 1, completedSteps: 1 } }); }, { preconnect() {} }));
  const result = await submitLearning('learner-a', pendingLearning('learner-a')[0]!);
  expect(result.state.version).toBe(1); expect(posts).toEqual([first.submission, first.submission]); expect(pendingLearning('learner-a')).toEqual([]); expect(pendingLearning('learner-b')).toEqual([other]);
});

test('unmatched ACK or changed retry cannot discard a saved answer', async () => {
  const first = attempt(); fetchSpy.mockResolvedValue(Response.json({ attemptId: 'wrong-attempt', state }));
  await expect(submitLearning('learner-a', first)).rejects.toThrow('не подтвердил'); expect(pendingLearning('learner-a')).toEqual([first]);
  await expect(submitLearning('learner-a', { ...first, submission: { ...first.submission, action: 'again' } })).rejects.toThrow('первоначальный ответ'); expect(fetchSpy).toHaveBeenCalledTimes(1); expect(pendingLearning('learner-a')).toEqual([first]);
});

test('malformed persisted learning attempts stay intact and never send a request', () => {
  const bad = '[{"lessonId":"lesson-3","submission":{"attemptId":"a","action":"remember","stateVersion":"0"}}]';
  localStorage.setItem('japanese-pending-learning:learner-a', bad);
  expect(() => pendingLearning('learner-a')).toThrow('Не очищайте'); expect(localStorage.getItem('japanese-pending-learning:learner-a')).toBe(bad); expect(fetchSpy).not.toHaveBeenCalled();
});

test('only an explicit not-applied learning conflict discards an obsolete attempt; identity conflicts remain queued', async () => {
  const stale = attempt(); const unrelated = attempt();
  localStorage.setItem('japanese-pending-learning:learner-a', JSON.stringify([unrelated]));
  fetchSpy.mockResolvedValue(Response.json({ error: { code: 'LEARNING_CONFLICT', message: 'Step changed' } }, { status: 409 }));
  await expect(submitLearning('learner-a', stale)).rejects.toMatchObject({ status: 409, code: 'LEARNING_CONFLICT' });
  expect(pendingLearning('learner-a')).toEqual([unrelated]);
  fetchSpy.mockResolvedValue(Response.json({ error: { code: 'ATTEMPT_CONFLICT', message: 'Attempt identity changed' } }, { status: 409 }));
  await expect(submitLearning('learner-a', stale)).rejects.toMatchObject({ status: 409, code: 'ATTEMPT_CONFLICT' });
  expect(pendingLearning('learner-a')).toEqual([unrelated, stale]);
});

test('ordinary repeat retry sends its expected learner and preserves the exact outbox when another learner owns the cookie', async () => {
  const answer: ReviewSubmission = { attemptId: crypto.randomUUID(), reviewId: 'word-a:ja-ru', version: 0, publicationId: 'a'.repeat(64), mode: 'ja-ru', rating: 3 };
  const saved = JSON.stringify([answer]);
  localStorage.setItem('japanese-pending-reviews:learner-a', saved);
  fetchSpy.mockImplementation(Object.assign(async (url: RequestInfo | URL, init?: RequestInit) => {
    expect(url).toBe('/api/reviews');
    expect(new Headers(init?.headers).get('X-Learning-Learner-Id')).toBe('learner-a');
    expect(new Headers(init?.headers).get('X-Content-Publication')).toBe(answer.publicationId!);
    expect(JSON.parse(String(init?.body))).toEqual(answer);
    return Response.json({ error: { code: 'OWNER_CHANGED', message: 'Account changed' } }, { status: 409 });
  }, { preconnect() {} }));
  await expect(submitReview('learner-a', pendingReviews('learner-a')[0]!)).rejects.toMatchObject({ status: 409, code: 'OWNER_CHANGED' });
  expect(localStorage.getItem('japanese-pending-reviews:learner-a')).toBe(saved);
  expect(pendingReviews('learner-a')).toEqual([answer]);
  expect(localStorage.getItem('japanese-pending-reviews:learner-b')).toBeNull();
  expect(fetchSpy).toHaveBeenCalledTimes(1);
});

test('only explicit INVALID_CHOICE discards a rejected choice; other learner and ambiguous failures remain queued', async () => {
  const stale: PendingLearning = { ...attempt(), submission: { ...attempt().submission, action: 'choose', choiceWordId: 'old-choice' } }, unrelated = attempt(), other = attempt();
  localStorage.setItem('japanese-pending-learning:learner-a', JSON.stringify([unrelated]));
  localStorage.setItem('japanese-pending-learning:learner-b', JSON.stringify([other]));
  fetchSpy.mockResolvedValue(Response.json({ error: { code: 'INVALID_CHOICE', message: 'Choices changed' } }, { status: 400 }));
  await expect(submitLearning('learner-a', stale)).rejects.toMatchObject({ status: 400, code: 'INVALID_CHOICE' });
  expect(pendingLearning('learner-a')).toEqual([unrelated]); expect(pendingLearning('learner-b')).toEqual([other]);
  fetchSpy.mockResolvedValue(Response.json({ error: { code: 'INVALID_CHOICE', message: 'Ambiguous failure' } }, { status: 503 }));
  await expect(submitLearning('learner-a', stale)).rejects.toMatchObject({ status: 503 });
  expect(pendingLearning('learner-a')).toEqual([unrelated, stale]);
});

test('a stale ACK cannot move a newer route backward or cross lesson/content versions', () => {
  expect(currentLearningState({ ...state, version: 2 }, state.lessonId, 'v1', { ...state, version: 3 })).toBe(false);
  expect(currentLearningState({ ...state, lessonId: 'other' }, state.lessonId, 'v1', null)).toBe(false);
  expect(currentLearningState({ ...state, routeVersion: 'old' }, state.lessonId, 'v1', null)).toBe(false);
  expect(currentLearningState({ ...state, version: 4 }, state.lessonId, 'v1', { ...state, version: 3 })).toBe(true);
  expect(sourceKey({ kind: 'guided', lessonId: state.lessonId })).not.toBe(sourceKey({ kind: 'lesson', lessonId: state.lessonId }));
  expect(trainingContext({ kind: 'guided', lessonId: state.lessonId })).toEqual({ lessonId: state.lessonId });
});

test('textbook primary route progress is separate from legacy SRS and vocabulary practice is explicitly supplementary', () => {
  const course = learningFixture(); const lesson = course.learning[0]!;
  const counts = { due: 0, learned: 0, reviewedToday: 0 };
  const progress: Progress = { counters: [], introducedWordIds: course.words.map(word => word.id), introducedSkillIds: course.skills.map(skill => skill.id), completedLessons: 18, totalLessons: 18, wordsIntroducedToday: 0, skillsIntroducedToday: 0, byMode: { 'ja-ru': counts, 'ru-ja': counts, listening: counts, grammar: counts, counter: counts } };
  const html = renderToStaticMarkup(createElement(Textbook, { data: { course, settings: defaultSettings, progress, lists: [], learning: [{ ...state, lessonId: lesson.lessonId, routeVersion: lesson.version }] }, onLearn() {}, onTrain() {} }));
  const card = [...html.matchAll(/<article[^>]+data-lesson-id="([^"]+)"[\s\S]*?<\/article>/g)].find(match => match[1] === lesson.lessonId)?.[0];
  expect(card).toBeDefined(); expect(card).toContain('Учебный маршрут: 0%'); expect(card).toContain('Начать урок'); expect(card).toContain('Дополнительный словарь и конструкции'); expect(card).toContain('Практиковать словарь'); expect(card).not.toContain('Урок пройден');
});
