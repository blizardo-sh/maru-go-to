import catalog from './lesson-fixtures.json';
import { advanceLearningState, currentLearningStep, initialLearningState, learningParts, type GuidedLesson, type LearningAdvance, type LearningRouteState } from '../../src/shared/learning';

export const lessonCatalog = catalog;
type Session = { state: LearningRouteState; introIndex: number; revision: number; attempts: number; again: number };
export type LessonTicket = { stepId: string; revision: number };
const wordMap = new Map(catalog.words.map(word => [word.id, word]));
const constructionMap = new Map(catalog.constructions.map(value => [value.exerciseId, value]));

// Read-only course fixtures and the application's pure route reducer; no API, DB or storage.
export class LessonFlow {
  selectedId: string | null = null;
  active = false;
  private sessions = new Map<string, Session>();
  get lesson() { return catalog.lessons.find(lesson => lesson.id === this.selectedId); }
  get route(): GuidedLesson | undefined { return this.lesson?.route; }
  get session() { return this.selectedId ? this.sessions.get(this.selectedId) : undefined; }
  get parts() { return this.route ? learningParts(this.route) : []; }
  get step() { return this.route && this.session ? currentLearningStep(this.route, this.session.state) : null; }
  get part() { return this.route?.goals.flatMap(goal => goal.parts).find(part => part.id === this.step?.partId); }
  get goal() { return this.route?.goals.find(goal => goal.id === this.step?.goalId); }
  get introduction() { return this.part?.words[this.session?.introIndex ?? 0]; }
  get word() {
    const id = this.step?.kind === 'word-intro' ? this.introduction?.wordId : this.step?.kind === 'word-practice' ? this.step.wordId : null;
    const word = id ? wordMap.get(id) : null;
    if (word) return { ...word, introduction: this.step?.kind === 'word-intro' ? this.introduction : null };
    const construction = this.construction;
    return construction ? { id: construction.exerciseId, ...construction.example, introduction: null } : null;
  }
  get choices() {
    const step = this.step;
    if (step?.kind !== 'word-practice' || !this.lesson) return [];
    const options: Record<string, string[] | undefined> = this.lesson.choices;
    return (options[step.id] ?? []).map(id => wordMap.get(id)!);
  }
  get construction() {
    const step = this.step;
    return step?.kind === 'construction-intro' || step?.kind === 'construction-practice' ? constructionMap.get(step.exerciseId) : undefined;
  }
  get video() { const step = this.step; return step?.kind === 'video' ? this.lesson?.videos.find(video => video.id === step.videoId) : undefined; }
  open(id: string) {
    if (!catalog.lessons.some(lesson => lesson.id === id)) throw new Error('Unknown lesson.');
    this.selectedId = id; this.active = false;
  }
  start(restart = false) {
    if (!this.route || !this.selectedId) throw new Error('Select a lesson first.');
    if (restart || !this.session) this.sessions.set(this.selectedId, { state: initialLearningState(this.route), introIndex: 0, revision: 0, attempts: 0, again: 0 });
    this.active = true;
  }
  ticket(): LessonTicket { return { stepId: this.step?.id ?? '', revision: this.session?.revision ?? -1 }; }
  private accepts(ticket: LessonTicket) { return this.active && this.step?.id === ticket.stepId && this.session?.revision === ticket.revision; }
  introduce(ticket: LessonTicket, delta: number) {
    if (!this.accepts(ticket) || this.step?.kind !== 'word-intro' || !this.session || !this.part) return false;
    this.session.introIndex = Math.max(0, Math.min(this.part.words.length - 1, this.session.introIndex + delta));
    this.session.revision++; return true;
  }
  advance(ticket: LessonTicket, action: LearningAdvance['action'], _details: Partial<LearningAdvance> = {}) {
    if (!this.accepts(ticket) || !this.route || !this.session) return false;
    const practice = this.step?.kind === 'word-practice' || this.step?.kind === 'construction-practice';
    const next = advanceLearningState(this.route, this.session.state, action);
    if (practice) { this.session.attempts++; if (action === 'again') this.session.again++; }
    this.session.state = next; this.session.introIndex = 0; this.session.revision++; return true;
  }
  checkConstruction(order: number[], typed?: string) {
    const exercise = this.construction;
    if (!exercise) return false;
    if (typed !== undefined) {
      const normalize = (value: string) => value.normalize('NFKC').replace(/[。\s]/g, '');
      return exercise.acceptedTexts.some(value => normalize(value) === normalize(typed));
    }
    if (new Set(order).size !== order.length || order.some(index => !exercise.tokens[index])) return false;
    const selected = order.map(index => exercise.tokens[index]!.identity);
    return exercise.acceptedIdentities.some(answer => answer.length === selected.length && answer.every((value, index) => value === selected[index]));
  }
  progress(id = this.selectedId) {
    const lesson = catalog.lessons.find(lesson => lesson.id === id), session = id ? this.sessions.get(id) : undefined;
    const total = lesson ? learningParts(lesson.route).flat().length : 0, completed = session?.state.completedStepIds.length ?? 0;
    return { completed, total, finished: total > 0 && completed === total, started: !!session, percent: total ? Math.floor(completed / total * 100) : 0 };
  }
  snapshot() {
    return { active: this.active, lessonId: this.selectedId, progress: this.progress(), step: this.step, ticket: this.ticket(),
      introIndex: this.session?.introIndex ?? 0, partIndex: this.session?.state.partIndex ?? 0,
      totalParts: this.parts.length, wordId: this.word?.id, choiceIds: this.choices.map(word => word.id),
      pending: this.session?.state.pendingStepIds ?? [], completed: this.session?.state.completedStepIds ?? [],
      attempts: this.session?.attempts ?? 0, again: this.session?.again ?? 0 };
  }
}
