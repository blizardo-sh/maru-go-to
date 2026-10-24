import type { Course, Exercise, ReviewItem, ReviewResult, Segment, Skill, Word, WordForm } from './types';

export interface LearningExample {
  surface: string;
  kana: string;
  meaningRu: string;
  segments: Segment[];
  audioUrl: string;
  /** Reviewed whole-phrase pronunciation for offline recording; display spelling stays unchanged. */
  audioText?: string;
}
export const learningAudioTextPattern = /^[\u3041-\u30ffー\s・、。？！!?…]+$/u;
export interface LearningWord {
  wordId: string;
  explanationRu: string;
  example: LearningExample;
}
export interface LearningConstruction {
  exerciseId: string;
  explanationRu: string;
  example: LearningExample;
  breakdown: { text: string; explanationRu: string }[];
}
export interface LearningPart {
  id: string;
  words: LearningWord[];
  construction?: LearningConstruction;
}
export interface LearningGoal {
  id: string;
  titleRu: string;
  introductionRu?: string;
  canDoIds: number[];
  parts: LearningPart[];
  videoIds?: string[];
}
export interface GuidedLesson {
  lessonId: string;
  version: string;
  titleRu: string;
  goals: LearningGoal[];
  authored?: { words: Word[]; forms: WordForm[]; skills: Skill[]; exercises: Exercise[] };
}
interface StepBase { id: string; partId: string; goalId: string }
export type LearningStep = StepBase & (
  | { kind: 'word-intro'; wordId: string }
  | { kind: 'word-practice'; wordId: string; mode: 'ja-ru' | 'listening' | 'ru-ja' }
  | { kind: 'construction-intro'; exerciseId: string }
  | { kind: 'construction-practice'; exerciseId: string; mode: 'ja-ru' | 'listening' | 'grammar' }
  | { kind: 'video'; videoId: string }
  | { kind: 'part-complete' }
);
export interface LearningRouteState {
  partIndex: number;
  pendingStepIds: string[];
  completedStepIds: string[];
  wordQuiz?: boolean;
}
export interface LearningState {
  lessonId: string;
  routeVersion: string;
  version: number;
  partIndex: number;
  totalParts: number;
  completedSteps: number;
  totalSteps: number;
  completed: boolean;
  step: LearningStep | null;
  reviewItem?: ReviewItem;
  wordChoices?: string[];
}
export interface LearningAdvance {
  attemptId: string;
  routeVersion: string;
  stateVersion: number;
  stepId: string;
  action: 'continue' | 'remember' | 'again' | 'skip' | 'start-practice' | 'choose';
  choiceWordId?: string;
  tokenIds?: string[];
  tokenForms?: Record<string, string>;
  revealed?: boolean;
  exploring?: boolean;
}
export interface LearningAdvanceResult {
  attemptId: string;
  state: LearningState;
  reviewResult?: ReviewResult;
}
export type LearningCourse = Course & { learning: GuidedLesson[] };

