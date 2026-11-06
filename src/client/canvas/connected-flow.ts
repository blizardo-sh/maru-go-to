import { api, ApiRequestError, json, pendingReviews, submitReview } from '@app/client/api';
import { recallDraftKey, readRecallDraft, writeRecallDraft, learningConflict, invalidLearningChoice, learningHeaders, pendingLearning, submitLearning } from '@app/client/guidedApi';
import { learningParts, type LearningAdvance, type LearningState } from '@app/shared/learning';
import type { AnalysisResult, Course, Progress } from '@app/shared/types';
import { matchesPreparedAnswer } from '@app/shared/answers';
import { confirmedStages } from './lesson-overview';
export type LessonTicket = { stepId: string; revision: number };

// Presentation data comes only from the publication that issued the current step.
export function presentation(course: Course) {
  const forms = new Map(course.forms.map(form => [form.id, form]));
  return {
    lessons: (course.learning ?? []).map(route => ({ ...course.lessons.find(lesson => lesson.id === route.lessonId)!, route })),
    words: course.words,
    constructions: (course.learning ?? []).flatMap(route => route.goals.flatMap(goal => goal.parts.flatMap(part => {
      if (!part.construction) return [];
      const intro = part.construction, exercise = course.exercises.find(value => value.id === intro.exerciseId);
      if (!exercise) throw new Error('В опубликованном уроке нет конструкции.');
      const tokens = exercise.tokens.map(token => {
        const form = forms.get(token.formId);
        if (!form) throw new Error('В опубликованном уроке нет формы слова.');
        return { id: token.id, surface: form.surface, kana: form.kana, identity: JSON.stringify([form.wordId, form.surface, form.kana]) };
      });
      return [{ ...intro, promptRu: exercise.promptRu, tokens, sentenceEnd: exercise.sentenceEnd,
        acceptedOrders: exercise.acceptedOrders.map(order => order.map(id => tokens.findIndex(token => token.id === id))) }];
    }))),
  };
}
export const liveCatalog: ReturnType<typeof presentation> = { lessons: [], words: [], constructions: [] };
type User = { id: string; name: string; email: string; isAdmin: boolean; emailVerified?: boolean };

