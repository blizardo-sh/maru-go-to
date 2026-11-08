import { courseRepresentationHeader, learnerCourseRepresentation } from '../shared/course-representation';
import type { ReviewSubmission, ReviewResult } from '../shared/types';

export class ApiRequestError extends Error {
  constructor(message: string, public status: number, public code?: string) { super(message); }
}
const courses = new Map<string, { etag: string; data: unknown }>();

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body) headers.set('Content-Type', 'application/json');
  if ((!init.method || init.method === 'GET') && ['/api/course','/api/bootstrap'].includes(path) && !headers.has(courseRepresentationHeader)) headers.set(courseRepresentationHeader, learnerCourseRepresentation);
  const key = path === '/api/course' && (!init.method || init.method === 'GET') ? JSON.stringify([headers.get('X-Learning-Learner-Id'), headers.get('X-Content-Publication'), headers.get(courseRepresentationHeader)]) : null;
  const cached = key ? courses.get(key) : undefined;
  if (cached) headers.set('If-None-Match', cached.etag);
  const response = await fetch(path, {
    ...init,
    credentials: 'same-origin',
    headers,
  });
  // Revalidate with the authenticated server before reusing a publication or personal vocabulary.
  if (response.status === 304 && cached) return cached.data as T;
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new ApiRequestError(data?.error?.message ?? data?.message ?? `Запрос не выполнен (${response.status}). Попробуйте ещё раз.`, response.status, data?.error?.code ?? data?.code);
  const etag = response.headers.get('etag');
  if (key && etag) { courses.set(key, { etag, data }); if (courses.size > 8) courses.delete(courses.keys().next().value!); }
  return data as T;
}

export const publicationHeaders = (publicationId?: string): Record<string, string> => publicationId ? { 'X-Content-Publication': publicationId } : {};

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
  const original = pending.find(item => item.attemptId === submission.attemptId);
  if (original && JSON.stringify(original) !== JSON.stringify(submission)) throw new Error('Сохраняется первоначальный ответ.');
  if (!original) pending.push(submission);
  // Only unacknowledged attempts live here; schedules and user data always belong to the server.
  localStorage.setItem(outboxKey(userId), JSON.stringify(pending));
  const result = await api<ReviewResult>('/api/reviews', { ...json('POST', submission), headers: { 'X-Learning-Learner-Id': userId, ...publicationHeaders(submission.publicationId) } });
  if (result.attemptId !== submission.attemptId || submission.publicationId !== undefined && result.publicationId !== submission.publicationId || !Number.isInteger(result.version) || result.version < submission.version || !Number.isFinite(Date.parse(result.nextDue)) || !['scheduled', 'additional-practice', 'learning'].includes(result.status)) throw new Error('Сервер не подтвердил этот ответ. Он остаётся на устройстве.');
  localStorage.setItem(outboxKey(userId), JSON.stringify(pendingReviews(userId).filter(item => item.attemptId !== submission.attemptId)));
  return result;
}
