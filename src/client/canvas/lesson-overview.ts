import type { LearningState } from '@app/shared/learning';

export type LessonStage = { partId: string; completedSteps: number; totalSteps: number };
export function confirmedStages(parts: { partId: string; totalSteps: number }[], state?: LearningState): LessonStage[] {
  // A started lesson may be pinned to an older route; retain its saved boundaries.
  const source = state?.partProgress?.length ? state.partProgress : parts;
  return source.map(part => {
    const saved = state?.partProgress?.find(item => item.partId === part.partId);
    const totalSteps = Math.max(0, saved?.totalSteps ?? part.totalSteps);
    return { partId: part.partId, totalSteps, completedSteps: Math.max(0, Math.min(totalSteps, saved?.completedSteps ?? (state?.completed ? totalSteps : 0))) };
  });
}
export function stageSummary(stages: LessonStage[]) {
  const filled = stages.reduce((sum, stage) => sum + (stage.totalSteps ? stage.completedSteps / stage.totalSteps : 0), 0);
  return { percent: stages.length ? Math.round(filled / stages.length * 100) : 0, finished: stages.filter(stage => stage.totalSteps > 0 && stage.completedSteps === stage.totalSteps).length, count: stages.length };
}
// No scrolling: a compact spread when it fits, finite book pages otherwise.
export function lessonPagePlan(count: number, pageCount: number, availableHeight: number, rowHeight: number) {
  const rows = Math.max(1, Math.floor((availableHeight + 4) / (rowHeight + 4)));
  const capacity = Math.min(count || 1, rows * pageCount);
  return { rows, capacity, pages: Math.max(1, Math.ceil(count / capacity)) };
}