export class ConnectedFlow {
  selectedId: string | null = null;
  active = false;
  user: User | null = null;
  busy = false;
  error = '';
  checkFeedback = '';
  feedback: { attemptId: string; kind: 'good' | 'again' } | null = null;
  course: Course | null = null;
  introducedWordIds = new Set<string>();
  updateProgress(lessons: LearningState[], wordIds: string[]) { this.states = new Map(lessons.map(state => [state.lessonId, state])); this.introducedWordIds = new Set(wordIds); }
  private states = new Map<string, LearningState>();
  private displayed: LearningState | null = null;
  private held: LearningState | null = null;
  private nextCourse: Course | null = null;
  private generation = 0;
  private introIndex = 0;
  private revision = 0;
  constructor(private changed: () => void) {}
  get lesson() { return liveCatalog.lessons.find(lesson => lesson.id === this.selectedId); }
  get route() { return this.lesson?.route; }
  get parts() { return this.route ? learningParts(this.route) : []; }
  get state() { return this.displayed; }
  get recall() { return !!this.displayed?.recallPolicy && (this.step?.kind === 'word-practice' || this.step?.kind === 'construction-practice'); }
  private get draftKey() { return recallDraftKey(this.user!.id, this.displayed!); }
  get draft() { return this.recall ? readRecallDraft(this.draftKey) : { helped: false, revealed: false }; }
  reveal() { if (this.recall && !this.busy) { writeRecallDraft(this.draftKey, { revealed: true }); this.changed(); } }
  hint() { if (this.recall && !this.busy) { writeRecallDraft(this.draftKey, { helped: true }); this.changed(); } }
  chooseRecall(id: string) {
    if (!this.recall || this.busy || !this.draft.helped || !this.choices.some(word => word.id === id)) return;
    writeRecallDraft(this.draftKey, { firstChoiceWordId: id, revealed: id === this.word?.id }); this.changed();
    return id === this.word?.id;
  }
  revise() { this.revision++; }
  saveDraft(tokenIds: string[]) { this.revise(); if (this.recall) writeRecallDraft(this.draftKey, { tokenIds }); }
  get step() { return this.displayed?.step ?? null; }
  get session() { return this.displayed ? { state: { partIndex: this.displayed.partIndex }, introIndex: this.introIndex, revision: this.revision, attempts: 0, again: 0 } : undefined; }
  get part() { return this.route?.goals.flatMap(goal => goal.parts).find(part => part.id === this.step?.partId); }
  get goal() { return this.route?.goals.find(goal => goal.id === this.step?.goalId); }
  get introduction() { return this.part?.words[this.introIndex]; }
  get word() {
    const step = this.step;
    const id = step?.kind === 'word-intro' ? this.introduction?.wordId : step?.kind === 'word-practice' ? step.wordId : null;
    const word = liveCatalog.words.find(word => word.id === id);
    if (word) return { ...word, introduction: step?.kind === 'word-intro' ? this.introduction : null };
    const construction = this.construction;
    return construction ? { id: construction.exerciseId, ...construction.example, introduction: null } : null;
  }
  get choices() { return (this.displayed?.wordChoices ?? []).map(id => { const word = liveCatalog.words.find(word => word.id === id); if (!word) throw new Error('Вариант ответа отсутствует в версии учебника.'); return word; }); }
  get counter() { const item = this.displayed?.reviewItem; return item?.mode === 'counter' ? item.counter : null; }
  get construction() { const step = this.step; return step?.kind === 'construction-intro' || step?.kind === 'construction-practice' ? liveCatalog.constructions.find(value => value.exerciseId === step.exerciseId) : undefined; }
  get video() { const step = this.step; return step?.kind === 'video' ? this.lesson?.videos?.find(video => video.id === step.videoId) : undefined; }
  private async courseFor(id?: string) {
    if (!this.course || id && this.course.publicationId !== id) return api<Course>('/api/course', { headers: learningHeaders(this.user!.id, id) });
    return this.course;
  }
  private useCourse(course: Course) { this.course = course; Object.assign(liveCatalog, presentation(course)); }
  private async job<T>(run: (epoch: number) => Promise<T>, revision?: number) {
    if (this.busy) return;
    const epoch = this.generation; this.busy = true; this.error = ''; this.changed();
    try { return await run(epoch); }
    catch (error) { if (epoch === this.generation && (revision === undefined || revision === this.revision)) this.error = error instanceof Error ? error.message : 'Не удалось сохранить ответ. Повторите сохранение.'; }
    finally { if (epoch === this.generation) { this.busy = false; this.changed(); } }
  }
  private forgetAccount() {
    this.user = null; this.course = null; this.active = false; this.displayed = null; this.held = null; this.nextCourse = null; this.selectedId = null; this.feedback = null; this.checkFeedback = ''; this.states.clear(); this.introducedWordIds.clear(); this.revision++;
    Object.assign(liveCatalog, { lessons: [], words: [], constructions: [] });
  }
  async boot() {
    return this.job(async epoch => {
      let user: User;
      try { user = await api<User>('/api/me'); }
      catch (error) { if (error instanceof ApiRequestError && error.status === 401) { if (epoch === this.generation) this.forgetAccount(); return; } throw error; }
      const course = await api<Course>('/api/course', { headers: learningHeaders(user.id) });
      if (epoch !== this.generation) return;
      if (this.user && this.user.id !== user.id) this.forgetAccount();
      this.user = user; this.useCourse(course);
      for (const item of pendingReviews(user.id)) { if (epoch !== this.generation) return; await submitReview(user.id, item); }
      // Re-deliver the original immutable payload, including old-client outboxes.
      for (const item of pendingLearning(user.id)) {
        if (epoch !== this.generation) return;
        try { await submitLearning(user.id, item); }
        catch (error) { if (!learningConflict(error) && !invalidLearningChoice(error)) throw error; }
      }
      const [overview, progress] = await Promise.all([api<{ lessons: LearningState[] }>('/api/learning', { headers: learningHeaders(user.id, course.publicationId) }), api<Progress>('/api/progress', { headers: learningHeaders(user.id, course.publicationId) })]);
      if (epoch !== this.generation) return;
      this.user = user; this.useCourse(course); this.introducedWordIds = new Set(progress.introducedWordIds); this.states = new Map(overview.lessons.map(state => [state.lessonId, state]));
      return true;
    });
  }
  async signIn(email: string, password: string) {
    if (!email || !password) { this.error = 'Введите почту и пароль.'; this.changed(); return; }
    const ok = await this.job(async () => { await api('/api/auth/sign-in/email', json('POST', { email, password })); return true; });
    if (ok) return this.boot();
  }
  async logout() {
    ++this.generation; this.busy = false; this.forgetAccount();
    await this.job(async () => { await api('/api/auth/sign-out', json('POST', {})); });
  }
  async refresh() {
    if (this.busy) return;
    const id = this.selectedId, active = this.active, owner = this.user?.id;
    await this.boot();
    if (id && this.user?.id === owner && this.user && !this.error) { await this.open(id); if (active && !this.error) this.start(); }
  }
  async open(id: string) {
    return this.job(async epoch => {
      const state = await api<LearningState>(`/api/learning/${encodeURIComponent(id)}`, { headers: learningHeaders(this.user!.id) });
      if (epoch !== this.generation) return false;
      const course = await this.courseFor(state.publicationId);
      if (epoch !== this.generation) return false;
      this.useCourse(course); this.selectedId = id; this.active = false; this.displayed = state; this.held = null; this.nextCourse = null;
      this.states.set(id, state);
      const step = this.step; this.introIndex = step?.kind === 'word-intro' ? Math.max(0, this.part!.words.findIndex(word => word.wordId === step.wordId)) : 0;
      this.revision++; return true;
    });
  }
  start(_restart = false) { this.active = true; }
  ticket(): LessonTicket { return { stepId: this.step?.id ?? '', revision: this.revision }; }
  private accepts(ticket: LessonTicket) { return !!this.user && this.active && ticket.stepId === this.step?.id && ticket.revision === this.revision; }
  introduce(ticket: LessonTicket, delta: number) {
    if (!this.accepts(ticket) || !this.part || this.busy) return false;
    this.introIndex = Math.max(0, Math.min(this.part.words.length - 1, this.introIndex + delta)); this.revision++; return true;
  }
  private async send(action: LearningAdvance['action'], details: Partial<LearningAdvance> = {}) {
    const state = this.displayed!, owner = this.user!.id;
    return this.job(async epoch => {
      const queue = pendingLearning(owner);
      if (queue.length) {
        for (const item of queue) await submitLearning(owner, item);
        throw new Error('Сохранён первоначальный ответ с этого устройства. Загрузите текущее состояние урока перед новым ответом.');
      }
      const pending = { lessonId: state.lessonId, submission: { attemptId: crypto.randomUUID(), publicationId: state.publicationId,
        routeVersion: state.routeVersion, stateVersion: state.version, stepId: state.step!.id, action, ...details } };
      const result = await submitLearning(owner, pending);
      if (epoch !== this.generation || owner !== this.user?.id) return;
      const course = await this.courseFor(result.state.publicationId);
      if (epoch !== this.generation || owner !== this.user?.id) return;
      // Keep this publication/question visible until the learner finishes the local correction.
      this.held = result.state; this.nextCourse = course;
      if (result.reviewResult) this.feedback = { attemptId: result.attemptId, kind: result.reviewResult.correct === false || action === 'again' ? 'again' : 'good' };
      return { result, course };
    });
  }
  async choose(id: string) {
    if (this.busy || this.step?.kind !== 'word-practice') return;
    if (this.held) return id === this.step.wordId;
    const saved = await this.send('choose', { choiceWordId: id });
    return saved ? saved.result.reviewResult?.correct === true : undefined;
  }
  get counterNeedsIntro() { return !!this.counter?.introduction && this.displayed?.reviewItem?.preparation?.introduced === false; }
  async introduceCounter() {
    const owner = this.user!.id, state = this.displayed!;
    return this.job(async epoch => {
      await api('/api/training/introduce', { ...json('POST', { reviewIds: [state.reviewItem!.id], stage: 'learning', publicationId: state.publicationId }), headers: learningHeaders(owner, state.publicationId) });
      if (epoch === this.generation && owner === this.user?.id && this.displayed === state && state.reviewItem?.preparation) state.reviewItem.preparation.introduced = true;
    });
  }
  async chooseCounter(key: string, helped = false) {
    if (this.busy || !this.counter) return;
    if (this.held) return this.counter.acceptedKeys.includes(key);
    const card = this.counter;
    const saved = await this.send('choose', { counterChoice: key, ...(helped ? { helped: true } : {}) });
    return saved ? card.acceptedKeys.includes(key) : undefined;
  }
  async advance(ticket: LessonTicket, action: LearningAdvance['action'], details: Partial<LearningAdvance> = {}) {
    if (!this.accepts(ticket) || this.busy) return false;
    if (this.recall) {
      const draft = this.draft;
      if (!draft.revealed || !['remember', 'again'].includes(action)) return false;
      details = { ...details, recall: { helped: draft.helped, ...(draft.firstChoiceWordId ? { firstChoiceWordId: draft.firstChoiceWordId } : {}), ...(draft.firstTokenIds ? { firstTokenIds: draft.firstTokenIds, ...(draft.firstTokenForms ? { firstTokenForms: draft.firstTokenForms } : {}) } : {}) } };
    }
    const epoch = this.generation, owner = this.user!.id;
    if (!this.held && !await this.send(action, details)) return false;
    if (!this.held || !this.nextCourse) return false;
    if (epoch !== this.generation || owner !== this.user?.id || !this.held) return false;
    this.useCourse(this.nextCourse); this.displayed = this.held; this.states.set(this.selectedId!, this.held); this.held = null; this.nextCourse = null;
    const step = this.step; this.introIndex = step?.kind === 'word-intro' ? Math.max(0, this.part!.words.findIndex(word => word.wordId === step.wordId)) : 0;
    this.revision++; return true;
  }
  async checkConstruction(order: number[], typed?: string) {
    if (!this.displayed?.reviewItem || !this.construction) return false;
    this.checkFeedback = '';
    if (typed !== undefined) {
      const revision = this.revision, owner = this.user!.id;
      const result = await this.job(() => api<AnalysisResult>('/api/analyze', {
        ...json('POST', { text: typed, revision: this.revision, exerciseId: this.construction!.exerciseId, lessonId: this.selectedId,
          wordIds: [...new Set(this.course!.forms.filter(form => this.course!.exercises.find(exercise => exercise.id === this.construction!.exerciseId)!.tokens.some(token => token.formId === form.id)).map(form => form.wordId))], publicationId: this.displayed!.publicationId }),
        headers: learningHeaders(this.user!.id, this.displayed!.publicationId) }), revision);
      if (revision !== this.revision || owner !== this.user?.id) return null;
      this.checkFeedback = result?.status === 'ok' ? `${result.translationRu}. ${result.explanationRu} Свободный ввод не оценивает исходный навык.` : result?.status === 'unavailable' ? result.reason : 'Анализ сейчас недоступен.';
      return null;
    }
    const revision = this.revision, owner = this.user!.id;
    const tokenIds = order.map(index => this.construction!.tokens[index]!.id);
    const exercise = this.course!.exercises.find(value => value.id === this.construction!.exerciseId)!;
    if (this.held) return matchesPreparedAnswer(exercise, this.course!.forms, tokenIds);
    const result = await this.job(() => api<{ outcome: string; feedback: string }>('/api/reviews/evaluate', {
      ...json('POST', { reviewId: this.displayed!.reviewItem!.id, version: this.displayed!.reviewItem!.version, tokenIds, revision, publicationId: this.displayed!.publicationId }),
      headers: learningHeaders(owner, this.displayed!.publicationId) }), revision);
    if (revision !== this.revision || owner !== this.user?.id || !result) return null;
    if (!['correct', 'incorrect'].includes(result.outcome)) { this.checkFeedback = result.feedback; return null; }
    if (this.recall) {
      writeRecallDraft(this.draftKey, { firstTokenIds: tokenIds, tokenIds, revealed: result.outcome === 'correct' });
      this.changed(); return result.outcome === 'correct';
    }
    const saved = await this.send(result.outcome === 'correct' ? 'remember' : 'again', { tokenIds });
    return saved ? result.outcome === 'correct' : null;
  }
  progress(id = this.selectedId) {
    const state = id ? this.states.get(id) : undefined;
    const total = state?.totalSteps ?? 0, completed = state?.completedSteps ?? 0;
    return { completed, total, finished: state?.completed ?? false, started: (state?.version ?? 0) > 0, percent: total ? Math.floor(completed / total * 100) : 0 };
  }
  lessonStages(id: string) {
    const route = liveCatalog.lessons.find(lesson => lesson.id === id)?.route;
    const parts = route ? learningParts(route).map(steps => ({ partId: steps[0]!.partId, totalSteps: steps.length })) : [];
    return confirmedStages(parts, this.states.get(id));
  }
  snapshot() { return { active: this.active, lessonId: this.selectedId, progress: this.progress(), step: this.step, ticket: this.ticket(),
    introIndex: this.introIndex, partIndex: this.displayed?.partIndex ?? 0, totalParts: this.parts.length, wordId: this.word?.id,
    choiceIds: this.choices.map(word => word.id), publicationId: this.displayed?.publicationId, version: this.displayed?.version,
    recallPolicy: this.displayed?.recallPolicy, confirmedNext: !!this.held, busy: this.busy, error: this.error, authenticated: !!this.user };
  }
}
