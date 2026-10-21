import type { TrainingContext, Word } from '../shared/types';
import type { Snapshot, StudySource } from './types';

export function sourceKey(source: StudySource): string {
  return source.kind === 'lesson' ? `lesson:${source.lessonId}` : source.kind === 'list' ? `list:${source.listId}` : 'review';
}

export function trainingContext(source: StudySource): TrainingContext {
  return source.kind === 'lesson' ? { lessonId: source.lessonId } : source.kind === 'list' ? { listId: source.listId } : {};
}

export function studyWord(word: Word): boolean {
  return word.reviewStatus !== 'draft' && !!word.kana && word.segments.map(segment => segment.surface).join('') === word.surface && word.segments.map(segment => segment.reading ?? segment.surface).join('') === word.kana;
}

export function editorWordIds(data: Snapshot, source: StudySource): Set<string> {
  const ids = new Set(data.progress.introducedWordIds);
  if (source.kind === 'lesson') for (const word of data.course.words) { if (word.lessonIds.includes(source.lessonId)) ids.add(word.id); }
  if (source.kind === 'list') for (const word of data.lists.find(list => list.id === source.listId)?.words ?? []) { if (studyWord(word)) ids.add(word.id); }
  return ids;
}
