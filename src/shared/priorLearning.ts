import type { Course } from './types';

export interface PriorLearningTarget { kind: 'word' | 'grammar'; itemId: string }
export interface PriorLearningMark extends PriorLearningTarget { canUndo: boolean }
export interface PriorLearningRequest {
  requestId: string;
  kind: 'word' | 'grammar' | 'lesson';
  itemId: string;
  action: 'mark' | 'unmark';
}
export interface PriorLearningResult { addedCards: number; removedCards: number }

export function mainLessonMaterial(course: Course, lessonId: string): PriorLearningTarget[] {
  const parts = course.learning?.find(route => route.lessonId === lessonId)?.goals.flatMap(goal => goal.parts) ?? [];
  const words = [...new Set(parts.flatMap(part => part.words.map(word => word.wordId)))];
  const skills = [...new Set(parts.flatMap(part => {
    const exercise = course.exercises.find(value => value.id === part.construction?.exerciseId);
    return exercise ? [exercise.skillId] : [];
  }))];
  return [...words.map(itemId => ({ kind: 'word' as const, itemId })), ...skills.map(itemId => ({ kind: 'grammar' as const, itemId }))];
}