export function learningParts(lesson: GuidedLesson): LearningStep[][] {
  return lesson.goals.flatMap(goal => goal.parts.map((part, index) => {
    const base = { partId: part.id, goalId: goal.id };
    const steps: LearningStep[] = part.words.map(word => ({ ...base, id: `${part.id}:intro:${word.wordId}`, kind: 'word-intro', wordId: word.wordId }));
    for (const word of part.words) {
      for (const mode of ['ja-ru', 'listening', 'ru-ja'] as const) steps.push({ ...base, id: `${part.id}:${mode}:${word.wordId}`, kind: 'word-practice', wordId: word.wordId, mode });
    }
    if (part.construction) {
      const exerciseId = part.construction.exerciseId;
      steps.push({ ...base, id: `${part.id}:intro:${exerciseId}`, kind: 'construction-intro', exerciseId });
      for (const mode of ['ja-ru', 'listening', 'grammar'] as const) steps.push({ ...base, id: `${part.id}:${mode}:${exerciseId}`, kind: 'construction-practice', exerciseId, mode });
    }
    if (index === goal.parts.length - 1) for (const videoId of goal.videoIds ?? []) steps.push({ ...base, id: `${part.id}:video:${videoId}`, kind: 'video', videoId });
    steps.push({ ...base, id: `${part.id}:complete`, kind: 'part-complete' });
    return steps;
  }));
}
export function initialLearningState(lesson: GuidedLesson): LearningRouteState {
  return { partIndex: 0, pendingStepIds: learningParts(lesson)[0]!.map(step => step.id), completedStepIds: [] };
}
// Definitions/IDs stay unchanged: only a newly started group's pending order changes.
export function mixedWordPractice(steps: LearningStep[]): LearningStep[] {
  const words = [...new Set(steps.filter(step => step.kind === 'word-practice').map(step => step.wordId))];
  const result: LearningStep[] = [];
  for (let round = 0; round < 3; round++) for (const [index, wordId] of words.entries()) {
    const mode = (['ja-ru', 'listening', 'ru-ja'] as const)[(index + round) % 3]!;
    const step = steps.find(item => item.kind === 'word-practice' && item.wordId === wordId && item.mode === mode);
    if (step) result.push(step);
  }
  return result;
}
export function startLearningPractice(lesson: GuidedLesson, state: LearningRouteState): LearningRouteState {
  const definitions = learningParts(lesson)[state.partIndex]!;
  if (currentLearningStep(lesson, state)?.kind !== 'word-intro') throw new Error('Group introduction is not current.');
  const next = structuredClone(state);
  while (definitions.find(step => step.id === next.pendingStepIds[0])?.kind === 'word-intro') {
    const id = next.pendingStepIds.shift()!;
    if (!next.completedStepIds.includes(id)) next.completedStepIds.push(id);
  }
  const practices = definitions.filter(step => step.kind === 'word-practice' && next.pendingStepIds.includes(step.id));
  next.pendingStepIds = [...mixedWordPractice(practices).map(step => step.id), ...next.pendingStepIds.filter(id => !practices.some(step => step.id === id))];
  next.wordQuiz = true;
  return next;
}
export function currentLearningStep(lesson: GuidedLesson, state: LearningRouteState): LearningStep | null {
  return learningParts(lesson)[state.partIndex]?.find(step => step.id === state.pendingStepIds[0]) ?? null;
}
// Video-only additions do not reopen past parts or move an already pending answer.
// Completing an optional video means continuing OR skipping it, not proof of watching.
export function reconcileOptionalVideos(lesson: GuidedLesson, state: LearningRouteState): LearningRouteState {
  const parts = learningParts(lesson);
  const next = structuredClone(state);
  const skipAdded = (steps: LearningStep[]) => {
    for (const step of steps) if (step.kind === 'video' && !next.completedStepIds.includes(step.id)) next.completedStepIds.push(step.id);
  };
  for (const part of parts.slice(0, state.partIndex)) skipAdded(part);
  const current = parts[state.partIndex];
  if (!current) return next;
  const step = current.find(item => item.id === state.pendingStepIds[0]);
  const additions = current.filter(item => item.kind === 'video' && !next.pendingStepIds.includes(item.id) && !next.completedStepIds.includes(item.id));
  if (step?.kind === 'part-complete') skipAdded(additions);
  else {
    const boundary = next.pendingStepIds.findIndex(id => current.some(item => item.id === id && item.kind === 'part-complete'));
    if (boundary >= 0) next.pendingStepIds.splice(boundary, 0, ...additions.map(item => item.id));
  }
  return next;
}
export function advanceLearningState(lesson: GuidedLesson, state: LearningRouteState, action: LearningAdvance['action']): LearningRouteState {
  if (action === 'start-practice') return startLearningPractice(lesson, state);
  const step = currentLearningStep(lesson, state);
  if (!step) throw new Error('Learning route is complete.');
  const practice = step.kind === 'word-practice' || step.kind === 'construction-practice';
  if (practice ? !['remember', 'again'].includes(action) : step.kind === 'video' ? !['continue', 'skip'].includes(action) : action !== 'continue') throw new Error('Action does not match learning step.');
  const next = structuredClone(state);
  next.pendingStepIds.shift();
  if (action === 'again') {
    // The part summary stays last, even when the same difficult format returns many times.
    const definitions = learningParts(lesson)[state.partIndex]!;
    const boundary = next.pendingStepIds.findIndex(id => definitions.some(item => item.id === id && (item.kind === 'video' || item.kind === 'part-complete')));
    next.pendingStepIds.splice(boundary < 0 ? next.pendingStepIds.length : boundary, 0, step.id);
  } else if (!next.completedStepIds.includes(step.id)) next.completedStepIds.push(step.id);
  if (step.kind === 'part-complete') {
    next.partIndex++;
    next.pendingStepIds = learningParts(lesson)[next.partIndex]?.map(item => item.id) ?? [];
    delete next.wordQuiz;
  }
  return next;
}

