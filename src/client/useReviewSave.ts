import { useEffect, useRef, useState } from 'react';
import type { ReviewResult, ReviewSubmission } from '../shared/types';
import { submitReview } from './api';
const messages = (error: unknown) => error instanceof Error ? error.message : 'Не удалось сохранить ответ. Повторите попытку.';

export function useReviewSave(userId: string, onSaved: () => void, onNext: (submission: ReviewSubmission, result: ReviewResult) => void, send: typeof submitReview = submitReview) {
  const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const pending = useRef<ReviewSubmission | null>(null); const lock = useRef(false);
  const owner = useRef(userId); owner.current = userId;
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; pending.current = null; lock.current = false; setBusy(false); setError(''); return () => { mounted.current = false; }; }, [userId]);
  async function save(value: ReviewSubmission) {
    if (lock.current) return;
    const submission = pending.current ?? value; pending.current = submission; lock.current = true; setBusy(true); setError('');
    try { const result = await send(userId, submission); if (mounted.current && owner.current === userId) { pending.current = null; onSaved(); onNext(submission, result); } }
    catch (failure) { if (mounted.current && owner.current === userId) setError(`${messages(failure)} Ответ остаётся на этом устройстве до подтверждения.`); }
    finally { if (mounted.current && owner.current === userId) { lock.current = false; setBusy(false); } }
  }
  return { busy, error, pending: !!pending.current, save, retry: () => { if (pending.current) void save(pending.current); } };
}
