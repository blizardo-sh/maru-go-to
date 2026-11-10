import { isVisualWordMode } from '@app/shared/word-cards';
import { api, pendingReviews, submitReview } from '@app/client/api';
import { ReviewSave } from '@app/client/useReviewSave';
import { learningHeaders } from '@app/client/guidedApi';
import { advanceDeck } from '@app/client/study';
import type { Course, Progress, Rating, ReviewItem, ReviewMode, ReviewQueue, ReviewResult, ReviewSubmission, TrainingContext } from '@app/shared/types';
import { reviewWakeDelay } from '@app/client/review-ratings';

type WordItem = Extract<ReviewItem, { mode: import('@app/shared/types').WordMode }>;
export class ReviewFlow<T extends ReviewItem = WordItem> {
  queue: T[] = [];
  course: Course | null = null;
  active = false;
  loading = false;
  error = '';
  completed = 0;
  turn = 0;
  total = 0;
  remainingDue = 0;
  nextDue: string | null = null;
  private wake?: ReturnType<typeof setTimeout>;
  private refreshing = false;
  progress: Progress | null = null;
  last: { attemptId: string; kind: 'good' | 'again' } | null = null;
  choiceResult: { choice: string; correct: boolean; repeat: boolean; result: ReviewResult } | null = null;
  private epoch = 0;
  private owner = '';
  private context?: TrainingContext;
  private mode: ReviewMode | 'mixed' = 'ja-ru';
  private saving?: ReviewSave;
  constructor(private changed: () => void) {}
  get item() { return this.queue[0]; }
  get busy() { return this.loading || this.refreshing || !!this.saving?.busy; }
  get pending() { return !!this.saving?.pending; }
  get saveError() { return this.saving?.error || this.error; }
  async open(owner: string, mode: ReviewMode | 'mixed', context?: TrainingContext) {
    if (this.busy || this.pending) return;
    clearTimeout(this.wake);
    if(context && isVisualWordMode(mode))context={...context,visualWords:true};
    this.owner = owner; this.mode = mode; this.context = context;
    const epoch = ++this.epoch; this.saving && (this.saving.active = false); this.loading = true; this.active = true; this.error = ''; this.changed();
    try {
      for (const pending of pendingReviews(owner)) { if (epoch !== this.epoch) return; await submitReview(owner, pending); }
      const course = await api<Course>('/api/course', { headers: learningHeaders(owner) });
      const query = context ? '/api/training?' + new URLSearchParams(Object.entries(context).map(([key, value]) => [key, String(value)])) : `/api/reviews?mode=${mode}`;
      const headers = learningHeaders(owner, course.publicationId);
      const [queue, progress] = await Promise.all([api<ReviewQueue>(query, { headers }), mode === 'mixed' && !context ? api<Progress>('/api/progress', { headers }) : null]);
      if (epoch !== this.epoch) return;
      this.course = course; this.queue = queue.items.filter(item => mode === 'mixed' || item.mode === mode || !!context && isVisualWordMode(mode) && isVisualWordMode(item.mode)) as T[]; this.nextDue = queue.nextDue ?? null; this.remainingDue = queue.remainingDue; this.progress = progress; this.total = this.queue.length; this.completed = 0; this.turn++; this.last = null;
      this.choiceResult = null;
      this.saving = new ReviewSave(owner, (submission, result) => {
        const repeat = submission.rating === 1 || 'helped' in submission && !!submission.helped || result.correct === false;
        if (submission.mode === 'counter' && submission.choice) {
          // The answer is already saved; Next only releases the visible feedback.
          this.choiceResult = { choice: submission.choice, correct: result.correct === true, repeat, result };
          this.last = { attemptId: result.attemptId, kind: repeat ? 'again' : 'good' };
        } else this.next(repeat, result);
      }, this.changed);
    } catch (error) { if (epoch === this.epoch) this.error = error instanceof Error ? error.message : 'Не удалось загрузить повторение.'; }
    finally { if (epoch === this.epoch) { this.loading = false; this.planWake(); this.changed(); } }
  }
  private planWake(delay?: number) {
    clearTimeout(this.wake);
    if (!this.active || this.choiceResult || this.context || !this.nextDue || typeof document !== 'undefined' && document.hidden) return;
    this.wake = setTimeout(() => void this.refreshDue(), delay ?? reviewWakeDelay(this.nextDue));
    this.wake.unref?.();
  }
  async refreshDue() {
    if (!this.active || this.choiceResult || this.context || !this.course || this.refreshing || typeof document !== 'undefined' && document.hidden) return;
    if (this.busy || this.pending) { this.planWake(1000); return; }
    const epoch = this.epoch, owner = this.owner;
    this.refreshing = true;
    try {
      const fresh = await api<ReviewQueue>(`/api/reviews?mode=${this.mode}`, { headers: learningHeaders(owner, this.course.publicationId) });
      if (epoch !== this.epoch || !this.active) return;
      const key = (item: ReviewItem) => `${item.mode}:${item.targetId}`;
      const items = fresh.items.filter(item => this.mode === 'mixed' || item.mode === this.mode);
      const current = this.item;
      // Preserve the question being answered; refresh its version only between answers.
      const known = new Set(this.queue.map(key));
      const additions = items.filter(item => !known.has(key(item))) as T[];
      this.queue = [...this.queue, ...additions];
      if (!current && this.queue.length) this.turn++;
      this.total += additions.length;
      this.remainingDue = fresh.remainingDue;
      this.nextDue = fresh.nextDue ?? null;
      this.error = '';
    } catch (error) {
      if (epoch === this.epoch) { this.error = error instanceof Error ? error.message : 'Не удалось обновить повторение.'; this.planWake(30_000); }
    } finally {
      this.refreshing = false;
      if (epoch === this.epoch) { if (!this.error) this.planWake(); this.changed(); }
    }
  }
  private next(repeat: boolean, result: ReviewResult) {
    const item = this.item!;
    const repeatNow = repeat && (!!this.context || result.status === 'learning');
    this.queue = advanceDeck(this.queue, repeatNow, result).map(value => value.targetId === item.targetId && value.mode === item.mode ? { ...value, version: result.version, due: result.nextDue, isNew: false } : value) as T[];
    if (!repeatNow || result.status === 'scheduled') this.completed++;
    if (result.status === 'scheduled' || !this.context && result.status === 'additional-practice') {
      this.remainingDue = Math.max(0, this.remainingDue - 1);
      if (!this.nextDue || result.nextDue < this.nextDue) this.nextDue = result.nextDue;
    }
    this.turn++; this.last = { attemptId: result.attemptId, kind: repeat ? 'again' : 'good' };
    this.planWake(!this.queue.length && this.remainingDue > 0 ? 0 : undefined);
  }
  continueChoice() {
    if (!this.active || this.busy || !this.choiceResult) return;
    const { repeat, result } = this.choiceResult;
    this.choiceResult = null; this.next(repeat, result); this.changed();
  }
  grade(owner: string, rating: Rating) {
    const item = this.item; if (owner !== this.owner || !item || ('choices' in item && item.choices?.length) || !this.active || this.busy || this.pending) return;
    if (!['ja-ru', 'ru-ja', 'listening', 'picture-word', 'word-meaning'].includes(item.mode)) return;
    return this.saving?.save({ attemptId: crypto.randomUUID(), reviewId: item.id, version: item.version, mode: item.mode as WordItem['mode'], rating, ...(item.publicationId ? { publicationId: item.publicationId } : {}) });
  }
  choose(id: string) {
    const item = this.item; if (!item || !('choices' in item) || !item.choices?.includes(id) || !this.active || this.busy || this.pending) return;
    return this.saving?.save({ attemptId: crypto.randomUUID(), reviewId: item.id, version: item.version, mode: item.mode as WordItem['mode'], rating: 3, choiceWordId: id, helped: false, ...(item.publicationId ? { publicationId: item.publicationId } : {}) });
  }
  save(value: ReviewSubmission) { if (this.active && !this.busy && !this.pending && !this.choiceResult && value.reviewId === this.item?.id) return this.saving?.save(value); }
  async introduce() { const item = this.item, owner = this.owner, epoch = this.epoch; if (!item || this.busy) return; this.loading = true; this.changed(); try { await api('/api/training/introduce', { method: 'POST', headers: { ...learningHeaders(owner, item.publicationId), 'Content-Type': 'application/json' }, body: JSON.stringify({ reviewIds: [item.id], stage: 'learning', publicationId: item.publicationId }) }); if (epoch === this.epoch) { if (item.preparation) { for(const sibling of this.queue)if(sibling.preparation?.key===item.preparation.key&&sibling.preparation.scope===item.preparation.scope)sibling.preparation.introduced=true; } else if (item.mode === 'counter') item.counter.introduction = false; } } catch (e) { if (epoch === this.epoch) this.error = e instanceof Error ? e.message : 'Не удалось сохранить знакомство.'; } finally { if (epoch === this.epoch) { this.loading = false; this.changed(); } } }
  retry() { return this.pending ? this.saving?.retry() : this.open(this.owner, this.mode, this.context); }
  hide() { clearTimeout(this.wake); this.active = false; this.changed(); }
  clear() { clearTimeout(this.wake); ++this.epoch; if (this.saving) this.saving.active = false; this.saving = undefined; this.queue = []; this.course = null; this.progress = null; this.total = 0; this.remainingDue = 0; this.nextDue = null; this.completed = 0; this.active = false; this.loading = false; this.last = null; this.choiceResult = null; this.error = ''; this.changed(); }
}
