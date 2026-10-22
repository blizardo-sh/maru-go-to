import type { LearningAdvance, LearningAdvanceResult, LearningState } from '../shared/learning';
import { api, ApiRequestError, json } from './api';

export type PendingLearning = { lessonId: string; submission: LearningAdvance };
export const learningConflict = (error: unknown): error is ApiRequestError => error instanceof ApiRequestError && error.status === 409 && error.code === 'LEARNING_CONFLICT';
export const learningHeaders = (userId: string) => ({ 'X-Learning-Learner-Id': userId });
const key = (userId: string) => `japanese-pending-learning:${userId}`;
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const strings = (value: unknown): value is string[] => Array.isArray(value) && value.every(item => typeof item === 'string');

export function pendingLearning(userId: string): PendingLearning[] {
  const saved = localStorage.getItem(key(userId));
  if (!saved) return [];
  try {
    const value: unknown = JSON.parse(saved);
    if (!Array.isArray(value) || !value.every(item => {
      if (!object(item) || typeof item.lessonId !== 'string' || !object(item.submission)) return false;
      const input = item.submission;
      return typeof input.attemptId === 'string' && typeof input.routeVersion === 'string' && typeof input.stepId === 'string' && Number.isInteger(input.stateVersion) && Number(input.stateVersion) >= 0 && ['continue', 'remember', 'again', 'skip', 'start-practice', 'choose'].includes(String(input.action)) && (input.choiceWordId === undefined || typeof input.choiceWordId === 'string') && (input.tokenIds === undefined || strings(input.tokenIds)) && (input.tokenForms === undefined || object(input.tokenForms) && Object.values(input.tokenForms).every(form => typeof form === 'string')) && (input.revealed === undefined || typeof input.revealed === 'boolean') && (input.exploring === undefined || typeof input.exploring === 'boolean');
    })) throw new Error();
    return value;
  } catch { throw new Error('Не удалось прочитать несохранённые шаги урока. Не очищайте данные браузера.'); }
}

export async function submitLearning(userId: string, pending: PendingLearning): Promise<LearningAdvanceResult> {
  const queue = pendingLearning(userId);
  const original = queue.find(item => item.submission.attemptId === pending.submission.attemptId);
  if (original && JSON.stringify(original) !== JSON.stringify(pending)) throw new Error('Сохраняется первоначальный ответ. Повторите его сохранение.');
  if (!original) queue.push(pending);
  localStorage.setItem(key(userId), JSON.stringify(queue));
  let result: LearningAdvanceResult;
  try { result = await api<LearningAdvanceResult>(`/api/learning/${encodeURIComponent(pending.lessonId)}/advance`, { ...json('POST', pending.submission), headers: learningHeaders(userId) }); }
  catch (error) {
    // This response guarantees the obsolete action was not applied; ambiguous failures remain queued.
    if (learningConflict(error)) localStorage.setItem(key(userId), JSON.stringify(pendingLearning(userId).filter(item => item.submission.attemptId !== pending.submission.attemptId)));
    throw error;
  }
  if (result.attemptId !== pending.submission.attemptId || result.state.lessonId !== pending.lessonId) throw new Error('Сервер не подтвердил этот шаг. Ответ сохранён на устройстве.');
  localStorage.setItem(key(userId), JSON.stringify(pendingLearning(userId).filter(item => item.submission.attemptId !== pending.submission.attemptId)));
  return result;
}

export function currentLearningState(next: LearningState, lessonId: string, routeVersion: string, previous: LearningState | null): boolean {
  return next.lessonId === lessonId && next.routeVersion === routeVersion && (!previous || next.version >= previous.version);
}
