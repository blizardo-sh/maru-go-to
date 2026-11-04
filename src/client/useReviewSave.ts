import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReviewResult, ReviewSubmission } from '../shared/types';
import { submitReview } from './api';
const messages = (error: unknown) => error instanceof Error ? error.message : 'Не удалось сохранить ответ. Повторите попытку.';

// Shared by the React hook and Canvas controller; the outbox transport owns durability.
export class ReviewSave {
  busy = false;
  error = '';
  pending: ReviewSubmission | null = null;
  active = true;
  constructor(private owner: string, private onNext: (submission: ReviewSubmission, result: ReviewResult) => void, private changed: () => void, private send: typeof submitReview = submitReview) {}
  async save(value: ReviewSubmission) {
    if (this.busy || !this.active) return;
    const submission = this.pending ?? value; this.pending = submission; this.busy = true; this.error = ''; this.changed();
    try {
      const result = await this.send(this.owner, submission);
      if (this.active) { this.pending = null; this.onNext(submission, result); }
    } catch (failure) { if (this.active) this.error = `${messages(failure)} Ответ остаётся на этом устройстве до подтверждения.`; }
    finally { if (this.active) { this.busy = false; this.changed(); } }
  }
  retry() { if (this.pending) return this.save(this.pending); }
}

export function useReviewSave(userId: string, onSaved: () => void, onNext: (submission: ReviewSubmission, result: ReviewResult) => void, send: typeof submitReview = submitReview) {
  const [, render] = useState(0), callbacks = useRef({ onSaved, onNext, send }); callbacks.current = { onSaved, onNext, send };
  const saving = useMemo(() => new ReviewSave(userId, (submission, result) => { callbacks.current.onSaved(); callbacks.current.onNext(submission, result); }, () => render(value => value + 1), (owner, submission) => callbacks.current.send(owner, submission)), [userId]);
  useEffect(() => { saving.active = true; return () => { saving.active = false; }; }, [saving]);
  return { busy: saving.busy, error: saving.error, pending: !!saving.pending, save: (value: ReviewSubmission) => saving.save(value), retry: () => { void saving.retry(); } };
}
