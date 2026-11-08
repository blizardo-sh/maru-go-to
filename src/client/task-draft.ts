import type { LearningState } from '../shared/learning';
export function taskDraftKey(owner: string, state: LearningState) {
  return `japanese-task-v1:${owner}:${state.publicationId??'legacy'}:${state.lessonId}:${state.routeVersion}:${state.step?.id}`;
}
export function readTaskDraft(key: string): string { return localStorage.getItem(key) ?? ''; }
export function saveTaskDraft(key: string, text: string) { localStorage.setItem(key,text); }
