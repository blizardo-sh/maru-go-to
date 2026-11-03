import { expect, test } from 'bun:test';
import { advanceLearningState, currentLearningStep, initialLearningState, learningPartProgress, learningParts, reconcileOptionalVideos, validateLearning } from '../src/shared/learning';
import { withLearningMaterial } from '../src/server/course';
import { learningFixture } from './helpers/learning-fixture';

test('part progress counts saved steps independently, including completed later parts after a content update', () => {
  const parts = learningParts(learningFixture().learning[0]!);
  const progress = learningPartProgress(parts, { completedStepIds: [parts[0]![0]!.id, parts[0]![0]!.id, 'removed-step', ...parts[1]!.map(step => step.id)] });
  expect(progress).toEqual([
    { partId: parts[0]![0]!.partId, completedSteps: 1, totalSteps: parts[0]!.length },
    { partId: parts[1]![0]!.partId, completedSteps: parts[1]!.length, totalSteps: parts[1]!.length },
  ]);
});

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

test('optional video additions preserve the exact current word, retry queue and old video step without changing the route version',()=>{
 const route=learningFixture().learning[0]!;let state=initialLearningState(route);
 state=advanceLearningState(route,state,'continue');state=advanceLearningState(route,state,'continue');
 state=advanceLearningState(route,state,'again');
 const old=structuredClone(state);const current=currentLearningStep(route,state)!;const oldIds=learningParts(route).flat().map(step=>step.id);
 const expanded=structuredClone(route);expanded.goals[0]!.videoIds!.push('new.optional.clip');
 const reconciled=reconcileOptionalVideos(expanded,state);
 expect(state).toEqual(old);expect(currentLearningStep(expanded,reconciled)).toEqual(current);expect(expanded.version).toBe(route.version);
 expect(reconciled.pendingStepIds.filter(id=>oldIds.includes(id))).toEqual(old.pendingStepIds);
 expect(reconciled.pendingStepIds.at(-2)).toBe('fixture-part-1:video:new.optional.clip');
 expect(reconciled.completedStepIds).toEqual(old.completedStepIds);expect(reconcileOptionalVideos(expanded,reconciled)).toEqual(reconciled);
 while(currentLearningStep(route,state)?.kind!=='video'){const step=currentLearningStep(route,state)!;state=advanceLearningState(route,state,step.kind.endsWith('practice')?'remember':'continue');}
 expect(currentLearningStep(expanded,reconcileOptionalVideos(expanded,state))).toEqual(currentLearningStep(route,state));
});

test('new optional clips do not reopen summaries, past parts or completed routes, whose progress stays complete',()=>{
 const route=learningFixture().learning[0]!;let state=initialLearningState(route);
 const next=()=>{const step=currentLearningStep(route,state)!;state=advanceLearningState(route,state,step.kind.endsWith('practice')?'remember':step.kind==='video'?'skip':'continue');};
 while(currentLearningStep(route,state)?.kind!=='part-complete')next();
 const expanded=structuredClone(route);expanded.goals[0]!.videoIds!.push('new.past.clip');expanded.goals[1]!.videoIds=['new.future.clip'];
 const summary=reconcileOptionalVideos(expanded,state);expect(currentLearningStep(expanded,summary)).toEqual(currentLearningStep(route,state));expect(summary.completedStepIds).toContain('fixture-part-1:video:new.past.clip');
 next();const midway=reconcileOptionalVideos(expanded,state);expect(currentLearningStep(expanded,midway)).toEqual(currentLearningStep(route,state));expect(midway.completedStepIds).toContain('fixture-part-1:video:new.past.clip');
 while(currentLearningStep(route,state))next();
 const complete=reconcileOptionalVideos(expanded,state);expect(complete.partIndex).toBe(state.partIndex);expect(complete.pendingStepIds).toEqual([]);expect(currentLearningStep(expanded,complete)).toBeNull();
 expect(complete.completedStepIds).toHaveLength(learningParts(expanded).flat().length);expect(complete.completedStepIds.filter(id=>!id.includes(':video:'))).toEqual(state.completedStepIds.filter(id=>!id.includes(':video:')));
});


test('shared overlay records ignore JSON key order but reject conflicting authored meanings',()=>{
 const course=learningFixture(), first=structuredClone(course.learning[0]!), second=structuredClone(first);
 second.lessonId=course.lessons.find(lesson=>lesson.number===4)!.id;
 const original=course.words.find(word=>word.id===first.goals[0]!.parts[0]!.words[0]!.wordId)!;
 const shared={...original,lessonIds:[...new Set([...original.lessonIds,second.lessonId])]};
 first.authored={words:[shared],forms:[],skills:[],exercises:[]};
 const {id,...fields}=shared;
 second.authored={words:[{...fields,id}],forms:[],skills:[],exercises:[]};
 expect(()=>withLearningMaterial(course,[first,second])).not.toThrow();
 second.authored.words[0]!.meaningRu+=' другой смысл';
 expect(()=>withLearningMaterial(course,[first,second])).toThrow('Conflicting authored records');
});
