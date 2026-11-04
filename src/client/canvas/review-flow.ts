import { api, pendingReviews, submitReview } from '@app/client/api';
import { ReviewSave } from '@app/client/useReviewSave';
import { learningHeaders } from '@app/client/guidedApi';
import { advanceDeck } from '@app/client/study';
import type { Course, Progress, ReviewItem, ReviewMode, ReviewQueue, ReviewResult, ReviewSubmission, TrainingContext } from '@app/shared/types';

type WordItem = Extract<ReviewItem, { mode: 'ja-ru' | 'ru-ja' | 'listening' }>;
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
  progress: Progress | null = null;
  last: { attemptId: string; kind: 'good' | 'again' } | null = null;
  private epoch = 0;
  private owner = '';
  private context?: TrainingContext;
  private mode: ReviewMode | 'mixed' = 'ja-ru';
  private saving?: ReviewSave;
  constructor(private changed: () => void) {}
  get item() { return this.queue[0]; }
  get busy() { return this.loading || !!this.saving?.busy; }
  get pending() { return !!this.saving?.pending; }
  get saveError() { return this.saving?.error || this.error; }
  async open(owner: string, mode: ReviewMode | 'mixed', context?: TrainingContext) {
    if (this.busy || this.pending) return;
    this.owner = owner; this.mode = mode; this.context = context;
    const epoch = ++this.epoch; this.saving && (this.saving.active = false); this.loading = true; this.active = true; this.error = ''; this.changed();
    try {
      for (const pending of pendingReviews(owner)) { if (epoch !== this.epoch) return; await submitReview(owner, pending); }
      const course = await api<Course>('/api/course', { headers: learningHeaders(owner) });
      const query = context ? '/api/training?' + new URLSearchParams(Object.entries(context).map(([key, value]) => [key, String(value)])) : `/api/reviews?mode=${mode}`;
      const headers = learningHeaders(owner, course.publicationId);
      const [queue, progress] = await Promise.all([api<ReviewQueue>(query, { headers }), mode === 'mixed' && !context ? api<Progress>('/api/progress', { headers }) : null]);
      if (epoch !== this.epoch) return;
      this.course = course; this.queue = queue.items.filter(item => mode === 'mixed' || item.mode === mode) as T[]; this.remainingDue = queue.remainingDue; this.progress = progress; this.total = this.queue.length; this.completed = 0; this.turn++; this.last = null;
      this.saving = new ReviewSave(owner, (submission, result) => this.next(submission.rating === 1 || 'helped' in submission && !!submission.helped || result.correct === false, result), this.changed);
    } catch (error) { if (epoch === this.epoch) this.error = error instanceof Error ? error.message : 'Не удалось загрузить повторение.'; }
    finally { if (epoch === this.epoch) { this.loading = false; this.changed(); } }
  }
  private next(repeat: boolean, result: ReviewResult) {
    const item = this.item!;
    this.queue = advanceDeck(this.queue, repeat, result).map(value => value.targetId === item.targetId && value.mode === item.mode ? { ...value, version: result.version, due: result.nextDue, isNew: false } : value) as T[];
    if (!repeat) this.completed++; this.turn++; this.last = { attemptId: result.attemptId, kind: repeat ? 'again' : 'good' };
  }
  grade(owner: string, rating: 1 | 3) {
    const item = this.item; if (owner !== this.owner || !item || ('choices' in item && item.choices?.length) || !this.active || this.busy || this.pending) return;
    if (!['ja-ru', 'ru-ja', 'listening'].includes(item.mode)) return;
    return this.saving?.save({ attemptId: crypto.randomUUID(), reviewId: item.id, version: item.version, mode: item.mode as WordItem['mode'], rating, ...(item.publicationId ? { publicationId: item.publicationId } : {}) });
  }
  choose(id: string) {
    const item = this.item; if (!item || !('choices' in item) || !item.choices?.includes(id) || !this.active || this.busy || this.pending) return;
    return this.saving?.save({ attemptId: crypto.randomUUID(), reviewId: item.id, version: item.version, mode: item.mode as WordItem['mode'], rating: 3, choiceWordId: id, helped: false, ...(item.publicationId ? { publicationId: item.publicationId } : {}) });
  }
  save(value: ReviewSubmission) { if (this.active && !this.busy && !this.pending && value.reviewId === this.item?.id) return this.saving?.save(value); }
  async introduce() { const item = this.item, owner = this.owner, epoch = this.epoch; if (!item || this.busy) return; this.loading = true; this.changed(); try { await api('/api/training/introduce', { method: 'POST', headers: { ...learningHeaders(owner, item.publicationId), 'Content-Type': 'application/json' }, body: JSON.stringify({ reviewIds: [item.id], stage: 'learning', publicationId: item.publicationId }) }); if (epoch === this.epoch) { if (item.preparation) item.preparation.introduced = true; else if (item.mode === 'counter') item.counter.introduction = false; } } catch (e) { if (epoch === this.epoch) this.error = e instanceof Error ? e.message : 'Не удалось сохранить знакомство.'; } finally { if (epoch === this.epoch) { this.loading = false; this.changed(); } } }
  retry() { return this.pending ? this.saving?.retry() : this.open(this.owner, this.mode, this.context); }
  hide() { this.active = false; this.changed(); }
  clear() { ++this.epoch; if (this.saving) this.saving.active = false; this.saving = undefined; this.queue = []; this.course = null; this.progress = null; this.total = 0; this.remainingDue = 0; this.completed = 0; this.active = false; this.loading = false; this.last = null; this.error = ''; this.changed(); }
}
