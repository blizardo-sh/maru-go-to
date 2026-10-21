import type { ReviewSubmission, ReviewResult } from '../shared/types';

export class ApiRequestError extends Error {
  constructor(message: string, public status: number) { super(message); }
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(path, {
    ...init,
    credentials: 'same-origin',
    headers: { ...(init.body ? { 'Content-Type': 'application/json' } : {}), ...init.headers },
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new ApiRequestError(data?.error?.message ?? data?.message ?? `Запрос не выполнен (${response.status}). Попробуйте ещё раз.`, response.status);
  return data as T;
}

export const json = (method: string, value: unknown): RequestInit => ({ method, body: JSON.stringify(value) });
const outboxKey = (userId: string) => `japanese-pending-reviews:${userId}`;

export function pendingReviews(userId: string): ReviewSubmission[] {
  const saved = localStorage.getItem(outboxKey(userId));
  if (!saved) return [];
  try {
    const parsed: unknown = JSON.parse(saved);
    if (!Array.isArray(parsed)) throw new Error();
    return parsed.filter((item): item is ReviewSubmission => item && typeof item.attemptId === 'string' && typeof item.reviewId === 'string' && Number.isInteger(item.version));
  } catch {
    throw new Error('Не удалось прочитать несохранённые ответы на этом устройстве. Не очищайте данные браузера.');
  }
}

export async function submitReview(userId: string, submission: ReviewSubmission): Promise<ReviewResult> {
  const pending = pendingReviews(userId);
  if (!pending.some(item => item.attemptId === submission.attemptId)) pending.push(submission);
  // Only unacknowledged attempts live here; schedules and user data always belong to the server.
  localStorage.setItem(outboxKey(userId), JSON.stringify(pending));
  const result = await api<ReviewResult>('/api/reviews', json('POST', submission));
  localStorage.setItem(outboxKey(userId), JSON.stringify(pendingReviews(userId).filter(item => item.attemptId !== submission.attemptId)));
  return result;
}
