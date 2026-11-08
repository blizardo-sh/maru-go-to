import type { LearningAdvance, LearningAdvanceResult, LearningState } from '../shared/learning';
import { api, ApiRequestError, json, publicationHeaders } from './api';

export type PendingLearning = { lessonId: string; submission: LearningAdvance };
export const learningConflict = (error: unknown): error is ApiRequestError => error instanceof ApiRequestError && error.status === 409 && error.code === 'LEARNING_CONFLICT';
export const invalidLearningChoice = (error: unknown): error is ApiRequestError => error instanceof ApiRequestError && error.status === 400 && error.code === 'INVALID_CHOICE';
export const learningHeaders = (userId: string, publicationId?: string) => ({ 'X-Learning-Learner-Id': userId, ...publicationHeaders(publicationId) });
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
      return (input.recall === undefined || object(input.recall) && typeof input.recall.helped === 'boolean' && (input.recall.firstChoiceWordId === undefined || typeof input.recall.firstChoiceWordId === 'string') && (input.recall.firstTokenIds === undefined || strings(input.recall.firstTokenIds)) && (input.recall.firstTokenForms === undefined || object(input.recall.firstTokenForms) && Object.values(input.recall.firstTokenForms).every(form => typeof form === 'string'))) && typeof input.attemptId === 'string' && typeof input.routeVersion === 'string' && typeof input.stepId === 'string' && Number.isInteger(input.stateVersion) && Number(input.stateVersion) >= 0 && ['continue', 'remember', 'again', 'skip', 'start-practice', 'choose', 'answer', 'attempt', 'assess'].includes(String(input.action)) && (input.taskAnswer===undefined||typeof input.taskAnswer==='string'&&input.taskAnswer.length<=4000) && (input.attempted===undefined||typeof input.attempted==='boolean') && (input.selfAssessment===undefined||['achieved','with-help','retry'].includes(String(input.selfAssessment))) && (input.publicationId === undefined || typeof input.publicationId === 'string' && /^[a-f0-9]{64}$/.test(input.publicationId)) && (input.counterChoice === undefined || typeof input.counterChoice === 'string') && (input.helped === undefined || typeof input.helped === 'boolean') && (input.choiceWordId === undefined || typeof input.choiceWordId === 'string') && (input.tokenIds === undefined || strings(input.tokenIds)) && (input.tokenForms === undefined || object(input.tokenForms) && Object.values(input.tokenForms).every(form => typeof form === 'string')) && (input.revealed === undefined || typeof input.revealed === 'boolean') && (input.exploring === undefined || typeof input.exploring === 'boolean');
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
  try { result = await api<LearningAdvanceResult>(`/api/learning/${encodeURIComponent(pending.lessonId)}/advance`, { ...json('POST', pending.submission), headers: learningHeaders(userId, pending.submission.publicationId) }); }
  catch (error) {
    // This response guarantees the obsolete action was not applied; ambiguous failures remain queued.
    if (learningConflict(error) || invalidLearningChoice(error)) localStorage.setItem(key(userId), JSON.stringify(pendingLearning(userId).filter(item => item.submission.attemptId !== pending.submission.attemptId)));
    throw error;
  }
  if (result.attemptId !== pending.submission.attemptId || result.state.lessonId !== pending.lessonId || result.state.version !== pending.submission.stateVersion + 1) throw new Error('Сервер не подтвердил этот шаг. Ответ сохранён на устройстве.');
  localStorage.setItem(key(userId), JSON.stringify(pendingLearning(userId).filter(item => item.submission.attemptId !== pending.submission.attemptId)));
  return result;
}

export function currentLearningState(next: LearningState, lessonId: string, routeVersion: string, previous: LearningState | null): boolean {
  return next.lessonId === lessonId && next.routeVersion === routeVersion && (!previous || next.version >= previous.version);
}

export type RecallDraft = { revealed: boolean; helped: boolean; firstChoiceWordId?: string; firstTokenIds?: string[]; firstTokenForms?: Record<string, string>; tokenIds?: string[] };
export const recallDraftKey = (owner: string, state: LearningState) => `japanese-recall-draft:${owner}:${state.lessonId}:${state.publicationId ?? ''}:${state.step?.id}:${state.version}`;
export function readRecallDraft(key: string): RecallDraft {
  const saved = localStorage.getItem(key);
  if (!saved) return { revealed: false, helped: false };
  const draft = JSON.parse(saved);
  if (!object(draft) || typeof draft.revealed !== 'boolean' || typeof draft.helped !== 'boolean' || draft.firstChoiceWordId !== undefined && typeof draft.firstChoiceWordId !== 'string' || draft.firstTokenIds !== undefined && !strings(draft.firstTokenIds) || draft.tokenIds !== undefined && !strings(draft.tokenIds) || draft.firstTokenForms !== undefined && (!object(draft.firstTokenForms) || !Object.values(draft.firstTokenForms).every(value => typeof value === 'string'))) throw new Error('Не удалось прочитать попытку вспомнить. Не очищайте данные браузера.');
  return draft as RecallDraft;
}
export function writeRecallDraft(key: string, change: Partial<RecallDraft>): RecallDraft {
  const previous = readRecallDraft(key);
  const next = { ...previous, ...change, helped: previous.helped || !!change.helped, revealed: previous.revealed || !!change.revealed,
    ...(previous.firstChoiceWordId !== undefined ? { firstChoiceWordId: previous.firstChoiceWordId } : {}),
    ...(previous.firstTokenIds ? { firstTokenIds: previous.firstTokenIds, firstTokenForms: previous.firstTokenForms } : {}) };
  localStorage.setItem(key, JSON.stringify(next)); return next;
}
