import type { Course } from './types';
import { wordTargets } from './meanings';
import type { GuidedLesson, LearningRouteState, LearningStep } from './learning';
import { learningParts } from './learning';

export type PriorTarget = { kind: 'word' | 'grammar'; id: string };
export type PriorScope = { lessonId: string; scope: 'main' | 'extra' } | { targets: PriorTarget[] };
export interface PriorCommand { requestId: string; publicationId?: string; selection?: PriorScope; undo?: string }
export interface PriorResult { requestId: string; added: number; removed: number; retained: number; targets: number }
export function priorTargets(course: Course, selection: PriorScope): PriorTarget[] {
  if ('targets' in selection) return selection.targets;
  const route = course.learning?.find(value => value.lessonId === selection.lessonId);
  if (!route) throw new Error('Учебный маршрут не найден.');
  const main: PriorTarget[] = route.goals.flatMap(goal => goal.parts.flatMap(part => [
    ...part.words.map(word => ({ kind: 'word' as const, id: word.wordId })),
    ...(part.construction ? [{ kind: 'grammar' as const, id: course.exercises.find(exercise => exercise.id === part.construction!.exerciseId)!.skillId }] : []),
  ]));
  const unique = (values: PriorTarget[]) => [...new Map(values.map(value => [value.kind+':'+value.id, value])).values()];
  if (selection.scope === 'main') return unique(main);
  const core = new Set(main.map(value => value.kind+':'+value.id));
  return unique([...wordTargets(course).filter(word => word.lessonIds.includes(selection.lessonId) && word.reviewStatus !== 'draft' && !word.trainingOnly).map(word => ({kind:'word' as const,id:word.id})),
    ...course.skills.filter(skill => skill.lessonIds.includes(selection.lessonId) && skill.reviewStatus !== 'draft').map(skill => ({kind:'grammar' as const,id:skill.id}))]).filter(value => !core.has(value.kind+':'+value.id));
}

/** A projection only: recognition never adds a completed answer to durable route state. */
export function recognizeRoute(course: Course, route: GuidedLesson, state: LearningRouteState, targets: Set<string>, whole: boolean): LearningRouteState {
  const core=priorTargets(course,{lessonId:route.lessonId,scope:'main'});
  if(!whole && !route.goals.some(goal=>goal.parts.some(part=>part.tasks?.length)) && core.length && core.every(target=>targets.has(target.kind+':'+target.id)))whole=true;
  const parts = learningParts(route), done = new Set(state.completedStepIds.filter(id=>!state.skippedStepIds?.includes(id))), recognized = new Set<string>();
  const known = (step: LearningStep) => whole || ('wordId' in step && ['word-intro','word-practice'].includes(step.kind) && targets.has('word:'+step.wordId)) ||
    ('exerciseId' in step && targets.has('grammar:'+course.exercises.find(exercise => exercise.id === step.exerciseId)?.skillId));
  for (const part of parts) {
    for (const step of part) if (known(step) && !done.has(step.id)) recognized.add(step.id);
    if (part.some(step => recognized.has(step.id)) && part.every(step => step.kind === 'part-complete' || step.kind === 'video' || done.has(step.id) || recognized.has(step.id)))
      for (const step of part) if (!done.has(step.id)) recognized.add(step.id);
  }
  const index = parts.findIndex(part => part.some(step => !done.has(step.id) && !recognized.has(step.id)));
  const remaining = index < 0 ? [] : parts[index]!.filter(step => !done.has(step.id) && !recognized.has(step.id)).map(step => step.id);
  const reopened = remaining.some(id => (state.recognizedStepIds ?? state.skippedStepIds ?? []).includes(id));
  const oldOrder = !reopened && index === state.partIndex ? state.pendingStepIds.filter(id => remaining.includes(id)) : [];
  return {...state, completedStepIds:[...done], skippedStepIds:[], partIndex:index < 0 ? parts.length : index, pendingStepIds:[...oldOrder,...remaining.filter(id => !oldOrder.includes(id))], recognizedStepIds:[...recognized], ...(whole ? { recognizedWhole:true } : { recognizedWhole:false })};
}
