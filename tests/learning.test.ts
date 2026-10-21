import { expect, test } from 'bun:test';
import { advanceLearningState, currentLearningStep, initialLearningState, learningParts, validateLearning } from '../src/shared/learning';
import { withLearningMaterial } from '../src/server/course';
import { learningFixture } from './helpers/learning-fixture';

test('a guided part introduces the whole group then explicitly practices every word and full construction in three formats', () => {
  const course = learningFixture(); const route = course.learning[0]!;
  validateLearning(course, course.learning);
  const parts = learningParts(route); const first = parts[0]!;
  expect(first.slice(0, 2).map(step => step.kind)).toEqual(['word-intro', 'word-intro']);
  expect(first.slice(2, 8).map(step => step.kind === 'word-practice' && step.mode)).toEqual(['ja-ru', 'listening', 'ru-ja', 'ja-ru', 'listening', 'ru-ja']);
  for (const word of route.goals[0]!.parts[0]!.words) {
    expect(first.filter(step => step.kind === 'word-practice' && step.wordId === word.wordId).map(step => step.kind === 'word-practice' && step.mode)).toEqual(['ja-ru', 'listening', 'ru-ja']);
  }
  expect(first.filter(step => step.kind === 'construction-practice').map(step => step.kind === 'construction-practice' && step.mode)).toEqual(['ja-ru', 'listening', 'grammar']);
  expect(first.findIndex(step => step.kind === 'construction-intro')).toBeGreaterThan(first.map(step => step.kind).lastIndexOf('word-practice'));
  expect(first.findIndex(step => step.kind === 'video')).toBeGreaterThan(first.map(step => step.kind).lastIndexOf('construction-practice'));
  expect(first.at(-1)?.kind).toBe('part-complete');
  expect(parts[1]!.some(step => step.kind === 'video')).toBe(false);
});

test('Again returns without a retry cap before the optional video and completion; only Remember completes that format', () => {
  const route = learningFixture().learning[0]!; let state = initialLearningState(route);
  state = advanceLearningState(route, state, 'continue'); state = advanceLearningState(route, state, 'continue');
  const difficult = currentLearningStep(route, state)!;
  expect(difficult.kind).toBe('word-practice');
  for (let attempt = 0; attempt < 7; attempt++) {
    state = advanceLearningState(route, state, 'again');
    expect(state.completedStepIds).not.toContain(difficult.id);
    while (currentLearningStep(route, state)?.id !== difficult.id) {
      const step = currentLearningStep(route, state)!;
      expect(['video', 'part-complete']).not.toContain(step.kind);
      state = advanceLearningState(route, state, step.kind === 'word-practice' || step.kind === 'construction-practice' ? 'remember' : 'continue');
    }
  }
  state = advanceLearningState(route, state, 'remember');
  expect(state.completedStepIds).toContain(difficult.id);
  expect(currentLearningStep(route, state)?.kind).toBe('video');
  state = advanceLearningState(route, state, 'skip');
  state = advanceLearningState(route, state, 'continue');
  expect(state.partIndex).toBe(1);
  while (currentLearningStep(route, state)) {
    const step = currentLearningStep(route, state)!;
    state = advanceLearningState(route, state, step.kind === 'word-practice' ? 'remember' : 'continue');
  }
  expect(state.partIndex).toBe(2);
  expect(state.completedStepIds).toHaveLength(learningParts(route).flat().length);
});

test('learning validation rejects scope gaps, unready content, unsafe audio and incorrect whole-phrase examples', () => {
  for (const mutate of [
    (course: ReturnType<typeof learningFixture>) => { course.learning[0]!.goals[0]!.parts[0]!.words[0]!.wordId = course.words.find(word => !word.lessonIds.includes(course.learning[0]!.lessonId))!.id; },
    (course: ReturnType<typeof learningFixture>) => { course.words.find(word => word.id === course.learning[0]!.goals[0]!.parts[0]!.words[0]!.wordId)!.reviewStatus = 'draft'; },
    (course: ReturnType<typeof learningFixture>) => { course.learning[0]!.goals[0]!.parts[0]!.words[0]!.example.audioUrl = 'https://another.example/arbitrary.mp3'; },
    (course: ReturnType<typeof learningFixture>) => { course.learning[0]!.goals[0]!.parts[0]!.words[0]!.example.audioUrl = '/audio/../private.wav'; },
    (course: ReturnType<typeof learningFixture>) => { course.learning[0]!.goals[0]!.parts[0]!.construction!.example.surface += '違う'; },
    (course: ReturnType<typeof learningFixture>) => { course.learning[0]!.goals[0]!.parts[0]!.words.push(...course.learning[0]!.goals[0]!.parts[0]!.words, ...course.learning[0]!.goals[0]!.parts[0]!.words); },
    (course: ReturnType<typeof learningFixture>) => { course.learning[0]!.goals[0]!.canDoIds = [50]; },
    (course: ReturnType<typeof learningFixture>) => { course.learning[0]!.goals[0]!.videoIds = [course.lessons[0]!.id]; },
  ]) {
    const course = learningFixture(); mutate(course);
    expect(() => validateLearning(course, course.learning)).toThrow('Invalid learning');
  }
  const course = learningFixture();
  expect(() => validateLearning(course, course.learning, true)).toThrow('all 18');
  expect(() => advanceLearningState(course.learning[0]!, initialLearningState(course.learning[0]!), 'remember')).toThrow('Action');
});

test('authored overlays preserve stable identities and cannot remove existing shared lesson membership', () => {
  const course = learningFixture(); const route = course.learning[0]!;
  const word = course.words.find(item => item.id === route.goals[0]!.parts[0]!.words[0]!.wordId)!;
  route.authored = { words: [{ ...word, reviewStatus: 'reviewed' }], forms: [], skills: [], exercises: [] };
  const merged = withLearningMaterial(course, [route]);
  expect(merged.words.filter(item => item.id === word.id)).toHaveLength(1);
  expect(merged.words.find(item => item.id === word.id)?.reviewStatus).toBe('reviewed');
  route.authored.words[0]!.lessonIds = ['another-lesson'];
  expect(() => withLearningMaterial(course, [route])).toThrow('scope');
});