export function validateLearning(course: Course, lessons: GuidedLesson[], complete = false): void {
  const ensure = (ok: unknown, message: string): void => { if (!ok) throw new Error(`Invalid learning material: ${message}`); };
  ensure(new Set(lessons.map(lesson => lesson.lessonId)).size === lessons.length, 'duplicate lesson');
  if (complete) ensure(lessons.length === 18 && course.lessons.every(lesson => lessons.some(route => route.lessonId === lesson.id)), 'all 18 lessons required');
  const audio = (value: string) => /^\/audio\/[a-z0-9][a-z0-9/_.-]*\.(m4a|mp3|ogg|wav)$/i.test(value) && !value.split('/').some(segment => segment === '..' || segment === '.');
  const text = (value: unknown) => typeof value === 'string' && value.trim().length > 0;
  const example = (value: LearningExample, id: string) => {
    ensure(text(value.surface) && text(value.kana) && text(value.meaningRu), `example text ${id}`);
    ensure(value.segments?.map(segment => segment.surface).join('') === value.surface && value.segments.map(segment => segment.reading ?? segment.surface).join('') === value.kana, `example reading ${id}`);
    ensure(/^[ぁ-ゖァ-ヺー・\s。、！？!?「」『』（）()…,.\d]+$/u.test(value.kana), `example Japanese reading ${id}`);
    ensure(audio(value.audioUrl), `example audio ${id}`);
    ensure(value.audioText === undefined || (typeof value.audioText === 'string' && value.audioText.length > 0 && value.audioText.length <= 300 && value.audioText === value.audioText.trim() && learningAudioTextPattern.test(value.audioText)), `example pronunciation ${id}`);
  };
  const officialSource = (entry: { sourceRefs: Word['sourceRefs'] }) => entry.sourceRefs?.length && entry.sourceRefs.every(source => {
    try { const url = new URL(source.url); return url.protocol === 'https:' && ['marugoto.jpf.go.jp', 'marugotoweb.jp', 'a1.marugotoweb.jp', 'a2.marugotoweb.jp', 'www.irodori.jpf.go.jp', 'www.hirogaru-nihongo.jpf.go.jp'].includes(url.hostname); } catch { return false; }
  });
  for (const route of lessons) {
    const lesson = course.lessons.find(item => item.id === route.lessonId);
    ensure(lesson && text(route.version) && text(route.titleRu) && route.goals.length, `lesson ${route.lessonId}`);
    const goalIds = new Set<string>(); const partIds = new Set<string>(); const words = new Set<string>(); const videos = new Set<string>();
    for (const goal of route.goals) {
      ensure(text(goal.id) && !goalIds.has(goal.id) && text(goal.titleRu) && goal.parts.length, `goal ${goal.id}`); goalIds.add(goal.id);
      ensure(goal.introductionRu === undefined || text(goal.introductionRu), `goal context ${goal.id}`);
      ensure(goal.canDoIds.length && goal.canDoIds.every(id => lesson!.canDoIds.includes(id)), `goal Can-do ${goal.id}`);
      for (const part of goal.parts) {
        ensure(text(part.id) && !partIds.has(part.id) && part.words.length <= 5 && (part.words.length || part.construction), `part ${part.id}`); partIds.add(part.id);
        for (const introduction of part.words) {
          const word = course.words.find(item => item.id === introduction.wordId);
          ensure(word && word.lessonIds.includes(route.lessonId) && word.reviewStatus !== 'draft' && officialSource(word), `word scope or readiness ${introduction.wordId}`);
          ensure(!words.has(introduction.wordId), `duplicate core word ${introduction.wordId}`); words.add(introduction.wordId);
          ensure(audio(word!.audioUrl ?? '') && text(introduction.explanationRu), `word introduction ${introduction.wordId}`);
          example(introduction.example, introduction.wordId);
        }
        if (part.construction) {
          const construction = part.construction;
          const exercise = course.exercises.find(item => item.id === construction.exerciseId);
          const skill = course.skills.find(item => item.id === exercise?.skillId);
          ensure(exercise?.lessonId === route.lessonId && exercise.reviewStatus !== 'draft' && skill && skill.reviewStatus !== 'draft' && skill.lessonIds.includes(route.lessonId) && officialSource(skill), `construction scope or readiness ${construction.exerciseId}`);
          ensure(text(construction.explanationRu) && construction.breakdown.length && construction.breakdown.every(piece => text(piece.text) && text(piece.explanationRu)), `construction explanation ${construction.exerciseId}`);
          example(construction.example, construction.exerciseId);
          const formMap = new Map(course.forms.map(form => [form.id, form])); const tokenMap = new Map(exercise!.tokens.map(token => [token.id, token]));
          const fullOrder = exercise!.acceptedOrders.find(order => order.length === exercise!.tokens.length)!;
          const sentence = fullOrder.map(id => formMap.get(tokenMap.get(id)!.formId)!.surface).join('') + exercise!.sentenceEnd;
          ensure(sentence === construction.example.surface, `construction full example ${construction.exerciseId}`);
          ensure(exercise!.tokens.every(token => formMap.get(token.formId)?.reviewStatus !== 'draft'), `construction forms readiness ${construction.exerciseId}`);
        }
      }
      for (const id of goal.videoIds ?? []) {
        const video = lesson?.videos?.find(item => item.id === id);
        // Preserve the real L4 video step's saved part-prefixed ID from the pilot.
        const legacyFamilyVideo = route.lessonId === 'marugoto.starter-a1.lesson.04' && goal.id === 'l04-family-photo' && id === route.lessonId && video?.canDoId === 7 && video.variant === 'practice' && video.sourceUrl === 'https://a1.marugotoweb.jp/en/can-do7.php' && video.mediaUrl === 'https://a1.marugotoweb.jp/en/assets/movies/topics/cando_07_01.mp4';
        ensure(video && (goal.canDoIds.includes(video.canDoId) || legacyFamilyVideo) && !videos.has(id), `video scope ${id}`); videos.add(id);
      }
    }
    for (const [kind, entries] of Object.entries(route.authored ?? {})) for (const entry of entries) {
      ensure(entry.reviewStatus !== 'draft', `authored readiness ${entry.id}`);
      if (kind !== 'exercises') ensure(officialSource(entry as Word), `authored provenance ${entry.id}`);
    }
    const steps = learningParts(route).flat();
    ensure(new Set(steps.map(step => step.id)).size === steps.length, `step ids ${route.lessonId}`);
  }
}
