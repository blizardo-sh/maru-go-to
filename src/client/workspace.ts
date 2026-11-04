import { matchesPreparedAnswer } from '../shared/answers';
import type { Course, Exercise } from '../shared/types';
export type WorkspaceToken = { id: string; wordId: string; formId: string | null };
export function preparedWorkspace(exercise: Exercise, course: Pick<Course, 'forms'>, tokens: WorkspaceToken[]) {
  return tokens.every(token => token.formId !== null) && matchesPreparedAnswer(exercise, course.forms, tokens.map(token => token.id), Object.fromEntries(tokens.map(token => [token.id, token.formId!])));
}
export function placeWorkspaceToken(tokens: WorkspaceToken[], original: WorkspaceToken[], id: string, targetId?: string, after = false) {
  if (id === targetId) return tokens;
  const token = tokens.find(token => token.id === id) ?? original.find(token => token.id === id); if (!token) return tokens;
  const next = tokens.filter(token => token.id !== id), target = targetId ? next.findIndex(token => token.id === targetId) : -1;
  next.splice(target < 0 ? next.length : target + Number(after), 0, token); return next;
}
export function moveWorkspaceToken(tokens: WorkspaceToken[], id: string, step: -1 | 1) {
  const index = tokens.findIndex(token => token.id === id); if (!tokens[index + step]) return tokens;
  const next = [...tokens]; [next[index], next[index + step]] = [next[index + step]!, next[index]!]; return next;
}
