import { expect, test } from 'bun:test';
import { loadCourse } from '../src/server/course';
import { advanceLearningState, currentLearningStep, initialLearningState, learningParts, startLearningPractice } from '../src/shared/learning';
import { confusableLearningWords, learningWordChoices } from '../src/shared/learningChoices';
import { learningFixture } from './helpers/learning-fixture';

test('group start acknowledges only remaining intros, mixes every word/format once, and preserves construction/video boundaries', () => {
  const course = loadCourse(); const route = course.learning![0]!;
  const original = initialLearningState(route);
  const partiallyIntroduced = advanceLearningState(route, original, 'continue');
  const saved = structuredClone(partiallyIntroduced);
  const next = startLearningPractice(route, partiallyIntroduced);
  expect(partiallyIntroduced).toEqual(saved);
  const definitions = learningParts(route)[0]!;
  expect(next.completedStepIds).toEqual(definitions.filter(step => step.kind === 'word-intro').map(step => step.id));
  expect(next.wordQuiz).toBe(true);
  const practice = next.pendingStepIds.map(id => definitions.find(step => step.id === id)!).filter(step => step.kind === 'word-practice');
  expect(practice).toHaveLength(15);
  expect(new Set(practice.map(step => step.id)).size).toBe(15);
  for (let i = 1; i < practice.length; i++) expect(practice[i]!.wordId).not.toBe(practice[i - 1]!.wordId);
  for (const word of route.goals[0]!.parts[0]!.words) expect(practice.filter(step => step.wordId === word.wordId).map(step => step.mode).sort()).toEqual(['ja-ru', 'listening', 'ru-ja']);
  expect(next.pendingStepIds.filter(id => !practice.some(step => step.id === id))).toEqual(saved.pendingStepIds.filter(id => definitions.find(step => step.id === id)?.kind !== 'word-intro' && !practice.some(step => step.id === id)));
  expect(startLearningPractice(route, saved)).toEqual(next);
  expect(() => startLearningPractice(route, next)).toThrow('introduction');
  expect(currentLearningStep(route, saved)?.id).toBe(saved.pendingStepIds[0]!);
  expect(route.version).toBe('2026-10-21.1');
});

test('legacy single-intro continue and already started retry queue remain unchanged; new quiz state uses the existing retry rule', () => {
  const route = learningFixture().learning[0]!;
  let state = initialLearningState(route);
  state = advanceLearningState(route, state, 'continue');
  expect(state.completedStepIds).toHaveLength(1);
  expect(currentLearningStep(route, state)?.kind).toBe('word-intro');
  state = startLearningPractice(route, state);
  const difficult = currentLearningStep(route, state)!;
  state = advanceLearningState(route, state, 'again');
  const saved = structuredClone(state);
  expect(currentLearningStep(route, state)?.id).not.toBe(difficult.id);
  expect(state.pendingStepIds).toContain(difficult.id);
  expect(state.completedStepIds).not.toContain(difficult.id);
  expect(() => startLearningPractice(route, state)).toThrow();
  expect(state).toEqual(saved);
  for (let round = 0; round < 6; round++) {
    while (currentLearningStep(route, state)?.id !== difficult.id) {
      const step = currentLearningStep(route, state)!;
      expect(['video', 'part-complete']).not.toContain(step.kind);
      state = advanceLearningState(route, state, step.kind.endsWith('practice') ? 'remember' : 'continue');
    }
    state = advanceLearningState(route, state, round === 5 ? 'remember' : 'again');
  }
  expect(currentLearningStep(route, state)?.kind).toBe('video');
});

test('all 305 authored word placements have four stable, distinct same-lesson choices in each format', () => {
  const course = loadCourse(); const reloaded = loadCourse(); let questions = 0; const targets = new Set<string>();
  for (const route of course.learning!) for (const step of learningParts(route).flat()) if (step.kind === 'word-practice') {
    const ids = learningWordChoices(course, route, step);
    expect(ids).toHaveLength(4); expect(new Set(ids).size).toBe(4); expect(ids).toContain(step.wordId);
    expect(learningWordChoices(reloaded, reloaded.learning!.find(item => item.lessonId === route.lessonId)!, structuredClone(step))).toEqual(ids);
    const words = ids.map(id => course.words.find(word => word.id === id)!);
    for (const word of words) { expect(word.lessonIds).toContain(route.lessonId); expect(word.reviewStatus).not.toBe('draft'); }
    for (let i = 0; i < words.length; i++) for (let j = i + 1; j < words.length; j++) expect(confusableLearningWords(words[i]!, words[j]!)).toBe(false);
    targets.add(step.wordId); questions++;
  }
  expect(questions).toBe(915); expect(targets.size).toBe(279);
});

test('politeness, shared meanings and equivalent readings cannot create a false wrong answer', () => {
  const course = loadCourse(); const bySurface = (surface: string) => course.words.find(word => word.surface === surface)!;
  for (const [a, b] of [['ちち', 'おとうさん'], ['はは', 'おかあさん'], ['ありがとう', 'ありがとうございます'], ['うち', 'いえ'], ['そして', 'それから'], ['なまえ', 'おなまえ']]) {
    const left = bySurface(a!) ?? { ...bySurface('なまえ'), id: a!, surface: a!, kana: a!, meaningRu: a! };
    const right = bySurface(b!) ?? { ...left, id: b!, surface: b!, kana: b!, meaningRu: b! };
    expect(confusableLearningWords(left, right)).toBe(true);
  }
  const word = bySurface('ねこ');
  expect(confusableLearningWords({ ...word, id: 'father', surface: '父', kana: 'ちち', meaningRu: 'мой отец' }, { ...word, id: 'polite-father', surface: 'お父さん', kana: 'おとうさん', meaningRu: 'отец (уважительно)' })).toBe(true);
  expect(confusableLearningWords(word, { ...word, id: 'another', surface: '猫', kana: 'ネコ' })).toBe(true);
  expect(confusableLearningWords(word, { ...word, id: 'another', surface: '違う', kana: 'ちがう', meaningRu: 'кошка' })).toBe(true);
});
